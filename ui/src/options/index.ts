import type { ApiKeys, PromptTemplate, ProviderId } from "../app/models.js";
import { el, clearNode, setStyles } from "../app/dom.js";
import { createLayout } from "../app/layout.js";
import { getAll, setAll } from "../app/storage.js";

type TabId = "keys" | "prompts" | "shortcuts";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app root");
}

const layout = createLayout(root, {
  title: "わいるどぱんち Settings",
  showSettingsLink: false,
});

const shell = el("div");
setStyles(shell, { display: "grid", gap: "10px" });

const loading = el("div", { text: "Loading..." });
const errorBanner = el("div");
const savedBanner = el("div");
const tabBar = el("div");
const content = el("div");

setStyles(errorBanner, {
  display: "none",
  background: "#fee",
  border: "1px solid #f99",
  color: "#7f1d1d",
  padding: "8px",
  marginBottom: "8px",
  fontSize: "12px",
});

setStyles(savedBanner, {
  display: "none",
  background: "#efe",
  border: "1px solid #9f9",
  color: "#065f46",
  padding: "8px",
  marginBottom: "8px",
  fontSize: "12px",
});

setStyles(tabBar, {
  display: "flex",
  gap: "16px",
  borderBottom: "1px solid var(--border)",
  marginBottom: "12px",
});

shell.append(errorBanner, savedBanner, tabBar, content);
layout.content.append(loading);

const state: {
  error: string | null;
  saved: string | null;
  tab: TabId;
  apiKeys: ApiKeys;
  prompts: PromptTemplate[];
  defaultPromptId: string | undefined;
  selectedPromptId: string | undefined;
  cacheEnabled: boolean;
  selectionPrefillEnabled: boolean;
  savedTimer: number | null;
} = {
  error: null,
  saved: null,
  tab: "keys",
  apiKeys: {},
  prompts: [],
  defaultPromptId: undefined,
  selectedPromptId: undefined,
  cacheEnabled: true,
  selectionPrefillEnabled: true,
  savedTimer: null,
};

function newId(): string {
  return `p_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function showError(message: string | null): void {
  state.error = message;
  errorBanner.textContent = message ?? "";
  errorBanner.style.display = message ? "block" : "none";
}

function showSaved(message: string | null): void {
  if (state.savedTimer !== null) {
    window.clearTimeout(state.savedTimer);
  }

  state.saved = message;
  savedBanner.textContent = message ?? "";
  savedBanner.style.display = message ? "block" : "none";

  if (message) {
    state.savedTimer = window.setTimeout(() => {
      state.savedTimer = null;
      showSaved(null);
    }, 1500);
  }
}

function persistPrompts(): Promise<void> {
  return setAll({
    prompts: state.prompts,
    defaultPromptId: state.defaultPromptId,
  });
}

function getPromptById(id: string | undefined): PromptTemplate | undefined {
  if (!id) return undefined;
  return state.prompts.find((prompt) => prompt.id === id);
}

function resolveSelectedPrompt(): PromptTemplate | undefined {
  const resolved =
    getPromptById(state.selectedPromptId) ??
    getPromptById(state.defaultPromptId) ??
    state.prompts[0];

  if (!resolved) return undefined;

  if (state.selectedPromptId !== resolved.id) {
    state.selectedPromptId = resolved.id;
  }

  if (!getPromptById(state.defaultPromptId)) {
    state.defaultPromptId = resolved.id;
    void setAll({ defaultPromptId: resolved.id });
  }

  return resolved;
}

async function savePromptPatch(
  promptId: string,
  patch: (prompt: PromptTemplate) => PromptTemplate,
): Promise<void> {
  state.prompts = state.prompts.map((prompt) =>
    prompt.id === promptId ? patch(prompt) : prompt,
  );

  await persistPrompts();
}

function createTabButton(tab: TabId, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  setStyles(button, {
    padding: "8px 2px",
    border: "none",
    borderBottom:
      state.tab === tab ? "2px solid var(--text)" : "2px solid transparent",
    background: "transparent",
    color: state.tab === tab ? "var(--text)" : "var(--muted)",
    fontSize: "12px",
    fontWeight: state.tab === tab ? "600" : "400",
    cursor: "pointer",
    borderRadius: "0",
  });
  button.addEventListener("click", () => {
    state.tab = tab;
    renderTabs();
    renderContent();
  });
  return button;
}

function renderTabs(): void {
  clearNode(tabBar);
  tabBar.append(
    createTabButton("keys", "API Keys"),
    createTabButton("prompts", "Prompts"),
    createTabButton("shortcuts", "Shortcuts"),
  );
}

function createLabeledInput(
  labelText: string,
  inputNode: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): HTMLLabelElement {
  const label = el("label");
  setStyles(label, { fontSize: "12px", display: "grid", gap: "4px" });
  label.append(labelText, inputNode);
  return label;
}

function renderKeysTab(): void {
  clearNode(content);

  const grid = el("div");
  setStyles(grid, { display: "grid", gap: "10px" });

  const openAiInput = document.createElement("input");
  openAiInput.type = "password";
  openAiInput.autocomplete = "off";
  openAiInput.placeholder = "sk-...";
  openAiInput.value = state.apiKeys.openai ?? "";
  openAiInput.addEventListener("input", () => {
    state.apiKeys.openai = openAiInput.value;
  });

  const geminiInput = document.createElement("input");
  geminiInput.type = "password";
  geminiInput.autocomplete = "off";
  geminiInput.placeholder = "AIza...";
  geminiInput.value = state.apiKeys.gemini ?? "";
  geminiInput.addEventListener("input", () => {
    state.apiKeys.gemini = geminiInput.value;
  });

  const claudeInput = document.createElement("input");
  claudeInput.type = "password";
  claudeInput.autocomplete = "off";
  claudeInput.placeholder = "sk-ant-...";
  claudeInput.value = state.apiKeys.claude ?? "";
  claudeInput.addEventListener("input", () => {
    state.apiKeys.claude = claudeInput.value;
  });

  const actions = el("div");
  setStyles(actions, { display: "flex", gap: "8px", alignItems: "center" });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", async () => {
    showError(null);
    showSaved(null);
    try {
      await setAll({ apiKeys: state.apiKeys });
      showSaved("Saved.");
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
  actions.append(saveButton);

  const cacheLabel = el("label");
  setStyles(cacheLabel, {
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  });
  const cacheCheckbox = document.createElement("input");
  cacheCheckbox.type = "checkbox";
  cacheCheckbox.checked = state.cacheEnabled;
  cacheCheckbox.addEventListener("change", async () => {
    state.cacheEnabled = cacheCheckbox.checked;
    try {
      await chrome.storage?.local?.set({ cacheEnabled: state.cacheEnabled });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
  cacheLabel.append(cacheCheckbox, "Cache identical inputs");

  const selectionLabel = el("label");
  setStyles(selectionLabel, {
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  });
  const selectionCheckbox = document.createElement("input");
  selectionCheckbox.type = "checkbox";
  selectionCheckbox.checked = state.selectionPrefillEnabled;
  selectionCheckbox.addEventListener("change", async () => {
    state.selectionPrefillEnabled = selectionCheckbox.checked;
    try {
      await chrome.storage?.local?.set({
        selectionPrefillEnabled: state.selectionPrefillEnabled,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });
  selectionLabel.append(selectionCheckbox, "Prefill input with selected text");

  const note = el("p", {
    html: "Keys are stored in <code>chrome.storage.sync</code> on your browser profile.",
  });
  setStyles(note, { fontSize: "11px", opacity: "0.75", lineHeight: "1.4" });

  grid.append(
    createLabeledInput("OpenAI API Key", openAiInput),
    createLabeledInput("Gemini API Key", geminiInput),
    createLabeledInput("Claude API Key", claudeInput),
    actions,
    cacheLabel,
    selectionLabel,
    note,
  );
  content.append(grid);
}

function renderPromptsTab(): void {
  clearNode(content);

  const grid = el("div");
  setStyles(grid, { display: "grid", gap: "10px" });

  const toolbar = el("div");
  setStyles(toolbar, { display: "flex", gap: "8px", alignItems: "center" });

  const select = document.createElement("select");
  setStyles(select, { flex: "1" });
  for (const prompt of state.prompts) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.name;
    select.append(option);
  }
  select.value = state.selectedPromptId ?? state.prompts[0]?.id ?? "";
  select.addEventListener("change", () => {
    state.selectedPromptId = select.value || undefined;
    renderPromptsTab();
  });

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "Add";
  addButton.addEventListener("click", async () => {
    const prompt: PromptTemplate = {
      id: newId(),
      name: `Prompt ${state.prompts.length + 1}`,
      template: "{{text}}",
      provider: "openai" satisfies ProviderId,
    };

    state.prompts = [prompt, ...state.prompts];
    state.selectedPromptId = prompt.id;
    state.defaultPromptId = prompt.id;

    try {
      await persistPrompts();
      renderPromptsTab();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  toolbar.append(select, addButton);
  grid.append(toolbar);

  const selectedPrompt = resolveSelectedPrompt();
  if (!selectedPrompt) {
    content.append(grid);
    return;
  }
  const selectedPromptId = selectedPrompt.id;
  select.value = selectedPromptId;

  const editor = el("div");
  setStyles(editor, { display: "grid", gap: "8px" });

  const nameInput = document.createElement("input");
  nameInput.value = selectedPrompt.name;
  nameInput.addEventListener("input", () => {
    void savePromptPatch(selectedPromptId, (prompt) => ({
      ...prompt,
      name: nameInput.value,
    })).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
    });
  });

  const providerSelect = document.createElement("select");
  providerSelect.innerHTML = [
    '<option value="openai">OpenAI</option>',
    '<option value="gemini">Gemini</option>',
    '<option value="claude">Claude</option>',
  ].join("");
  providerSelect.value = selectedPrompt.provider ?? "openai";
  providerSelect.addEventListener("change", () => {
    void savePromptPatch(selectedPromptId, (prompt) => ({
      ...prompt,
      provider: providerSelect.value as ProviderId,
    })).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
    });
  });

  const modelInput = document.createElement("input");
  modelInput.value = selectedPrompt.model ?? "";
  modelInput.addEventListener("input", () => {
    const value = modelInput.value || undefined;
    void savePromptPatch(selectedPromptId, (prompt) => ({
      ...prompt,
      model: value,
    })).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
    });
  });

  const apiUrlInput = document.createElement("input");
  apiUrlInput.placeholder = "https://your-proxy.example.com";
  apiUrlInput.value = selectedPrompt.apiUrl ?? "";
  apiUrlInput.addEventListener("input", () => {
    const value = apiUrlInput.value || undefined;
    void savePromptPatch(selectedPromptId, (prompt) => ({
      ...prompt,
      apiUrl: value,
    })).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
    });
  });

  const templateInput = document.createElement("textarea");
  templateInput.rows = 6;
  templateInput.value = selectedPrompt.template;
  templateInput.addEventListener("input", () => {
    void savePromptPatch(selectedPromptId, (prompt) => ({
      ...prompt,
      template: templateInput.value,
    })).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
    });
  });

  const buttons = el("div");
  setStyles(buttons, { display: "flex", gap: "8px", alignItems: "center" });

  const setDefaultButton = document.createElement("button");
  setDefaultButton.type = "button";
  setDefaultButton.textContent = "Set Default";
  setDefaultButton.addEventListener("click", async () => {
    state.defaultPromptId = selectedPromptId;
    try {
      await persistPrompts();
      showSaved("Saved.");
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  const spacer = el("div");
  setStyles(spacer, { flex: "1" });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.className = "btn-danger";
  deleteButton.addEventListener("click", async () => {
    state.prompts = state.prompts.filter((prompt) => prompt.id !== selectedPromptId);
    state.defaultPromptId =
      state.defaultPromptId === selectedPromptId
        ? state.prompts[0]?.id
        : state.defaultPromptId;
    state.selectedPromptId = state.prompts[0]?.id;

    try {
      await persistPrompts();
      renderPromptsTab();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  const note = el("p", {
    text: "The default prompt is used by the popup's Run action.",
  });
  setStyles(note, {
    fontSize: "11px",
    opacity: "0.75",
    lineHeight: "1.4",
    margin: "0",
  });

  buttons.append(setDefaultButton, spacer, deleteButton);

  editor.append(
    createLabeledInput("Name", nameInput),
    createLabeledInput("Provider", providerSelect),
    createLabeledInput("Model (optional)", modelInput),
    createLabeledInput("API URL (optional)", apiUrlInput),
    createLabeledInput("Template (use {{text}})", templateInput),
    buttons,
    note,
  );

  grid.append(editor);
  content.append(grid);
}

function renderShortcutsTab(): void {
  clearNode(content);

  const grid = el("div");
  setStyles(grid, { display: "grid", gap: "10px" });

  const noteA = el("p", {
    html: "Chrome blocks extensions from opening <code>chrome://</code> URLs directly.",
  });
  const noteB = el("p", {
    html: "Open <code>chrome://extensions/shortcuts</code> manually to set the shortcut.",
  });
  for (const note of [noteA, noteB]) {
    setStyles(note, { fontSize: "12px", lineHeight: "1.5", margin: "0" });
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy shortcuts URL";
  setStyles(button, { width: "fit-content" });
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions/shortcuts");
      showSaved("Copied shortcuts URL.");
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  grid.append(noteA, noteB, button);
  content.append(grid);
}

function renderContent(): void {
  if (state.tab === "keys") {
    renderKeysTab();
    return;
  }

  if (state.tab === "prompts") {
    renderPromptsTab();
    return;
  }

  renderShortcutsTab();
}

async function initialize(): Promise<void> {
  try {
    const stored = await getAll();
    state.apiKeys = stored.apiKeys ?? {};
    state.prompts = stored.prompts ?? [];
    const firstPromptId = state.prompts[0]?.id;
    const normalizedDefault =
      getPromptById(stored.defaultPromptId)?.id ?? firstPromptId;
    state.defaultPromptId = normalizedDefault;
    state.selectedPromptId = normalizedDefault;

    try {
      const local = await chrome.storage?.local?.get(["cacheEnabled"]);
      if (typeof local?.cacheEnabled === "boolean") {
        state.cacheEnabled = local.cacheEnabled;
      }
    } catch {
      // ignore
    }

    try {
      const local = await chrome.storage?.local?.get([
        "selectionPrefillEnabled",
      ]);
      if (typeof local?.selectionPrefillEnabled === "boolean") {
        state.selectionPrefillEnabled = local.selectionPrefillEnabled;
      }
    } catch {
      // ignore
    }

    loading.replaceWith(shell);
    renderTabs();
    renderContent();
  } catch (error) {
    loading.replaceWith(shell);
    showError(error instanceof Error ? error.message : String(error));
    renderTabs();
    renderContent();
  }
}

void initialize();
