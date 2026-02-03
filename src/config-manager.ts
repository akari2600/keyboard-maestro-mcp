/**
 * Configuration Manager for Keyboard Maestro MCP
 * Handles machine configuration, testing, and MCP config file updates
 */

import { readFile, writeFile, access } from "fs/promises";
import { constants } from "fs";
import { homedir } from "os";
import { join } from "path";
import { MachineConfig, triggerMacro, listMacros } from "./index.js";
import { SAVE_CLIPBOARD_MACRO_UID, generateMacrosFile, expandPath } from "./macros-template.js";

/**
 * Known MCP config file locations
 */
export const CONFIG_PATHS = {
  claudeDesktop: join(
    homedir(),
    "Library",
    "Application Support",
    "Claude",
    "claude_desktop_config.json"
  ),
  claudeCode: join(homedir(), ".claude", "mcp.json"),
};

/**
 * Test connection to a Keyboard Maestro machine
 */
export async function testMachineConnection(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  macroCount?: number;
  hasMacroGroup?: boolean;
}> {
  const machine: MachineConfig = {
    name: "test",
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    secure: config.secure ?? false,
  };

  try {
    const result = await listMacros(machine);

    if (result.success) {
      // Check if the MCP macro group exists
      const macroGroupCheck = await checkMacroGroupExists(machine);

      return {
        success: true,
        message: `Connected successfully! Found ${result.macros?.length || 0} macros.`,
        macroCount: result.macros?.length || 0,
        hasMacroGroup: macroGroupCheck.exists && macroGroupCheck.hasClipboardMacro,
      };
    } else {
      return {
        success: false,
        message: result.message || "Connection failed",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if the Keyboard Maestro MCP macro group exists on a machine
 */
export async function checkMacroGroupExists(machine: MachineConfig): Promise<{
  exists: boolean;
  hasClipboardMacro: boolean;
  clipboardMacroUid?: string;
}> {
  try {
    const result = await listMacros(machine);

    if (!result.success || !result.macros) {
      return { exists: false, hasClipboardMacro: false };
    }

    const mcpMacros = result.macros.filter(
      (m) => m.group === "Keyboard Maestro MCP"
    );

    const clipboardMacro = mcpMacros.find(
      (m) => m.name === "Save Clipboard to File"
    );

    return {
      exists: mcpMacros.length > 0,
      hasClipboardMacro: !!clipboardMacro,
      clipboardMacroUid: clipboardMacro?.uid,
    };
  } catch {
    return { exists: false, hasClipboardMacro: false };
  }
}

/**
 * Read an MCP config file
 */
export async function readMcpConfig(
  configPath: string
): Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }> {
  try {
    const expanded = expandPath(configPath);
    await access(expanded, constants.R_OK);
    const content = await readFile(expanded, "utf-8");
    const config = JSON.parse(content);
    return { success: true, config };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, config: {} }; // File doesn't exist, start fresh
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to read config",
    };
  }
}

/**
 * Write an MCP config file
 */
export async function writeMcpConfig(
  configPath: string,
  config: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const expanded = expandPath(configPath);
    const content = JSON.stringify(config, null, 2);
    await writeFile(expanded, content, "utf-8");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to write config",
    };
  }
}

/**
 * Generate the MCP server configuration JSON for machines
 */
export function generateServerConfig(
  machines: Array<{
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    secure?: boolean;
    outputDir?: string;
  }>
): Record<string, unknown> {
  const machinesJson = machines.map((m) => ({
    name: m.name,
    host: m.host,
    port: m.port,
    username: m.username,
    password: m.password,
    secure: m.secure ?? false,
    outputDir: m.outputDir,
    saveClipboardMacroUid: SAVE_CLIPBOARD_MACRO_UID,
  }));

  return {
    command: "npx",
    args: ["-y", "keyboard-maestro-mcp"],
    env: {
      KM_MACHINES: JSON.stringify(machinesJson),
    },
  };
}

/**
 * Parse machines from KM_MACHINES environment variable or return empty array
 */
export function parseMachinesFromEnv(): MachineConfig[] {
  const machinesEnv = process.env.KM_MACHINES;
  if (!machinesEnv) {
    // Check for single machine config
    const host = process.env.KM_HOST;
    const username = process.env.KM_USERNAME;
    const password = process.env.KM_PASSWORD;

    if (host && username && password) {
      return [{
        name: process.env.KM_NAME || host,
        host,
        port: parseInt(process.env.KM_PORT || "4490", 10),
        username,
        password,
        secure: process.env.KM_SECURE === "true",
        outputDir: process.env.KM_OUTPUT_DIR,
        saveClipboardMacroUid: process.env.KM_SAVE_CLIPBOARD_MACRO_UID || SAVE_CLIPBOARD_MACRO_UID,
      }];
    }
    return [];
  }

  try {
    const parsed = JSON.parse(machinesEnv);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Configuration state for the wizard
 */
export interface ConfigState {
  mode: "setup" | "manage";
  machines: Array<{
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
    secure: boolean;
    outputDir?: string;
    status?: "untested" | "connected" | "error";
    errorMessage?: string;
    hasMacroGroup?: boolean;
  }>;
  mcpConfigPath?: string;
  macroStoragePath?: string;
  needsMacroSetup: boolean;
}

/**
 * Get the current configuration state
 */
export async function getConfigState(): Promise<ConfigState> {
  const machines = parseMachinesFromEnv();

  if (machines.length === 0) {
    return {
      mode: "setup",
      machines: [],
      needsMacroSetup: true,
    };
  }

  // Check each machine's status and macro group
  const machinesWithStatus = await Promise.all(
    machines.map(async (m) => {
      const testResult = await testMachineConnection(m);
      const macroCheck = testResult.success
        ? await checkMacroGroupExists(m)
        : { exists: false, hasClipboardMacro: false };

      return {
        name: m.name,
        host: m.host,
        port: m.port,
        username: m.username,
        password: m.password,
        secure: m.secure ?? false,
        outputDir: m.outputDir,
        status: testResult.success ? "connected" : "error",
        errorMessage: testResult.success ? undefined : testResult.message,
        hasMacroGroup: macroCheck.hasClipboardMacro,
      } as ConfigState["machines"][0];
    })
  );

  const anyMissingMacros = machinesWithStatus.some(
    (m) => m.status === "connected" && !m.hasMacroGroup
  );

  return {
    mode: "manage",
    machines: machinesWithStatus,
    needsMacroSetup: anyMissingMacros,
  };
}
