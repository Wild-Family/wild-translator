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

function setError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.style.display = message ? "block" : "none";
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
        promptId: defaultPromptId,
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
  promptSelect.replaceChildren();
  for (const prompt of prompts) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = prompt.name;
    promptSelect.append(option);
  }
  if (defaultPromptId) {
    promptSelect.value = defaultPromptId;
  }
}

async function stop(): Promise<void> {
  try {
    port?.disconnect();
  } catch {
    // ignore
  }
  port = null;
  updateBusy(false);
}

async function run(): Promise<void> {
  setError(null);
  updateBusy(true);
  outputText = "";
  updateOutput();
  scheduleDraftSave();

  try {
    const nextPort = chrome.runtime.connect({ name: "wild:generate" });
    port = nextPort;

    await new Promise<void>((resolve, reject) => {
      nextPort.onDisconnect.addListener(() => {
        resolve();
      });

      nextPort.onMessage.addListener((message: any) => {
        if (message?.type === "STREAM_DELTA") {
          outputText += String(message.delta ?? "");
          updateOutput();
          scheduleDraftSave();
        }
        if (message?.type === "STREAM_ERROR") {
          try {
            nextPort.disconnect();
          } catch {
            // ignore
          }
          reject(new Error(String(message.error ?? "Stream error")));
        }
        if (message?.type === "STREAM_END") {
          try {
            nextPort.disconnect();
          } catch {
            // ignore
          }
          resolve();
        }
      });

      nextPort.postMessage({
        type: "GENERATE_STREAM",
        inputText,
        promptId: defaultPromptId,
      });
    });
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    port = null;
    updateBusy(false);
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
    defaultPromptId = state.defaultPromptId;
    renderPromptOptions();

    try {
      const store = chrome.storage?.session ?? chrome.storage?.local;
      const prefs = await chrome.storage?.local?.get(["selectionPrefillEnabled"]);
      if (prefs?.selectionPrefillEnabled === false) {
        await store?.remove(["draftText"]);
      } else {
        const draft = store ? await store.get(["draftText"]) : {};
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
    } catch {
      // ignore
    }

    try {
      if (!inputText.trim()) {
        const draft = await chrome.storage?.local?.get(["popupDraft"]);
        const saved = draft?.popupDraft;
        if (saved?.input) {
          inputText = saved.input;
          input.value = saved.input;
        }
        if (saved?.output) {
          outputText = saved.output;
        }
        if (saved?.promptId) {
          defaultPromptId = saved.promptId;
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
