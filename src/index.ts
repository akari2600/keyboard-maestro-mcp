#!/usr/bin/env node

// Allow self-signed certificates for local Keyboard Maestro servers
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import { constants } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { fileURLToPath } from "url";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  SAVE_CLIPBOARD_MACRO_UID,
  generateMacrosFile,
  expandPath,
  validatePath,
  SUGGESTED_PATHS,
} from "./macros-template.js";
import {
  testMachineConnection,
  checkMacroGroupExists,
  readMcpConfig,
  writeMcpConfig,
  generateServerConfig,
  getConfigState,
  CONFIG_PATHS,
} from "./config-manager.js";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    // Check for single-machine config via individual environment variables
    const host = process.env.KM_HOST;
    const port = process.env.KM_PORT;
    const username = process.env.KM_USERNAME;
    const password = process.env.KM_PASSWORD;

    if (host && username && password) {
      return [
        {
          name: process.env.KM_NAME || host,
          host,
          port: port ? parseInt(port, 10) : 4490,
          username,
          password,
          secure: process.env.KM_SECURE === "true",
          outputDir: process.env.KM_OUTPUT_DIR,
          saveClipboardMacroUid: process.env.KM_SAVE_CLIPBOARD_MACRO_UID || SAVE_CLIPBOARD_MACRO_UID,
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
      saveClipboardMacroUid: m.saveClipboardMacroUid || SAVE_CLIPBOARD_MACRO_UID,
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
  if (!machine.outputDir) {
    return {
      success: false,
      message: `Clipboard capture not configured for machine "${machine.name}".

To enable clipboard capture, run the setup wizard:
  setup_wizard with action="start"

The wizard will:
1. Generate the required Keyboard Maestro macros
2. Guide you through importing them
3. Help you configure the outputDir setting

Or manually configure:
1. Set "outputDir" in your machine config to the folder where clipboard files are saved
2. Make sure the "Keyboard Maestro MCP" macro group is installed in Keyboard Maestro`,
    };
  }

  const macroUid = machine.saveClipboardMacroUid || SAVE_CLIPBOARD_MACRO_UID;
  const requestId = randomUUID().slice(0, 8); // Short unique ID
  const outputDir = machine.outputDir;

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

// Setup wizard state (for multi-step text-based wizard)
interface WizardState {
  step: "start" | "path" | "generate" | "complete";
  filePath?: string;
  generatedFile?: string;
}

const wizardStates = new Map<string, WizardState>();

// Config wizard handler (shared by CLI config tool)
async function handleConfigWizard({ action, session_id, path, output_path }: {
  action: "start" | "set_path" | "generate" | "status";
  session_id?: string;
  path?: string;
  output_path?: string;
}) {
  // Handle start action
  if (action === "start") {
    const newSessionId = randomUUID().slice(0, 8);
    wizardStates.set(newSessionId, { step: "start" });

    const suggestedPaths = Object.entries(SUGGESTED_PATHS)
      .map(([name, p]) => `  - ${name}: ${p}`)
      .join("\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `# Keyboard Maestro MCP Setup Wizard

Session ID: ${newSessionId}

## Step 1: Choose a storage path

The macros need a folder to store clipboard data (screenshots, text, etc.).
This folder must be accessible from both:
- The Mac running Keyboard Maestro
- The machine running this MCP server

**Suggested paths:**
${suggestedPaths}

**For multiple machines:** Use a synced folder (iCloud, Dropbox, etc.) so all machines can share data.

**For single machine:** ~/Documents/Keyboard Maestro MCP works well.

## Next step

Call this tool with:
- action: "set_path"
- session_id: "${newSessionId}"
- path: "<your chosen path>"`,
        },
      ],
    };
  }

  // Get or create session (we've already handled "start" above, so we need a session)
  const state = session_id ? wizardStates.get(session_id) : undefined;
  if (!state) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No active wizard session. Call with action="start" to begin a new session.`,
        },
      ],
      isError: true,
    };
  }

  // Handle set_path action
  if (action === "set_path") {
    if (!path) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Please provide a path. Example:\n  path: "~/Documents/Keyboard Maestro MCP"`,
          },
        ],
        isError: true,
      };
    }

    const validation = validatePath(path);
    if (!validation.valid) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid path: ${validation.error}\n\nPlease provide an absolute path starting with / or ~/`,
          },
        ],
        isError: true,
      };
    }

    state.filePath = path;
    state.step = "path";
    wizardStates.set(session_id!, state);

    const expandedPath = expandPath(path);

    return {
      content: [
        {
          type: "text" as const,
          text: `# Path configured

**Storage path:** ${path}
**Expanded:** ${expandedPath}

## Step 2: Generate the macros file

Now generate the .kmmacros file to import into Keyboard Maestro.

Call this tool with:
- action: "generate"
- session_id: "${session_id}"
- output_path: "<where to save the file>"

**Suggested output path:** ~/Downloads/keyboard-maestro-mcp.kmmacros`,
        },
      ],
    };
  }

  // Handle generate action
  if (action === "generate") {
    if (!state.filePath) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Please set a storage path first using action="set_path"`,
          },
        ],
        isError: true,
      };
    }

    const savePath = output_path || join(homedir(), "Downloads", "keyboard-maestro-mcp.kmmacros");
    const expandedSavePath = expandPath(savePath);
    const expandedStoragePath = expandPath(state.filePath);

    // Generate the macros file
    const macrosContent = generateMacrosFile(expandedStoragePath);

    try {
      // Ensure directory exists
      await mkdir(dirname(expandedSavePath), { recursive: true });

      // Write the file
      await writeFile(expandedSavePath, macrosContent, "utf-8");

      state.generatedFile = expandedSavePath;
      state.step = "complete";
      wizardStates.set(session_id!, state);

      return {
        content: [
          {
            type: "text" as const,
            text: `# Macros file generated!

**Saved to:** ${expandedSavePath}

## Step 3: Import into Keyboard Maestro

1. **Create the storage folder** (if it doesn't exist):
   \`\`\`bash
   mkdir -p "${expandedStoragePath}"
   \`\`\`

2. **Import the macros:**
   - Double-click the file: ${expandedSavePath}
   - Or: Open Keyboard Maestro → File → Import Macros

3. **Verify installation:**
   - In Keyboard Maestro, find the "Keyboard Maestro MCP" macro group
   - It should contain two macros:
     - "Set Keyboard Maestro MCP File Path"
     - "Save Clipboard to File"

## Step 4: Configure the MCP server

Add \`outputDir\` and \`saveClipboardMacroUid\` to your machine config:

\`\`\`json
{
  "name": "YourMachine",
  "host": "...",
  "port": 4490,
  "username": "...",
  "password": "...",
  "outputDir": "${expandedStoragePath}",
  "saveClipboardMacroUid": "${SAVE_CLIPBOARD_MACRO_UID}"
}
\`\`\`

## For multiple machines

Repeat steps 2-4 on each Mac:
1. Import the same .kmmacros file
2. Use a shared folder (iCloud, Dropbox) for outputDir so all machines can access clipboard data

Setup complete! Try \`trigger_and_capture\` with a screenshot macro to test.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}\n\nTry a different output_path.`,
          },
        ],
        isError: true,
      };
    }
  }

  // Handle status action
  if (action === "status") {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Wizard Status

**Session ID:** ${session_id}
**Step:** ${state.step}
**Storage path:** ${state.filePath || "(not set)"}
**Generated file:** ${state.generatedFile || "(not generated)"}`,
        },
      ],
    };
  }

  // TypeScript exhaustiveness check - this should never be reached
  const _exhaustiveCheck: never = action;
  return _exhaustiveCheck;
}

// Main server setup
async function main() {
  const machines = getMachines();

  const server = new McpServer({
    name: "keyboard-maestro-mcp",
    version: "0.1.0",
  });

  // UI Resource URI for the interactive config tool
  const configResourceUri = "ui://keyboard-maestro-mcp/config.html";

  // Register the UI resource for MCP Apps-supporting clients
  registerAppResource(
    server,
    configResourceUri,
    configResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      try {
        // Try to load the bundled UI from dist/ui
        const uiPath = join(__dirname, "ui", "config.html");
        const html = await readFile(uiPath, "utf-8");
        return {
          contents: [
            { uri: configResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
          ],
        };
      } catch (error) {
        // Fallback message if UI is not built
        return {
          contents: [
            {
              uri: configResourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: `<!DOCTYPE html>
<html>
<head><title>Keyboard Maestro MCP Config</title></head>
<body style="font-family: sans-serif; padding: 20px; background: #1a1a1a; color: #e0e0e0;">
<h1>Interactive Config Not Available</h1>
<p>The interactive UI is not bundled. Please use the text-based config tool instead:</p>
<pre style="background: #333; padding: 12px; border-radius: 8px;">config with action="start"</pre>
</body>
</html>`,
            },
          ],
        };
      }
    }
  );

  // Register the config tool with UI support
  // On MCP Apps-capable clients (Claude Desktop), this shows an interactive UI
  // On other clients, it still works as a regular tool
  registerAppTool(
    server,
    "config",
    {
      title: "Keyboard Maestro MCP Config",
      description: `Configuration tool for Keyboard Maestro MCP.

This tool helps you:
- Add and manage Keyboard Maestro machines
- Test connections to machines
- Update your MCP client configuration
- Generate and install the required macros`,
      inputSchema: {},
      _meta: { ui: { resourceUri: configResourceUri } },
    },
    async () => {
      const state = await getConfigState();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              _uiDisplayed: true,
              _message: "Interactive configuration UI is now displayed. The user will complete setup through the visual interface.",
              ...state,
            }),
          },
        ],
      };
    }
  );

  // Tool: get_config_state - Get current configuration state
  server.tool(
    "get_config_state",
    "Get the current configuration state for Keyboard Maestro MCP",
    {},
    async () => {
      const state = await getConfigState();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(state),
          },
        ],
      };
    }
  );

  // Tool: test_machine_connection - Test connection to a KM machine
  server.tool(
    "test_machine_connection",
    "Test connection to a Keyboard Maestro machine",
    {
      host: z.string().describe("Hostname or IP address"),
      port: z.number().default(4490).describe("HTTP port (default: 4490)"),
      username: z.string().describe("Web server username"),
      password: z.string().describe("Web server password"),
      secure: z.boolean().optional().describe("Use HTTPS instead of HTTP"),
    },
    async ({ host, port, username, password, secure }) => {
      const result = await testMachineConnection({ host, port, username, password, secure });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    }
  );

  // Tool: update_mcp_config - Update MCP config file with machine definitions
  server.tool(
    "update_mcp_config",
    "Update an MCP client config file with Keyboard Maestro machine definitions",
    {
      configPath: z.string().describe("Path to the MCP config file"),
      machines: z.array(z.object({
        name: z.string(),
        host: z.string(),
        port: z.number(),
        username: z.string(),
        password: z.string(),
        secure: z.boolean().optional(),
      })).describe("Array of machine configurations"),
      storagePath: z.string().describe("Storage path for clipboard files"),
    },
    async ({ configPath, machines, storagePath }) => {
      // Read existing config
      const readResult = await readMcpConfig(configPath);
      if (!readResult.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: readResult.error }),
            },
          ],
        };
      }

      // Generate server config
      const serverConfig = generateServerConfig(
        machines.map((m) => ({ ...m, outputDir: storagePath }))
      );

      // Update config
      const config = readResult.config || {};

      // Handle both Claude Desktop format (mcpServers) and Claude Code format (flat)
      if ("mcpServers" in config || configPath.includes("claude_desktop_config")) {
        // Claude Desktop format
        const mcpServers = (config as { mcpServers?: Record<string, unknown> }).mcpServers || {};
        (config as { mcpServers: Record<string, unknown> }).mcpServers = {
          ...mcpServers,
          "keyboard-maestro": serverConfig,
        };
      } else {
        // Claude Code format (flat)
        (config as Record<string, unknown>)["keyboard-maestro"] = serverConfig;
      }

      // Write config
      const writeResult = await writeMcpConfig(configPath, config);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(writeResult),
          },
        ],
      };
    }
  );

  // Helper tool for the UI to generate macros file and save to Downloads
  server.tool(
    "generate_macros_content",
    "Generate Keyboard Maestro macros file, save to Downloads, and create the storage directory",
    {
      path: z.string().describe("The storage path for clipboard files"),
    },
    async ({ path }) => {
      const validation = validatePath(path);
      if (!validation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: validation.error }),
            },
          ],
          isError: true,
        };
      }

      const expandedPath = expandPath(path);

      // Create the storage directory if it doesn't exist
      try {
        await mkdir(expandedPath, { recursive: true });
      } catch (error) {
        // Ignore errors - directory might already exist or we can't create it
      }

      const macrosContent = generateMacrosFile(expandedPath);

      // Save the file to Downloads
      const downloadsPath = join(homedir(), "Downloads", "keyboard-maestro-mcp.kmmacros");
      try {
        await writeFile(downloadsPath, macrosContent, "utf-8");
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to save file: ${error instanceof Error ? error.message : "Unknown error"}`,
              }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              filePath: downloadsPath,
              storagePath: expandedPath,
              macroUid: SAVE_CLIPBOARD_MACRO_UID,
            }),
          },
        ],
      };
    }
  );

  // Tool: verify_macros_installed - Check if macros are installed on a machine
  server.tool(
    "verify_macros_installed",
    "Check if the Keyboard Maestro MCP macros are installed on configured machines",
    {
      machineName: z.string().optional().describe("Specific machine to check (checks all if not specified)"),
    },
    async ({ machineName }) => {
      const machinesToCheck = machineName
        ? machines.filter((m) => m.name.toLowerCase() === machineName.toLowerCase())
        : machines;

      if (machinesToCheck.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: machineName
                  ? `Machine "${machineName}" not found`
                  : "No machines configured",
              }),
            },
          ],
        };
      }

      const results = await Promise.all(
        machinesToCheck.map(async (machine) => {
          const check = await checkMacroGroupExists(machine);
          return {
            name: machine.name,
            connected: check.exists || check.hasClipboardMacro,
            hasMacroGroup: check.exists,
            hasClipboardMacro: check.hasClipboardMacro,
            clipboardMacroUid: check.clipboardMacroUid,
          };
        })
      );

      const allInstalled = results.every((r) => r.hasClipboardMacro);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              allInstalled,
              machines: results,
            }),
          },
        ],
      };
    }
  );

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
