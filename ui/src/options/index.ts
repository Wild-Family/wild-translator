import type { ApiKeys, PromptTemplate, ProviderId } from "../app/models.js";
import { getAll, setAll } from "../app/storage.js";

type TabId = "keys" | "prompts" | "shortcuts";

type SettingsState = {
  apiKeys: ApiKeys;
  prompts: PromptTemplate[];
  defaultPromptId: string | undefined;
  selectedPromptId: string | undefined;
  cacheEnabled: boolean;
  selectionPrefillEnabled: boolean;
  savedTimer: number | null;
  tab: TabId;
};

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node as T;
}

const loading = requireElement<HTMLDivElement>("loading");
const content = requireElement<HTMLElement>("content");
const errorBanner = requireElement<HTMLDivElement>("error-banner");
const savedBanner = requireElement<HTMLDivElement>("saved-banner");
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
);
const tabPanels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-tab-panel]"),
);

const openAiInput = requireElement<HTMLInputElement>("openai-api-key");
const geminiInput = requireElement<HTMLInputElement>("gemini-api-key");
const claudeInput = requireElement<HTMLInputElement>("claude-api-key");
const saveKeysButton = requireElement<HTMLButtonElement>("keys-save");
const cacheCheckbox = requireElement<HTMLInputElement>("cache-enabled");
const selectionCheckbox = requireElement<HTMLInputElement>(
  "selection-prefill-enabled",
);

const promptSelect = requireElement<HTMLSelectElement>("prompt-select");
const addPromptButton = requireElement<HTMLButtonElement>("prompt-add");
const promptEmpty = requireElement<HTMLParagraphElement>("prompt-empty");
const promptEditor = requireElement<HTMLDivElement>("prompt-editor");
const nameInput = requireElement<HTMLInputElement>("prompt-name");
const providerSelect = requireElement<HTMLSelectElement>("prompt-provider");
const modelInput = requireElement<HTMLInputElement>("prompt-model");
const templateInput = requireElement<HTMLTextAreaElement>("prompt-template");
const setDefaultButton = requireElement<HTMLButtonElement>("prompt-set-default");
const deletePromptButton = requireElement<HTMLButtonElement>("prompt-delete");

const copyShortcutsButton =
  requireElement<HTMLButtonElement>("copy-shortcuts-url");
const themeButton = requireElement<HTMLButtonElement>("theme-button");

const state: SettingsState = {
  apiKeys: {},
  prompts: [],
  defaultPromptId: undefined,
  selectedPromptId: undefined,
  cacheEnabled: true,
  selectionPrefillEnabled: true,
  savedTimer: null,
  tab: "keys",
};

let promptFieldSync = false;
let promptSaveChain: Promise<void> = Promise.resolve();
let themeTouched = false;
let theme: "light" | "dark" = "light";

function newId(): string {
  return `p_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function showError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.hidden = !message;
}

function showSaved(message: string | null): void {
  if (state.savedTimer !== null) {
    window.clearTimeout(state.savedTimer);
  }

  savedBanner.textContent = message ?? "";
  savedBanner.hidden = !message;

  if (message) {
    state.savedTimer = window.setTimeout(() => {
      state.savedTimer = null;
      showSaved(null);
    }, 1500);
  }
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

  if (!resolved) {
    state.selectedPromptId = undefined;
    if (state.defaultPromptId && state.prompts.length === 0) {
      state.defaultPromptId = undefined;
      void setAll({ defaultPromptId: undefined });
    }
    return undefined;
  }

  if (state.selectedPromptId !== resolved.id) {
    state.selectedPromptId = resolved.id;
  }

  if (!getPromptById(state.defaultPromptId)) {
    state.defaultPromptId = resolved.id;
    void setAll({ defaultPromptId: resolved.id });
  }

  return resolved;
}

function queuePromptPersist(): Promise<void> {
  const task = promptSaveChain.catch(() => undefined).then(() =>
    setAll({
      prompts: state.prompts,
      defaultPromptId: state.defaultPromptId,
    }),
  );
  promptSaveChain = task;
  return task;
}

async function savePromptPatch(
  promptId: string,
  patch: (prompt: PromptTemplate) => PromptTemplate,
): Promise<void> {
  state.prompts = state.prompts.map((prompt) =>
    prompt.id === promptId ? patch(prompt) : prompt,
  );
  renderPromptSelect();
  renderPromptEditor();
  await queuePromptPersist();
}

function renderTabs(): void {
  for (const button of tabButtons) {
    const active = button.dataset.tab === state.tab;
    button.setAttribute("aria-selected", String(active));
  }

  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== state.tab;
  }
}

function renderKeys(): void {
  openAiInput.value = state.apiKeys.openai ?? "";
  geminiInput.value = state.apiKeys.gemini ?? "";
  claudeInput.value = state.apiKeys.claude ?? "";
  cacheCheckbox.checked = state.cacheEnabled;
  selectionCheckbox.checked = state.selectionPrefillEnabled;
}

function renderPromptSelect(): void {
  const selectedPrompt = resolveSelectedPrompt();
  const selectedPromptId = selectedPrompt?.id ?? "";

  promptSelect.replaceChildren();
  for (const prompt of state.prompts) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.name;
    promptSelect.append(option);
  }

  promptSelect.disabled = state.prompts.length === 0;
  promptSelect.value = selectedPromptId;
}

function setPromptEditorDisabled(disabled: boolean): void {
  for (const node of [
    promptSelect,
    nameInput,
    providerSelect,
    modelInput,
    templateInput,
    setDefaultButton,
    deletePromptButton,
  ]) {
    node.disabled = disabled;
  }
}

function renderPromptEditor(): void {
  const prompt = resolveSelectedPrompt();
  const hasPrompt = Boolean(prompt);

  promptEmpty.hidden = hasPrompt;
  promptEditor.hidden = !hasPrompt;
  setPromptEditorDisabled(!hasPrompt);

  if (!prompt) {
    promptFieldSync = true;
    nameInput.value = "";
    providerSelect.value = "openai";
    modelInput.value = "";
    templateInput.value = "";
    promptFieldSync = false;
    return;
  }

  promptFieldSync = true;
  promptSelect.value = prompt.id;
  nameInput.value = prompt.name;
  providerSelect.value = prompt.provider ?? "openai";
  modelInput.value = prompt.model ?? "";
  templateInput.value = prompt.template;
  setDefaultButton.disabled = state.defaultPromptId === prompt.id;
  promptFieldSync = false;
}

function renderPrompts(): void {
  renderPromptSelect();
  renderPromptEditor();
}

async function loadTheme(): Promise<"light" | "dark"> {
  try {
    const saved = await chrome.storage?.local?.get(["uiTheme"]);
    return saved?.uiTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(nextTheme: "light" | "dark"): void {
  theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  const label =
    nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  themeButton.textContent = nextTheme === "dark" ? "🌞" : "🌙";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab as TabId | undefined;
    if (!tab) return;
    state.tab = tab;
    renderTabs();
  });
}

openAiInput.addEventListener("input", () => {
  state.apiKeys.openai = openAiInput.value;
});

geminiInput.addEventListener("input", () => {
  state.apiKeys.gemini = geminiInput.value;
});

claudeInput.addEventListener("input", () => {
  state.apiKeys.claude = claudeInput.value;
});

saveKeysButton.addEventListener("click", async () => {
  showError(null);
  showSaved(null);
  try {
    await setAll({ apiKeys: state.apiKeys });
    showSaved("Saved.");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

cacheCheckbox.addEventListener("change", async () => {
  state.cacheEnabled = cacheCheckbox.checked;
  try {
    await chrome.storage?.local?.set({ cacheEnabled: state.cacheEnabled });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

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

promptSelect.addEventListener("change", () => {
  state.selectedPromptId = promptSelect.value || undefined;
  renderPromptEditor();
});

addPromptButton.addEventListener("click", async () => {
  const prompt: PromptTemplate = {
    id: newId(),
    name: `Prompt ${state.prompts.length + 1}`,
    template: "{{text}}",
    provider: "openai" satisfies ProviderId,
  };

  state.prompts = [prompt, ...state.prompts];
  state.selectedPromptId = prompt.id;
  state.defaultPromptId = prompt.id;

  renderPrompts();

  try {
    await queuePromptPersist();
    showSaved("Saved.");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

nameInput.addEventListener("input", () => {
  if (promptFieldSync || !state.selectedPromptId) return;
  void savePromptPatch(state.selectedPromptId, (prompt) => ({
    ...prompt,
    name: nameInput.value,
  })).catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
});

providerSelect.addEventListener("change", () => {
  if (promptFieldSync || !state.selectedPromptId) return;
  void savePromptPatch(state.selectedPromptId, (prompt) => ({
    ...prompt,
    provider: providerSelect.value as ProviderId,
  })).catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
});

modelInput.addEventListener("input", () => {
  if (promptFieldSync || !state.selectedPromptId) return;
  void savePromptPatch(state.selectedPromptId, (prompt) => ({
    ...prompt,
    model: modelInput.value || undefined,
  })).catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
});

templateInput.addEventListener("input", () => {
  if (promptFieldSync || !state.selectedPromptId) return;
  void savePromptPatch(state.selectedPromptId, (prompt) => ({
    ...prompt,
    template: templateInput.value,
  })).catch((error) => {
    showError(error instanceof Error ? error.message : String(error));
  });
});

setDefaultButton.addEventListener("click", async () => {
  const prompt = resolveSelectedPrompt();
  if (!prompt) return;

  state.defaultPromptId = prompt.id;
  renderPromptEditor();

  try {
    await queuePromptPersist();
    showSaved("Saved.");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

deletePromptButton.addEventListener("click", async () => {
  const prompt = resolveSelectedPrompt();
  if (!prompt) return;

  state.prompts = state.prompts.filter((entry) => entry.id !== prompt.id);
  state.defaultPromptId =
    state.defaultPromptId === prompt.id ? state.prompts[0]?.id : state.defaultPromptId;
  state.selectedPromptId = state.prompts[0]?.id;

  renderPrompts();

  try {
    await queuePromptPersist();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

copyShortcutsButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("chrome://extensions/shortcuts");
    showSaved("Copied shortcuts URL.");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

themeButton.addEventListener("click", async () => {
  themeTouched = true;
  const nextTheme = theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    await chrome.storage?.local?.set({ uiTheme: nextTheme });
  } catch {
    // ignore
  }
});

async function initialize(): Promise<void> {
  try {
    const stored = await getAll();
    state.apiKeys = stored.apiKeys ?? {};
    state.prompts = stored.prompts ?? [];
    state.defaultPromptId =
      getPromptById(stored.defaultPromptId)?.id ?? state.prompts[0]?.id;
    state.selectedPromptId = state.defaultPromptId;

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

    renderKeys();
    renderPrompts();
    renderTabs();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    renderKeys();
    renderPrompts();
    renderTabs();
  } finally {
    const nextTheme = await loadTheme();
    if (!themeTouched) {
      applyTheme(nextTheme);
    }
    loading.hidden = true;
    content.hidden = false;
  }
}

void initialize();
