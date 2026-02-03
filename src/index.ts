#!/usr/bin/env node

// Allow self-signed certificates for local Keyboard Maestro servers
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";

// UUID of the "Save Clipboard to File" macro from the Keyboard Maestro MCP macro group
const SAVE_CLIPBOARD_MACRO_UID = "D03AC8C4-56B0-4903-9682-8B2EC10576FC";

// Machine configuration schema
export interface MachineConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
  outputDir?: string; // Directory where clipboard saves go (for get_clipboard_result)
  saveClipboardMacroUid?: string; // UUID of the "Save Clipboard to File" macro on this machine
}

// Parse machine configuration from environment
export function getMachines(): MachineConfig[] {
  const machinesEnv = process.env.KM_MACHINES;

  if (!machinesEnv) {
    // Check for legacy single-machine config
    const host = process.env.KM_HOST;
    const port = process.env.KM_PORT;
    const username = process.env.KM_USERNAME;
    const password = process.env.KM_PASSWORD;

    if (host && username && password) {
      return [
        {
          name: "default",
          host,
          port: port ? parseInt(port, 10) : 4490,
          username,
          password,
          secure: process.env.KM_SECURE === "true",
        },
      ];
    }

    return [];
  }

  try {
    const parsed = JSON.parse(machinesEnv);
    if (!Array.isArray(parsed)) {
      console.error("KM_MACHINES must be a JSON array");
      return [];
    }
    return parsed.map((m: MachineConfig) => ({
      name: m.name || "unnamed",
      host: m.host,
      port: m.port || 4490,
      username: m.username,
      password: m.password,
      secure: m.secure ?? false,
      outputDir: m.outputDir,
      saveClipboardMacroUid: m.saveClipboardMacroUid,
    }));
  } catch (e) {
    console.error("Failed to parse KM_MACHINES:", e);
    return [];
  }
}

// Build the base URL for a machine
export function getBaseUrl(machine: MachineConfig): string {
  const protocol = machine.secure ? "https" : "http";
  const port = machine.secure ? machine.port + 1 : machine.port;
  return `${protocol}://${machine.host}:${port}`;
}

// Build Basic Auth header
export function getAuthHeader(machine: MachineConfig): string {
  const credentials = Buffer.from(
    `${machine.username}:${machine.password}`
  ).toString("base64");
  return `Basic ${credentials}`;
}

// Find a machine by name (case-insensitive)
export function findMachine(
  machines: MachineConfig[],
  name?: string
): MachineConfig | undefined {
  if (!name) {
    return machines[0];
  }
  return machines.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

// Decode HTML entities in strings
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Fetch and parse the list of macros from a machine's web server
export async function listMacros(
  machine: MachineConfig
): Promise<{ success: boolean; macros?: { name: string; uid?: string; group?: string }[]; message?: string }> {
  // Use the authenticated HTTPS endpoint to get all macros (public + protected)
  const httpsPort = machine.port + 1;
  const url = `https://${machine.host}:${httpsPort}/authenticated.html`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(machine),
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return {
          success: false,
          message: `Authentication failed for ${machine.name}. Check username/password.`,
        };
      }
      return {
        success: false,
        message: `Failed to fetch macros from ${machine.name}: HTTP ${response.status}`,
      };
    }

    const html = await response.text();

    // Parse the HTML to extract macros from the Protected Macros section
    // Macros are in <option> tags within <optgroup> tags:
    // <optgroup label="Group Name">
    //   <option label="Macro Name" value="UUID">Macro Name</option>
    // </optgroup>
    const macros: { name: string; uid?: string; group?: string }[] = [];

    // Find the Protected Macros select (uses authenticatedaction.html)
    const protectedSection = html.match(/<form[^>]*action="authenticatedaction\.html"[^>]*>[\s\S]*?<\/form>/i);
    const htmlToParse = protectedSection ? protectedSection[0] : html;

    // Parse optgroups and their options
    const optgroupRegex = /<optgroup[^>]*label="([^"]*)"[^>]*>([\s\S]*?)<\/optgroup>/gi;
    const optionRegex = /<option[^>]*label="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi;
    let groupMatch;

    while ((groupMatch = optgroupRegex.exec(htmlToParse)) !== null) {
      const groupName = decodeHtmlEntities(groupMatch[1].trim());
      const groupContent = groupMatch[2];

      let optionMatch;
      // Reset regex for each group
      optionRegex.lastIndex = 0;
      while ((optionMatch = optionRegex.exec(groupContent)) !== null) {
        const name = decodeHtmlEntities(optionMatch[1].trim());
        const uid = optionMatch[2];
        if (name && uid) {
          macros.push({ name, uid, group: groupName });
        }
      }
    }

    return {
      success: true,
      macros,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      message: `Failed to connect to ${machine.name} (${machine.host}:${machine.port}): ${message}`,
    };
  }
}

// Trigger a macro on a machine
export async function triggerMacro(
  machine: MachineConfig,
  macro: string,
  value?: string
): Promise<{ success: boolean; message: string; result?: string }> {
  // Use authenticated HTTPS endpoint to access both public and protected macros
  const httpsPort = machine.port + 1;
  const params = new URLSearchParams({ macro });
  if (value) {
    params.set("value", value);
  }

  const url = `https://${machine.host}:${httpsPort}/authenticatedaction.html?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(machine),
      },
    });

    if (response.ok) {
      const responseBody = await response.text();
      return {
        success: true,
        message: `Macro "${macro}" triggered successfully on ${machine.name}`,
        result: responseBody || undefined,
      };
    } else if (response.status === 401) {
      return {
        success: false,
        message: `Authentication failed for ${machine.name}. Check username/password.`,
      };
    } else if (response.status === 403) {
      return {
        success: false,
        message: `Access denied for ${machine.name}. The macro may not exist or may not be enabled.`,
      };
    } else {
      return {
        success: false,
        message: `Failed to trigger macro on ${machine.name}: HTTP ${response.status}`,
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      message: `Failed to connect to ${machine.name} (${machine.host}:${machine.port}): ${message}`,
    };
  }
}

// Generic fetch for exploring the web server
export async function fetchUrl(
  machine: MachineConfig,
  path: string
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const baseUrl = getBaseUrl(machine);
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(machine),
    },
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
}

// Get the output directory for a machine, with fallback to ~/Downloads
function getOutputDir(machine: MachineConfig): string {
  return machine.outputDir || join(homedir(), "Downloads");
}

// Wait for a file to exist, with timeout
async function waitForFile(filePath: string, timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await access(filePath, constants.R_OK);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
  return false;
}

// Trigger the Save Clipboard macro and retrieve the result
export async function getClipboardResult(
  machine: MachineConfig
): Promise<{
  success: boolean;
  message: string;
  type?: "text" | "image";
  content?: string; // Text content or base64-encoded image
  filePath?: string;
}> {
  const macroUid = machine.saveClipboardMacroUid;
  if (!macroUid) {
    return {
      success: false,
      message: `Clipboard capture not configured for machine "${machine.name}".

To enable clipboard capture:
1. Import the "Save Clipboard to File" macro from the keyboard-maestro-mcp package:
   - Find 'save-clipboard-to-file.kmmacros' in the package directory
   - Double-click to import into Keyboard Maestro on the target machine

2. Get the macro's UUID:
   - Use list_macros to find "Save Clipboard to File" in the "Keyboard Maestro MCP" group
   - Copy its 'uid' value

3. Add to your machine config:
   "saveClipboardMacroUid": "<the-uuid-you-copied>"

4. Also configure outputDir (path where clipboard files are saved):
   "outputDir": "/path/to/shared/folder"
   (Use a folder accessible from where this MCP server runs, e.g., iCloud Drive for cross-machine access)`,
    };
  }

  const requestId = randomUUID().slice(0, 8); // Short unique ID
  const outputDir = getOutputDir(machine);

  // Trigger the save clipboard macro with our unique ID
  const triggerResult = await triggerMacro(machine, macroUid, requestId);

  if (!triggerResult.success) {
    return {
      success: false,
      message: `Failed to trigger Save Clipboard macro: ${triggerResult.message}`,
    };
  }

  // Check for both possible file types
  const textPath = join(outputDir, `clipsav_${requestId}.txt`);
  const imagePath = join(outputDir, `clipsav_${requestId}.png`);

  // Wait for one of the files to appear
  const [textExists, imageExists] = await Promise.all([
    waitForFile(textPath, 3000),
    waitForFile(imagePath, 3000),
  ]);

  if (imageExists) {
    try {
      const imageData = await readFile(imagePath);
      return {
        success: true,
        message: "Clipboard image retrieved successfully",
        type: "image",
        content: imageData.toString("base64"),
        filePath: imagePath,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to read image file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  if (textExists) {
    try {
      const textData = await readFile(textPath, "utf-8");
      return {
        success: true,
        message: "Clipboard text retrieved successfully",
        type: "text",
        content: textData,
        filePath: textPath,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to read text file: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  return {
    success: false,
    message: `Clipboard save file not found. Expected: ${textPath} or ${imagePath}. Make sure the "Save Clipboard to File" macro is installed and the outputDir is configured correctly.`,
  };
}

// Main server setup
async function main() {
  const machines = getMachines();

  const server = new McpServer({
    name: "keyboard-maestro-mcp",
    version: "0.1.0",
  });

  // Tool: list_machines
  server.tool(
    "list_machines",
    "List all configured Keyboard Maestro machines",
    {},
    async () => {
      if (machines.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No machines configured. Set KM_MACHINES environment variable with a JSON array of machine configs, or set KM_HOST, KM_USERNAME, and KM_PASSWORD for a single machine.",
            },
          ],
        };
      }

      const machineList = machines.map((m) => ({
        name: m.name,
        host: m.host,
        port: m.port,
        secure: m.secure,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(machineList, null, 2),
          },
        ],
      };
    }
  );

  // Tool: list_macros
  server.tool(
    "list_macros",
    "List available macros from a Keyboard Maestro machine's web server",
    {
      machine: z
        .string()
        .optional()
        .describe("Name of the machine to list macros from (defaults to first configured machine)"),
    },
    async ({ machine: machineName }) => {
      const machine = findMachine(machines, machineName);

      if (!machine) {
        const availableMachines = machines.map((m) => m.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: machineName
                ? `Machine "${machineName}" not found. Available machines: ${availableMachines || "none configured"}`
                : "No machines configured. Set KM_MACHINES environment variable.",
            },
          ],
          isError: true,
        };
      }

      const result = await listMacros(machine);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: result.message || "Failed to list macros",
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                machine: machine.name,
                macros: result.macros,
                count: result.macros?.length || 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool: trigger_macro
  server.tool(
    "trigger_macro",
    `Trigger a Keyboard Maestro macro by name or UUID. The macro runs on the remote machine.

IMPORTANT: Keyboard Maestro's web server does not return macro output directly. If you need to retrieve results from a macro:
- For macros that capture screenshots or copy data to clipboard: call get_clipboard_result afterward to retrieve the clipboard contents
- For macros that write to files: the files are saved on the remote machine

Common patterns:
- Screenshot workflow: trigger_macro("Take Screenshot...") → get_clipboard_result() to see the image
- Text capture: trigger_macro("Copy Selection") → get_clipboard_result() to get the text`,
    {
      macro: z
        .string()
        .describe("The macro name or UUID to trigger"),
      value: z
        .string()
        .optional()
        .describe("Optional value to pass to the macro (available as %TriggerValue% in the macro)"),
      machine: z
        .string()
        .optional()
        .describe("Name of the machine to trigger the macro on (defaults to first configured machine)"),
    },
    async ({ macro, value, machine: machineName }) => {
      const machine = findMachine(machines, machineName);

      if (!machine) {
        const availableMachines = machines.map((m) => m.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: machineName
                ? `Machine "${machineName}" not found. Available machines: ${availableMachines || "none configured"}`
                : "No machines configured. Set KM_MACHINES environment variable.",
            },
          ],
          isError: true,
        };
      }

      const result = await triggerMacro(machine, macro, value);

      const responseText = result.result
        ? `${result.message}\n\nResult:\n${result.result}`
        : result.message;

      return {
        content: [
          {
            type: "text" as const,
            text: responseText,
          },
        ],
        isError: !result.success,
      };
    }
  );

  // Tool: trigger_macro_on_all
  server.tool(
    "trigger_macro_on_all",
    "Trigger a Keyboard Maestro macro on all configured machines",
    {
      macro: z
        .string()
        .describe("The macro name or UUID to trigger"),
      value: z
        .string()
        .optional()
        .describe("Optional value to pass to the macro (available as %TriggerValue% in the macro)"),
    },
    async ({ macro, value }) => {
      if (machines.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No machines configured.",
            },
          ],
          isError: true,
        };
      }

      const results = await Promise.all(
        machines.map((m) => triggerMacro(m, macro, value))
      );

      const summary = results
        .map((r, i) => `${machines[i].name}: ${r.message}`)
        .join("\n");

      const allSuccess = results.every((r) => r.success);

      return {
        content: [
          {
            type: "text" as const,
            text: summary,
          },
        ],
        isError: !allSuccess,
      };
    }
  );

  // Tool: get_clipboard_result
  server.tool(
    "get_clipboard_result",
    `Retrieve the current clipboard contents from a remote machine. Returns text directly or displays images.

This is the companion tool to trigger_macro - use it to retrieve results after triggering macros that:
- Take screenshots (the image will be on the clipboard)
- Copy text or data to clipboard
- Perform OCR or text extraction
- Any operation that puts results on the system clipboard

The tool works by triggering a helper macro that saves the clipboard to a file, then reading that file.
Requires the "Save Clipboard to File" macro to be installed (see error message for setup instructions if not configured).`,
    {
      machine: z
        .string()
        .optional()
        .describe("Name of the machine to get clipboard from (defaults to first configured machine)"),
    },
    async ({ machine: machineName }) => {
      const machine = findMachine(machines, machineName);

      if (!machine) {
        const availableMachines = machines.map((m) => m.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: machineName
                ? `Machine "${machineName}" not found. Available machines: ${availableMachines || "none configured"}`
                : "No machines configured. Set KM_MACHINES environment variable.",
            },
          ],
          isError: true,
        };
      }

      const result = await getClipboardResult(machine);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: result.message,
            },
          ],
          isError: true,
        };
      }

      if (result.type === "image") {
        return {
          content: [
            {
              type: "image" as const,
              data: result.content!,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: `Image saved to: ${result.filePath}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: result.content!,
          },
          {
            type: "text" as const,
            text: `\n---\nSaved to: ${result.filePath}`,
          },
        ],
      };
    }
  );

  // Tool: trigger_and_capture
  server.tool(
    "trigger_and_capture",
    `Trigger a macro and automatically capture the clipboard result. This is a convenience tool that combines trigger_macro + get_clipboard_result.

Use this when you want to:
- Take a screenshot and see it immediately
- Run a macro that copies something to clipboard and retrieve it
- Perform OCR and get the extracted text

The macro runs first, then after a short delay the clipboard is captured and returned.`,
    {
      macro: z
        .string()
        .describe("The macro name or UUID to trigger"),
      value: z
        .string()
        .optional()
        .describe("Optional value to pass to the macro (available as %TriggerValue% in the macro)"),
      machine: z
        .string()
        .optional()
        .describe("Name of the machine (defaults to first configured machine)"),
      delay: z
        .number()
        .optional()
        .describe("Milliseconds to wait after triggering before capturing clipboard (default: 500)"),
    },
    async ({ macro, value, machine: machineName, delay }) => {
      const machine = findMachine(machines, machineName);

      if (!machine) {
        const availableMachines = machines.map((m) => m.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: machineName
                ? `Machine "${machineName}" not found. Available machines: ${availableMachines || "none configured"}`
                : "No machines configured. Set KM_MACHINES environment variable.",
            },
          ],
          isError: true,
        };
      }

      // First trigger the macro
      const triggerResult = await triggerMacro(machine, macro, value);

      if (!triggerResult.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to trigger macro: ${triggerResult.message}`,
            },
          ],
          isError: true,
        };
      }

      // Wait for the macro to complete and populate clipboard
      const waitTime = delay ?? 500;
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Now capture the clipboard
      const clipResult = await getClipboardResult(machine);

      if (!clipResult.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Macro triggered successfully, but clipboard capture failed: ${clipResult.message}`,
            },
          ],
          isError: true,
        };
      }

      if (clipResult.type === "image") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Macro "${macro}" executed. Clipboard contained an image:`,
            },
            {
              type: "image" as const,
              data: clipResult.content!,
              mimeType: "image/png",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Macro "${macro}" executed. Clipboard contents:\n\n${clipResult.content}`,
          },
        ],
      };
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
