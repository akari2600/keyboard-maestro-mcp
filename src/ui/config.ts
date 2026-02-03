import { App } from "@modelcontextprotocol/ext-apps";

// Types
interface MachineConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secure?: boolean;
  outputDir?: string;
  status?: "untested" | "connected" | "error";
  errorMessage?: string;
  hasMacroGroup?: boolean;
}

interface ConfigState {
  mode: "setup" | "manage";
  machines: MachineConfig[];
  mcpConfigPath?: string;
  macroStoragePath?: string;
  needsMacroSetup: boolean;
}

// DOM Elements
const loadingView = document.getElementById("loading-view")!;
const setupView = document.getElementById("setup-view")!;
const manageView = document.getElementById("manage-view")!;

// Setup wizard elements
const setupSteps = [1, 2, 3, 4].map((n) => document.getElementById(`setup-step-${n}`)!);
const stepIndicators = [1, 2, 3, 4].map((n) => document.getElementById(`step-${n}`)!);

// Initialize MCP App
const app = new App({ name: "Keyboard Maestro MCP Config", version: "1.0.0" });
app.connect();

// State
let state: ConfigState = {
  mode: "setup",
  machines: [],
  needsMacroSetup: true,
};
let pendingMachines: MachineConfig[] = [];
let currentStep = 1;
let editingMachineIndex = -1;

// Utility functions
function showView(view: "loading" | "setup" | "manage") {
  loadingView.classList.toggle("hidden", view !== "loading");
  setupView.classList.toggle("hidden", view !== "setup");
  manageView.classList.toggle("hidden", view !== "manage");
}

function showSetupStep(step: number) {
  currentStep = step;
  setupSteps.forEach((el, i) => el.classList.toggle("hidden", i !== step - 1));
  stepIndicators.forEach((el, i) => {
    el.classList.remove("active", "complete");
    if (i < step - 1) el.classList.add("complete");
    else if (i === step - 1) el.classList.add("active");
  });
}

function showAlert(container: HTMLElement, type: "success" | "error" | "info" | "warning", message: string) {
  container.className = `alert alert-${type}`;
  container.textContent = message;
  container.classList.remove("hidden");
}

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await app.callServerTool({ name, arguments: args });
  const textContent = result.content?.find((c) => c.type === "text");
  const text = textContent && "text" in textContent ? textContent.text : undefined;
  return text ? JSON.parse(text) : null;
}

// Machine list rendering
function renderMachineList(machines: MachineConfig[], containerId: string, isManageView = false) {
  const container = document.getElementById(containerId)!;
  container.innerHTML = "";

  machines.forEach((machine, index) => {
    const div = document.createElement("div");
    div.className = "machine-item";

    const statusBadge = machine.status === "connected"
      ? '<span class="badge badge-success">Connected</span>'
      : machine.status === "error"
      ? '<span class="badge badge-error">Error</span>'
      : '<span class="badge badge-warning">Untested</span>';

    const macroStatus = machine.hasMacroGroup
      ? ''
      : machine.status === "connected"
      ? '<span class="badge badge-warning" style="margin-left: 4px;">No Macros</span>'
      : '';

    div.innerHTML = `
      <div class="machine-info">
        <div>
          <div class="machine-name">${machine.name}</div>
          <div class="machine-host">${machine.host}:${machine.port}</div>
        </div>
        <div>${statusBadge}${macroStatus}</div>
      </div>
      <div class="machine-actions">
        ${isManageView ? `<button class="btn btn-sm btn-secondary edit-machine-btn" data-index="${index}">Edit</button>` : ''}
        ${!isManageView ? `<button class="btn btn-sm btn-danger remove-machine-btn" data-index="${index}">Remove</button>` : ''}
      </div>
    `;

    container.appendChild(div);
  });

  // Attach event listeners
  container.querySelectorAll(".remove-machine-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index!, 10);
      pendingMachines.splice(index, 1);
      renderMachineList(pendingMachines, containerId);
      updateAddedMachinesVisibility();
    });
  });

  container.querySelectorAll(".edit-machine-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index!, 10);
      openEditModal(index);
    });
  });
}

function updateAddedMachinesVisibility() {
  const container = document.getElementById("added-machines")!;
  container.classList.toggle("hidden", pendingMachines.length === 0);
}

// Config JSON generation
function generateConfigJson(machines: MachineConfig[], storagePath: string): string {
  const machinesConfig = machines.map((m) => ({
    name: m.name,
    host: m.host,
    port: m.port,
    username: m.username,
    password: m.password,
    outputDir: storagePath,
    saveClipboardMacroUid: "37EE527B-036A-42FC-B341-DFFF8D5AAA8A",
  }));

  return JSON.stringify({
    command: "npx",
    args: ["-y", "keyboard-maestro-mcp"],
    env: {
      KM_MACHINES: JSON.stringify(machinesConfig),
    },
  }, null, 2);
}

// Edit modal
function openEditModal(index: number) {
  editingMachineIndex = index;
  const machine = state.machines[index];

  (document.getElementById("edit-machine-name") as HTMLInputElement).value = machine.name;
  (document.getElementById("edit-machine-host") as HTMLInputElement).value = machine.host;
  (document.getElementById("edit-machine-port") as HTMLInputElement).value = String(machine.port);
  (document.getElementById("edit-machine-username") as HTMLInputElement).value = machine.username;
  (document.getElementById("edit-machine-password") as HTMLInputElement).value = machine.password;

  document.getElementById("edit-test-result")!.classList.add("hidden");
  document.getElementById("edit-modal")!.classList.remove("hidden");
}

function closeEditModal() {
  document.getElementById("edit-modal")!.classList.add("hidden");
  editingMachineIndex = -1;
}

// Initialize
async function init() {
  showView("loading");

  try {
    // Get current configuration state from server
    const result = await callTool("get_config_state", {});

    if (result) {
      state = result;
      pendingMachines = [...state.machines];

      if (state.mode === "manage" && state.machines.length > 0) {
        showView("manage");
        renderManageView();
      } else {
        showView("setup");
        showSetupStep(1);
      }
    } else {
      showView("setup");
      showSetupStep(1);
    }
  } catch (error) {
    console.error("Failed to load config:", error);
    showView("setup");
    showSetupStep(1);
  }
}

function renderManageView() {
  renderMachineList(state.machines, "manage-machine-list", true);

  const noMachines = document.getElementById("no-machines")!;
  noMachines.classList.toggle("hidden", state.machines.length > 0);

  // Macro status
  const macroStatus = document.getElementById("macro-status")!;
  const machinesWithMacros = state.machines.filter((m) => m.hasMacroGroup);
  const machinesWithoutMacros = state.machines.filter((m) => m.status === "connected" && !m.hasMacroGroup);

  if (machinesWithoutMacros.length > 0) {
    macroStatus.innerHTML = `<div class="alert alert-warning">
      ${machinesWithoutMacros.length} machine(s) missing macro group: ${machinesWithoutMacros.map((m) => m.name).join(", ")}
    </div>`;
  } else if (machinesWithMacros.length > 0) {
    macroStatus.innerHTML = `<div class="alert alert-success">
      Macro group installed on ${machinesWithMacros.length} machine(s)
    </div>`;
  } else {
    macroStatus.innerHTML = `<div class="alert alert-info">
      Connect to machines to check macro status
    </div>`;
  }

  // Storage path
  const storageInput = document.getElementById("manage-storage-path") as HTMLInputElement;
  if (state.macroStoragePath) {
    storageInput.value = state.macroStoragePath;
  } else if (state.machines[0]?.outputDir) {
    storageInput.value = state.machines[0].outputDir;
  }
}

// Event Listeners - Setup Step 1
document.getElementById("setup-start-btn")!.addEventListener("click", () => {
  showSetupStep(2);
});

// Event Listeners - Setup Step 2 (Add Machine)
const testResultEl = document.getElementById("test-result")!;
const addMachineBtn = document.getElementById("add-machine-btn") as HTMLButtonElement;

document.getElementById("test-connection-btn")!.addEventListener("click", async () => {
  const host = (document.getElementById("machine-host") as HTMLInputElement).value;
  const port = parseInt((document.getElementById("machine-port") as HTMLInputElement).value, 10);
  const username = (document.getElementById("machine-username") as HTMLInputElement).value;
  const password = (document.getElementById("machine-password") as HTMLInputElement).value;

  if (!host || !username || !password) {
    showAlert(testResultEl, "error", "Please fill in all fields");
    return;
  }

  testResultEl.innerHTML = '<div class="loading"></div> Testing connection...';
  testResultEl.className = "alert alert-info";
  testResultEl.classList.remove("hidden");

  try {
    const result = await callTool("test_machine_connection", { host, port, username, password });

    if (result.success) {
      showAlert(testResultEl, "success", result.message);
      addMachineBtn.disabled = false;
    } else {
      showAlert(testResultEl, "error", result.message);
      addMachineBtn.disabled = true;
    }
  } catch (error) {
    showAlert(testResultEl, "error", "Failed to test connection");
    addMachineBtn.disabled = true;
  }
});

document.getElementById("add-machine-btn")!.addEventListener("click", () => {
  const name = (document.getElementById("machine-name") as HTMLInputElement).value || "Unnamed";
  const host = (document.getElementById("machine-host") as HTMLInputElement).value;
  const port = parseInt((document.getElementById("machine-port") as HTMLInputElement).value, 10);
  const username = (document.getElementById("machine-username") as HTMLInputElement).value;
  const password = (document.getElementById("machine-password") as HTMLInputElement).value;

  pendingMachines.push({
    name,
    host,
    port,
    username,
    password,
    status: "connected",
  });

  // Clear form
  (document.getElementById("machine-name") as HTMLInputElement).value = "";
  (document.getElementById("machine-host") as HTMLInputElement).value = "";
  (document.getElementById("machine-port") as HTMLInputElement).value = "4490";
  (document.getElementById("machine-username") as HTMLInputElement).value = "";
  (document.getElementById("machine-password") as HTMLInputElement).value = "";
  testResultEl.classList.add("hidden");
  addMachineBtn.disabled = true;

  renderMachineList(pendingMachines, "machine-list");
  updateAddedMachinesVisibility();
});

document.getElementById("add-another-btn")!.addEventListener("click", () => {
  // Just scroll up to the form
  document.getElementById("machine-name")!.focus();
});

document.getElementById("continue-to-config-btn")!.addEventListener("click", () => {
  if (pendingMachines.length === 0) return;
  showSetupStep(3); // Go to macros step
});

// Event Listeners - Setup Step 3 (Macros)
const storagePathInput = document.getElementById("storage-path") as HTMLInputElement;
const macroResult = document.getElementById("macro-result")!;
const importInstructions = document.getElementById("import-instructions")!;
const verifyResult = document.getElementById("verify-result")!;

// Storage path buttons
document.querySelectorAll("[data-storage-path]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    storagePathInput.value = (e.target as HTMLElement).dataset.storagePath!;
  });
});

document.getElementById("generate-macros-btn")!.addEventListener("click", async () => {
  const path = storagePathInput.value;
  if (!path) {
    showAlert(macroResult, "error", "Please enter a storage path");
    return;
  }

  macroResult.innerHTML = '<div class="loading"></div> Generating macros...';
  macroResult.className = "alert alert-info";
  macroResult.classList.remove("hidden");

  try {
    const result = await callTool("generate_macros_content", { path });

    if (result.error) {
      showAlert(macroResult, "error", result.error);
      return;
    }

    if (result.success && result.filePath) {
      showAlert(macroResult, "success", `Macros file saved to: ${result.filePath}`);
      importInstructions.classList.remove("hidden");
    } else {
      showAlert(macroResult, "error", "Failed to generate macros file");
    }
  } catch (error) {
    showAlert(macroResult, "error", `Failed to generate macros: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
});

// Verify import button - uses pending machines' credentials
document.getElementById("verify-import-btn")!.addEventListener("click", async () => {
  if (pendingMachines.length === 0) {
    showAlert(verifyResult, "error", "No machines configured");
    return;
  }

  verifyResult.innerHTML = '<div class="loading"></div> Checking for macros...';
  verifyResult.className = "alert alert-info";
  verifyResult.classList.remove("hidden");

  try {
    // Test each pending machine's connection and check for macros
    const results = await Promise.all(
      pendingMachines.map(async (machine) => {
        const result = await callTool("test_machine_connection", {
          host: machine.host,
          port: machine.port,
          username: machine.username,
          password: machine.password,
        });
        return { name: machine.name, ...result };
      })
    );

    const allHaveMacros = results.every((r) => r.success && r.hasMacroGroup);
    const machinesWithMacros = results.filter((r) => r.success && r.hasMacroGroup);
    const machinesWithoutMacros = results.filter((r) => r.success && !r.hasMacroGroup);

    if (allHaveMacros) {
      showAlert(verifyResult, "success", `Macros verified on ${machinesWithMacros.length} machine(s)!`);
    } else if (machinesWithoutMacros.length > 0) {
      showAlert(verifyResult, "warning", `Macros not found on: ${machinesWithoutMacros.map((m) => m.name).join(", ")}. Please import and enable the macros.`);
    } else {
      showAlert(verifyResult, "error", "Could not verify macros. Check connection.");
    }
  } catch (error) {
    showAlert(verifyResult, "error", "Failed to verify macros");
  }
});

// Continue to config step
document.getElementById("continue-to-config-btn-step3")!.addEventListener("click", () => {
  showSetupStep(4);
});

// Event Listeners - Setup Step 4 (MCP Config)
const configPathInput = document.getElementById("config-path") as HTMLInputElement;
const configPreview = document.getElementById("config-preview")!;
const configJsonContent = document.getElementById("config-json-content")!;
const configResult = document.getElementById("config-result")!;
const finishCard = document.getElementById("finish-card")!;

// Config path buttons
document.querySelectorAll("[data-config-path]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const path = (e.target as HTMLElement).dataset.configPath;
    if (path === "claude-desktop") {
      configPathInput.value = "~/Library/Application Support/Claude/claude_desktop_config.json";
    } else if (path === "claude-code") {
      configPathInput.value = "~/.claude/mcp.json";
    }
  });
});

document.getElementById("show-json-btn")!.addEventListener("click", () => {
  const storagePath = storagePathInput.value || "~/Documents/Keyboard Maestro MCP";
  const json = generateConfigJson(pendingMachines, storagePath);
  configJsonContent.textContent = json;
  configPreview.classList.remove("hidden");
});

document.getElementById("copy-config-btn")!.addEventListener("click", async () => {
  const json = configJsonContent.textContent!;
  await navigator.clipboard.writeText(json);
  showAlert(configResult, "success", "Copied to clipboard!");
});

document.getElementById("update-config-btn")!.addEventListener("click", async () => {
  const configPath = configPathInput.value;
  if (!configPath) {
    showAlert(configResult, "error", "Please enter a config file path");
    return;
  }

  const storagePath = storagePathInput.value || "~/Documents/Keyboard Maestro MCP";

  try {
    const result = await callTool("update_mcp_config", {
      configPath,
      machines: pendingMachines,
      storagePath,
    });

    if (result.success) {
      showAlert(configResult, "success", "Config file updated!");
      finishCard.classList.remove("hidden");
    } else {
      showAlert(configResult, "error", result.error || "Failed to update config");
      // Show JSON as fallback
      const json = generateConfigJson(pendingMachines, storagePath);
      configJsonContent.textContent = json;
      configPreview.classList.remove("hidden");
    }
  } catch (error) {
    showAlert(configResult, "error", "Failed to update config file");
    // Show JSON as fallback
    const json = generateConfigJson(pendingMachines, storagePath);
    configJsonContent.textContent = json;
    configPreview.classList.remove("hidden");
  }
});

document.getElementById("finish-setup-btn")!.addEventListener("click", () => {
  app.updateModelContext({
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "complete",
        machines: pendingMachines.map((m) => m.name),
        message: "Setup complete! User should restart their MCP client.",
      }),
    }],
  });
});

// Event Listeners - Manage View
document.getElementById("add-machine-manage-btn")!.addEventListener("click", () => {
  showView("setup");
  showSetupStep(2);
});

document.getElementById("setup-first-machine-btn")!.addEventListener("click", () => {
  showView("setup");
  showSetupStep(1);
});

document.getElementById("regenerate-macros-btn")!.addEventListener("click", async () => {
  const path = (document.getElementById("manage-storage-path") as HTMLInputElement).value;
  const warning = document.getElementById("regenerate-warning")!;
  const resultEl = document.getElementById("macro-status")!;

  if (!path) {
    return;
  }

  resultEl.innerHTML = '<div class="alert alert-info"><div class="loading"></div> Generating macros...</div>';

  try {
    const result = await callTool("generate_macros_content", { path });

    if (result.error) {
      resultEl.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      return;
    }

    if (result.success && result.filePath) {
      resultEl.innerHTML = `<div class="alert alert-success">Macros file saved to: ${result.filePath}</div>`;
      warning.classList.remove("hidden");
    } else {
      resultEl.innerHTML = '<div class="alert alert-error">Failed to generate macros file</div>';
    }
  } catch (error) {
    console.error("Failed to regenerate macros:", error);
    resultEl.innerHTML = '<div class="alert alert-error">Failed to regenerate macros</div>';
  }
});

// Edit Modal Event Listeners
document.getElementById("edit-cancel-btn")!.addEventListener("click", closeEditModal);

document.getElementById("edit-test-btn")!.addEventListener("click", async () => {
  const host = (document.getElementById("edit-machine-host") as HTMLInputElement).value;
  const port = parseInt((document.getElementById("edit-machine-port") as HTMLInputElement).value, 10);
  const username = (document.getElementById("edit-machine-username") as HTMLInputElement).value;
  const password = (document.getElementById("edit-machine-password") as HTMLInputElement).value;

  const resultEl = document.getElementById("edit-test-result")!;
  resultEl.innerHTML = '<div class="loading"></div> Testing...';
  resultEl.className = "alert alert-info";
  resultEl.classList.remove("hidden");

  try {
    const result = await callTool("test_machine_connection", { host, port, username, password });
    showAlert(resultEl, result.success ? "success" : "error", result.message);
  } catch {
    showAlert(resultEl, "error", "Connection test failed");
  }
});

document.getElementById("edit-save-btn")!.addEventListener("click", async () => {
  if (editingMachineIndex < 0) return;

  state.machines[editingMachineIndex] = {
    ...state.machines[editingMachineIndex],
    name: (document.getElementById("edit-machine-name") as HTMLInputElement).value,
    host: (document.getElementById("edit-machine-host") as HTMLInputElement).value,
    port: parseInt((document.getElementById("edit-machine-port") as HTMLInputElement).value, 10),
    username: (document.getElementById("edit-machine-username") as HTMLInputElement).value,
    password: (document.getElementById("edit-machine-password") as HTMLInputElement).value,
  };

  closeEditModal();
  renderManageView();

  // Notify about needing to update config
  app.updateModelContext({
    content: [{
      type: "text",
      text: JSON.stringify({
        action: "machine_updated",
        machine: state.machines[editingMachineIndex].name,
        message: "Machine configuration updated. User needs to update their MCP config file.",
      }),
    }],
  });
});

document.getElementById("edit-delete-btn")!.addEventListener("click", () => {
  if (editingMachineIndex < 0) return;

  const name = state.machines[editingMachineIndex].name;
  state.machines.splice(editingMachineIndex, 1);

  closeEditModal();
  renderManageView();

  app.updateModelContext({
    content: [{
      type: "text",
      text: JSON.stringify({
        action: "machine_deleted",
        machine: name,
        message: "Machine deleted. User needs to update their MCP config file.",
      }),
    }],
  });
});

// Handle initial tool result
app.ontoolresult = (result) => {
  const textContent = result.content?.find((c) => c.type === "text");
  const text = textContent && "text" in textContent ? textContent.text : undefined;
  if (text) {
    try {
      const data = JSON.parse(text);
      if (data.mode) {
        state = data;
        pendingMachines = [...state.machines];
        if (state.mode === "manage" && state.machines.length > 0) {
          showView("manage");
          renderManageView();
        } else {
          showView("setup");
          showSetupStep(1);
        }
      }
    } catch {
      // Not JSON state, ignore
    }
  }
};

// Start
init();
