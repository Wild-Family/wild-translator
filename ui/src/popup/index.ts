import type { PromptTemplate } from "../app/models.js";
import { el, setStyles } from "../app/dom.js";
import { createLayout } from "../app/layout.js";
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

function applyPopupWindowSize(): void {
  const width = 520;
  const height = 720;
  for (const node of [document.documentElement, document.body]) {
    if (!node) continue;
    node.style.width = `${width}px`;
    node.style.minWidth = `${width}px`;
    node.style.height = `${height}px`;
    node.style.minHeight = `${height}px`;
  }
}

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app root");
}

applyPopupWindowSize();

const layout = createLayout(root, { title: "わいるどぱんち" });
const shell = el("div");
setStyles(shell, { display: "grid", gap: "8px" });

const loading = el("div", { text: "Loading..." });
const errorBanner = el("div");
setStyles(errorBanner, {
  display: "none",
  background: "#fee",
  border: "1px solid #f99",
  color: "#7f1d1d",
  padding: "8px",
  marginBottom: "8px",
  fontSize: "12px",
});

const toolbar = el("div");
setStyles(toolbar, {
  display: "flex",
  gap: "8px",
  marginBottom: "8px",
  alignItems: "center",
});

const promptSelect = document.createElement("select");
setStyles(promptSelect, { flex: "1" });

const form = el("div");
setStyles(form, { display: "grid", gap: "8px" });

const input = document.createElement("textarea");
input.placeholder = "Input";
input.rows = 7;
setStyles(input, { width: "100%", resize: "vertical" });

const actions = el("div");
setStyles(actions, { display: "flex", gap: "8px" });

const runButton = document.createElement("button");
runButton.type = "button";
runButton.textContent = "Run";

const output = el("div", { text: "Output" });
setStyles(output, {
  border: "1px solid var(--border)",
  background: "var(--surface)",
  borderRadius: "8px",
  padding: "10px",
  minHeight: "220px",
  whiteSpace: "pre-wrap",
  lineHeight: "1.5",
  overflowY: "auto",
});

actions.append(runButton);
toolbar.append(promptSelect);
form.append(input, actions, output);
shell.append(errorBanner, toolbar, form);
layout.content.append(loading);

let prompts: PromptTemplate[] = [];
let defaultPromptId: string | undefined;
let inputText = "";
let outputText = "";
let busy = false;
let port: chrome.runtime.Port | null = null;
let saveTimer: number | null = null;
let runSeq = 0;

type ActiveRun = {
  token: number;
  port: chrome.runtime.Port;
  disconnectExpected: boolean;
};

let activeRun: ActiveRun | null = null;

function setError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.style.display = message ? "block" : "none";
}

function resolvePromptId(candidate: string | undefined): string | undefined {
  if (!prompts.length) return undefined;
  if (candidate && prompts.some((prompt) => prompt.id === candidate)) {
    return candidate;
  }
  return prompts[0]?.id;
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
  runButton.className = nextBusy ? "btn-danger" : "";
}

function renderPromptOptions(): void {
  const nextPromptId = resolvePromptId(defaultPromptId);
  defaultPromptId = nextPromptId;
  promptSelect.replaceChildren();
  for (const prompt of prompts) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.name;
    promptSelect.append(option);
  }
  if (nextPromptId) {
    promptSelect.value = nextPromptId;
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
    port = null;
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
    port = nextPort;
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
      port = null;
      updateBusy(false);
    }
  }
}

promptSelect.addEventListener("change", () => {
  defaultPromptId = promptSelect.value || undefined;
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
    loading.replaceWith(shell);

    window.requestAnimationFrame(() => {
      input.focus();
      if (!inputText) {
        input.setSelectionRange(0, 0);
      }
    });
  } catch (error) {
    loading.replaceWith(shell);
    setError(error instanceof Error ? error.message : String(error));
  }
}

void initialize();
