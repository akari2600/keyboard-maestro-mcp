#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Machine configuration schema
interface MachineConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
}

// Parse machine configuration from environment
function getMachines(): MachineConfig[] {
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
    }));
  } catch (e) {
    console.error("Failed to parse KM_MACHINES:", e);
    return [];
  }
}

// Build the base URL for a machine
function getBaseUrl(machine: MachineConfig): string {
  const protocol = machine.secure ? "https" : "http";
  const port = machine.secure ? machine.port + 1 : machine.port;
  return `${protocol}://${machine.host}:${port}`;
}

// Build Basic Auth header
function getAuthHeader(machine: MachineConfig): string {
  const credentials = Buffer.from(
    `${machine.username}:${machine.password}`
  ).toString("base64");
  return `Basic ${credentials}`;
}

// Find a machine by name (case-insensitive)
function findMachine(
  machines: MachineConfig[],
  name?: string
): MachineConfig | undefined {
  if (!name) {
    return machines[0];
  }
  return machines.find((m) => m.name.toLowerCase() === name.toLowerCase());
}

// Trigger a macro on a machine
async function triggerMacro(
  machine: MachineConfig,
  macro: string,
  value?: string
): Promise<{ success: boolean; message: string }> {
  const baseUrl = getBaseUrl(machine);
  const params = new URLSearchParams({ macro });
  if (value) {
    params.set("value", value);
  }

  const url = `${baseUrl}/action.html?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(machine),
      },
    });

    if (response.ok) {
      return {
        success: true,
        message: `Macro "${macro}" triggered successfully on ${machine.name}`,
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

  // Tool: trigger_macro
  server.tool(
    "trigger_macro",
    "Trigger a Keyboard Maestro macro by name or UUID",
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

      return {
        content: [
          {
            type: "text" as const,
            text: result.message,
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

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
