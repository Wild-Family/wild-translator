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
const speechButton = requireElement<HTMLButtonElement>("popup-speech");
const output = requireElement<HTMLDivElement>("popup-output");
const settingsButton = requireElement<HTMLButtonElement>("popup-settings");
const themeButton = requireElement<HTMLButtonElement>("popup-theme");

let prompts: PromptTemplate[] = [];
let defaultPromptId: string | undefined;
let inputText = "";
let outputText = "";
let busy = false;
let speechBusy = false;
let speechPlaying = false;
let speechAudio: HTMLAudioElement | null = null;
let speechAudioText = "";
let speechAudioDataUrl = "";
let saveTimer: number | null = null;
let runSeq = 0;
let themeTouched = false;
let theme: "light" | "dark" = "light";
let runShortcutModifierDown = false;
let lastShortcutRunAt = 0;
let streamQueue = "";
let streamTimer: number | null = null;
let streamFlushResolvers: Array<() => void> = [];
let outputAutoScroll = true;

const STREAM_CHUNK_SIZE = 3;
const STREAM_CHUNK_DELAY_MS = 24;

type ActiveRun = {
  token: number;
  port: chrome.runtime.Port;
  disconnectExpected: boolean;
};

type SpeechResponse =
  | { ok: true; audioDataUrl: string; cached: boolean }
  | { ok: false; error: string };

let activeRun: ActiveRun | null = null;

function setError(message: string | null): void {
  errorBanner.textContent = message ?? "";
  errorBanner.hidden = !message;
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Extension context invalidated/i.test(message)) {
    return "Extension context was reloaded. Close and reopen this popup.";
  }
  return message;
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

function getDraftSnapshot() {
  return {
    popupDraft: {
      input: inputText,
      output: outputText,
      promptId: resolvePromptId(defaultPromptId),
    },
  };
}

async function saveDraftNow(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  try {
    await chrome.storage?.local?.set(getDraftSnapshot());
  } catch {
    // The popup may be closing or the extension context may have reloaded.
  }
}

function scheduleDraftSave(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveDraftNow();
  }, 250);
}

function updateOutput(): void {
  output.textContent = stripMarkdown(outputText) || "Output";
  if (outputAutoScroll) {
    output.scrollTop = output.scrollHeight;
  }
}

function isOutputAtBottom(): boolean {
  const distance = output.scrollHeight - output.scrollTop - output.clientHeight;
  return distance < 24;
}

function disableOutputAutoScroll(): void {
  outputAutoScroll = false;
}

function resolveStreamFlush(): void {
  const resolvers = streamFlushResolvers;
  streamFlushResolvers = [];
  for (const resolve of resolvers) resolve();
}

function clearStreamQueue(): void {
  streamQueue = "";
  if (streamTimer !== null) {
    window.clearTimeout(streamTimer);
    streamTimer = null;
  }
  resolveStreamFlush();
}

function flushStreamQueue(): void {
  if (!streamQueue) {
    streamTimer = null;
    resolveStreamFlush();
    return;
  }

  const next = streamQueue.slice(0, STREAM_CHUNK_SIZE);
  streamQueue = streamQueue.slice(STREAM_CHUNK_SIZE);
  outputText += next;
  updateOutput();
  scheduleDraftSave();
  streamTimer = window.setTimeout(flushStreamQueue, STREAM_CHUNK_DELAY_MS);
}

function enqueueStreamText(text: string): void {
  if (!text) return;
  streamQueue += text;
  if (streamTimer === null) {
    flushStreamQueue();
  }
}

function waitForStreamFlush(): Promise<void> {
  if (!streamQueue && streamTimer === null) return Promise.resolve();
  return new Promise((resolve) => {
    streamFlushResolvers.push(resolve);
  });
}

function updateBusy(nextBusy: boolean): void {
  busy = nextBusy;
  runButton.textContent = nextBusy ? "Stop" : "Run";
  runButton.classList.toggle("btn-danger", nextBusy);
  output.setAttribute("aria-busy", String(nextBusy));
}

function normalizeSpeechText(text: string): string {
  return text.trim();
}

function updateSpeechButton(): void {
  const hasInput = Boolean(normalizeSpeechText(inputText));
  speechButton.disabled = speechBusy || !hasInput;
  speechButton.setAttribute("aria-busy", String(speechBusy));

  if (speechBusy) {
    speechButton.textContent = "Loading audio";
    speechButton.setAttribute(
      "aria-label",
      "Generating English with AI-generated voice",
    );
    return;
  }

  if (speechPlaying) {
    speechButton.textContent = "Stop Audio";
    speechButton.setAttribute("aria-label", "Stop English audio playback");
    return;
  }

  speechButton.textContent = "Play English (AI)";
  speechButton.setAttribute(
    "aria-label",
    "Play English with AI-generated voice",
  );
}

function stopSpeechPlayback(): void {
  if (speechAudio) {
    speechAudio.pause();
    try {
      speechAudio.currentTime = 0;
    } catch {
      // ignore
    }
  }
  speechPlaying = false;
  updateSpeechButton();
}

function clearSpeechAudio(): void {
  stopSpeechPlayback();
  if (speechAudio) {
    speechAudio.onended = null;
    speechAudio.onerror = null;
  }
  speechAudio = null;
  speechAudioText = "";
  speechAudioDataUrl = "";
  updateSpeechButton();
}

async function playSpeechDataUrl(dataUrl: string, text: string): Promise<void> {
  if (!speechAudio || speechAudioDataUrl !== dataUrl) {
    speechAudio = new Audio(dataUrl);
    speechAudioDataUrl = dataUrl;
    speechAudioText = text;
    const activeAudio = speechAudio;
    activeAudio.onended = () => {
      if (speechAudio !== activeAudio) return;
      speechPlaying = false;
      updateSpeechButton();
    };
    activeAudio.onerror = () => {
      if (speechAudio !== activeAudio) return;
      speechPlaying = false;
      updateSpeechButton();
      setError("Unable to play generated audio.");
    };
  }

  try {
    speechAudio.pause();
    speechAudio.currentTime = 0;
  } catch {
    // ignore
  }

  speechPlaying = true;
  updateSpeechButton();

  try {
    await speechAudio.play();
  } catch (error) {
    speechPlaying = false;
    updateSpeechButton();
    throw error;
  }
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

async function readDraftText(
  store: chrome.storage.StorageArea | undefined,
): Promise<{ hasDraft: boolean; text: string | undefined }> {
  try {
    const pending = await chrome.runtime?.sendMessage({
      type: "CONSUME_PENDING_DRAFT",
    });
    if (pending?.ok && pending.hasDraft) {
      return {
        hasDraft: true,
        text: typeof pending.text === "string" ? pending.text : undefined,
      };
    }
  } catch {
    // Fall back to storage when the background context was reloaded.
  }

  if (!store) return { hasDraft: false, text: undefined };

  for (const delayMs of [0, 25, 75, 150]) {
    if (delayMs) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
    const draft = await store.get(["draftText"]);
    if (Object.prototype.hasOwnProperty.call(draft, "draftText")) {
      return {
        hasDraft: true,
        text: typeof draft.draftText === "string" ? draft.draftText : undefined,
      };
    }
  }

  return { hasDraft: false, text: undefined };
}

async function clearDraftText(store: chrome.storage.StorageArea | undefined) {
  await store?.remove(["draftText"]);
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
  clearStreamQueue();

  if (activeRun?.token === currentRun.token) {
    activeRun = null;
  }
  updateBusy(false);
  await saveDraftNow();
}

async function run(): Promise<void> {
  if (busy || !inputText.trim()) return;

  const token = ++runSeq;
  const nextPromptId = resolvePromptId(defaultPromptId);

  setError(null);
  updateBusy(true);
  outputText = "";
  outputAutoScroll = true;
  clearStreamQueue();
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
          enqueueStreamText(String(message.delta ?? ""));
        }
        if (message?.type === "STREAM_ERROR") {
          runState.disconnectExpected = true;
          clearStreamQueue();
          void saveDraftNow();
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
          void waitForStreamFlush().then(async () => {
            await saveDraftNow();
            runState.disconnectExpected = true;
            try {
              nextPort.disconnect();
            } catch {
              // ignore
            }
            settle(resolve);
          });
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
      setError(formatError(error));
    }
  } finally {
    if (activeRun?.token === token) {
      activeRun = null;
      updateOutput();
      updateBusy(false);
      void saveDraftNow();
    }
  }
}

async function playEnglishSpeech(): Promise<void> {
  if (speechPlaying) {
    stopSpeechPlayback();
    return;
  }
  if (speechBusy) return;

  const text = normalizeSpeechText(inputText);
  if (!text) {
    updateSpeechButton();
    return;
  }

  setError(null);

  if (speechAudioText === text && speechAudioDataUrl) {
    try {
      await playSpeechDataUrl(speechAudioDataUrl, text);
    } catch (error) {
      setError(formatError(error));
    }
    return;
  }

  speechBusy = true;
  updateSpeechButton();

  try {
    const response = (await chrome.runtime?.sendMessage({
      type: "GENERATE_SPEECH",
      text,
    })) as SpeechResponse | undefined;
    if (!response?.ok) {
      throw new Error(response?.error ?? "Speech generation failed.");
    }
    if (normalizeSpeechText(inputText) !== text) return;

    await playSpeechDataUrl(response.audioDataUrl, text);
  } catch (error) {
    setError(formatError(error));
  } finally {
    speechBusy = false;
    updateSpeechButton();
  }
}

function isRunShortcut(event: KeyboardEvent): boolean {
  const isEnter =
    event.key === "Enter" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter" ||
    event.keyCode === 13;
  return (
    isEnter &&
    (event.metaKey ||
      event.ctrlKey ||
      event.getModifierState?.("Meta") ||
      event.getModifierState?.("Control") ||
      runShortcutModifierDown)
  );
}

function handleRunShortcut(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey) {
    runShortcutModifierDown = true;
  }
  if (event.key === "Meta" || event.key === "Control") {
    runShortcutModifierDown = true;
    return;
  }
  if (!isRunShortcut(event)) return;

  event.preventDefault();
  event.stopPropagation();
  const now = Date.now();
  if (now - lastShortcutRunAt < 250) return;
  lastShortcutRunAt = now;
  if (busy) {
    void stop();
    return;
  }
  void run();
}

function handleShortcutKeyup(event: KeyboardEvent): void {
  handleRunShortcut(event);
  if (event.key === "Meta" || event.key === "Control") {
    runShortcutModifierDown = false;
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
  if (speechAudioText && normalizeSpeechText(inputText) !== speechAudioText) {
    clearSpeechAudio();
  }
  scheduleDraftSave();
  updateSpeechButton();
});

output.addEventListener("scroll", () => {
  outputAutoScroll = isOutputAtBottom();
});
output.addEventListener("wheel", disableOutputAutoScroll, { passive: true });
output.addEventListener("pointerdown", disableOutputAutoScroll);
output.addEventListener("touchstart", disableOutputAutoScroll, {
  passive: true,
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && busy) {
    event.preventDefault();
    void stop();
  }
});

window.addEventListener("keydown", handleRunShortcut, true);
window.addEventListener("keyup", handleShortcutKeyup, true);
window.addEventListener("keypress", handleRunShortcut, true);
document.addEventListener("keydown", handleRunShortcut, true);
document.addEventListener("keyup", handleShortcutKeyup, true);
document.addEventListener("keypress", handleRunShortcut, true);
input.addEventListener("keydown", handleRunShortcut, true);
input.addEventListener("keyup", handleShortcutKeyup, true);
input.addEventListener("keypress", handleRunShortcut, true);
window.addEventListener("blur", () => {
  runShortcutModifierDown = false;
});
window.addEventListener("pagehide", () => {
  stopSpeechPlayback();
  void saveDraftNow();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void saveDraftNow();
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

speechButton.addEventListener("click", () => {
  void playEnglishSpeech();
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
      const savedDraft = await chrome.storage?.local?.get(["popupDraft"]);
      const saved = savedDraft?.popupDraft;
      const selectionPrefillEnabled = prefs?.selectionPrefillEnabled !== false;
      let hasSelectionDraft = false;

      if (!selectionPrefillEnabled) {
        await store?.remove(["draftText"]);
      } else {
        const draft = await readDraftText(store);
        hasSelectionDraft = draft.hasDraft;
        const text = draft.text;
        if (typeof text === "string") {
          inputText = text;
          input.value = text;
          if (text.trim()) {
            window.requestAnimationFrame(() => {
              const end = input.value.length;
              input.focus();
              input.setSelectionRange(end, end);
            });
          }
        }
        await clearDraftText(store);
      }

      if (saved?.output) {
        outputText = saved.output;
      }
      if (saved?.promptId) {
        defaultPromptId = resolvePromptId(saved.promptId);
      }
      if (!hasSelectionDraft && !inputText.trim()) {
        if (saved?.input) {
          inputText = saved.input;
          input.value = saved.input;
        }
      }
    } catch {
      // ignore
    }

    renderPromptOptions();
    updateOutput();
    updateSpeechButton();
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
    setError(formatError(error));
  }
}

void initialize();
