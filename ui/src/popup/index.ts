import type { PromptTemplate } from "../app/models.js";
import { getAll, setAll } from "../app/storage.js";

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id} element`);
  }
  return node as T;
}

const loading = requireElement<HTMLDivElement>("popup-loading");
const main = requireElement<HTMLElement>("popup-shell");
const errorBanner = requireElement<HTMLDivElement>("popup-error");
const promptSelect = requireElement<HTMLSelectElement>("popup-prompt-select");
const input = requireElement<HTMLTextAreaElement>("popup-input");
const runButton = requireElement<HTMLButtonElement>("popup-run");
const output = requireElement<HTMLDivElement>("popup-output");
const settingsButton = requireElement<HTMLButtonElement>("popup-settings");
const themeButton = requireElement<HTMLButtonElement>("popup-theme");

let prompts: PromptTemplate[] = [];
let defaultPromptId: string | undefined;
let inputText = "";
let outputText = "";
let busy = false;
let saveTimer: number | null = null;
let runSeq = 0;
let themeTouched = false;
let theme: "light" | "dark" = "light";

type ActiveRun = {
  token: number;
  port: chrome.runtime.Port;
  disconnectExpected: boolean;
};

let activeRun: ActiveRun | null = null;

function setError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.hidden = !message;
}

function resolvePromptId(candidate: string | undefined): string | undefined {
  if (!prompts.length) return undefined;
  if (candidate && prompts.some((prompt) => prompt.id === candidate)) {
    return candidate;
  }
  return prompts[0]?.id;
}

function renderPromptOptions(): void {
  defaultPromptId = resolvePromptId(defaultPromptId);
  promptSelect.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const prompt of prompts) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.name;
    fragment.append(option);
  }

  promptSelect.append(fragment);
  promptSelect.value = defaultPromptId ?? "";
  promptSelect.disabled = prompts.length === 0;
}

function scheduleDraftSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    void chrome.storage?.local?.set({
      popupDraft: {
        input: inputText,
        output: outputText,
        promptId: resolvePromptId(defaultPromptId),
      },
    });
  }, 250);
}

function updateOutput(): void {
  output.textContent = stripMarkdown(outputText) || "Output";
}

function updateBusy(nextBusy: boolean): void {
  busy = nextBusy;
  runButton.textContent = nextBusy ? "Stop" : "Run";
  runButton.classList.toggle("btn-danger", nextBusy);
}

function applyTheme(nextTheme: "light" | "dark"): void {
  theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  themeButton.textContent = nextTheme === "dark" ? "🌞" : "🌙";
  const label =
    nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
}

async function getTheme(): Promise<"light" | "dark"> {
  try {
    const result = await chrome.storage?.local?.get(["uiTheme"]);
    return result?.uiTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function openSettingsPage(): void {
  const runtime = chrome?.runtime;
  if (runtime?.openOptionsPage) {
    runtime.openOptionsPage();
    return;
  }

  const url = runtime?.getURL?.("ui/options/index.html");
  if (url) {
    window.open(url, "_blank", "noopener");
  }
}

async function stop(): Promise<void> {
  const currentRun = activeRun;
  if (!currentRun) {
    updateBusy(false);
    return;
  }

  currentRun.disconnectExpected = true;
  try {
    currentRun.port.disconnect();
  } catch {
    // ignore
  }

  if (activeRun?.token === currentRun.token) {
    activeRun = null;
  }
  updateBusy(false);
}

async function run(): Promise<void> {
  const token = ++runSeq;
  const nextPromptId = resolvePromptId(defaultPromptId);

  setError(null);
  updateBusy(true);
  outputText = "";
  updateOutput();
  scheduleDraftSave();

  try {
    const nextPort = chrome.runtime.connect({ name: "wild:generate" });
    const runState: ActiveRun = {
      token,
      port: nextPort,
      disconnectExpected: false,
    };
    activeRun = runState;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      nextPort.onDisconnect.addListener(() => {
        if (settled) return;
        if (runState.disconnectExpected) {
          settle(resolve);
          return;
        }
        settle(() => {
          reject(new Error("Generation disconnected unexpectedly."));
        });
      });

      nextPort.onMessage.addListener((message: any) => {
        if (settled) return;
        if (message?.type === "STREAM_DELTA") {
          if (activeRun?.token !== token) return;
          outputText += String(message.delta ?? "");
          updateOutput();
          scheduleDraftSave();
        }
        if (message?.type === "STREAM_ERROR") {
          runState.disconnectExpected = true;
          try {
            nextPort.disconnect();
          } catch {
            // ignore
          }
          settle(() => {
            reject(new Error(String(message.error ?? "Stream error")));
          });
        }
        if (message?.type === "STREAM_END") {
          runState.disconnectExpected = true;
          try {
            nextPort.disconnect();
          } catch {
            // ignore
          }
          settle(resolve);
        }
      });

      nextPort.postMessage({
        type: "GENERATE_STREAM",
        inputText,
        promptId: nextPromptId,
      });
    });
  } catch (error) {
    if (activeRun?.token === token) {
      setError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (activeRun?.token === token) {
      activeRun = null;
      updateBusy(false);
    }
  }
}

promptSelect.addEventListener("change", () => {
  defaultPromptId = resolvePromptId(promptSelect.value || undefined);
  promptSelect.value = defaultPromptId ?? "";
  scheduleDraftSave();
  void setAll({ defaultPromptId });
});

input.addEventListener("input", () => {
  inputText = input.value;
  scheduleDraftSave();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!busy && inputText.trim()) {
      void run();
    }
  }

  if (event.key === "Escape" && busy) {
    event.preventDefault();
    void stop();
  }
});

runButton.addEventListener("click", () => {
  if (busy) {
    void stop();
    return;
  }
  if (inputText.trim()) {
    void run();
  }
});

settingsButton.addEventListener("click", () => {
  openSettingsPage();
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
    const state = await getAll();
    prompts = state.prompts;
    defaultPromptId = resolvePromptId(state.defaultPromptId);
    renderPromptOptions();

    try {
      const store = chrome.storage?.session ?? chrome.storage?.local;
      const prefs = await chrome.storage?.local?.get(["selectionPrefillEnabled"]);
      const selectionPrefillEnabled = prefs?.selectionPrefillEnabled !== false;
      let hasSelectionDraft = false;

      if (!selectionPrefillEnabled) {
        await store?.remove(["draftText"]);
      } else {
        const draft = store ? await store.get(["draftText"]) : {};
        hasSelectionDraft = Object.prototype.hasOwnProperty.call(
          draft,
          "draftText",
        );
        const text = draft?.draftText;
        if (typeof text === "string") {
          inputText = text;
          input.value = text;
          outputText = "";
          if (text.trim()) {
            window.requestAnimationFrame(() => {
              const end = input.value.length;
              input.focus();
              input.setSelectionRange(end, end);
            });
          }
        }
        await store?.remove(["draftText"]);
      }

      if (!hasSelectionDraft && !inputText.trim()) {
        const savedDraft = await chrome.storage?.local?.get(["popupDraft"]);
        const saved = savedDraft?.popupDraft;
        if (saved?.input) {
          inputText = saved.input;
          input.value = saved.input;
        }
        if (saved?.output) {
          outputText = saved.output;
        }
        if (saved?.promptId) {
          defaultPromptId = resolvePromptId(saved.promptId);
        }
      }
    } catch {
      // ignore
    }

    renderPromptOptions();
    updateOutput();
    const nextTheme = await getTheme();
    if (!themeTouched) {
      applyTheme(nextTheme);
    }
    loading.hidden = true;
    main.classList.remove("is-hidden");

    window.requestAnimationFrame(() => {
      input.focus();
      if (!inputText) {
        input.setSelectionRange(0, 0);
      }
    });
  } catch (error) {
    loading.hidden = true;
    setError(error instanceof Error ? error.message : String(error));
  }
}

void initialize();
