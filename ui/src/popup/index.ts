import { renderMarkdown } from "../app/markdown.js";
import { restoreConversation } from "../app/conversation.js";
import type { Conversation } from "../app/conversation.js";
import { buildConversationMessages } from "../../../shared/src/conversation.js";
import { HISTORY_LIMIT } from "../../../shared/src/history.js";
import {
  loadTranslationHistory,
  saveTranslationHistory,
} from "../../../shared/src/history-storage.js";
import type { TranslationHistoryEntry } from "../../../shared/src/types.js";
import type { PromptTemplate } from "../app/models.js";
import { getAll, setAll } from "../app/storage.js";

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
const followUpForm = requireElement<HTMLFormElement>("popup-follow-up-form");
const followUpInput = requireElement<HTMLTextAreaElement>("popup-follow-up");
const followUpButton = requireElement<HTMLButtonElement>("popup-send");
const settingsButton = requireElement<HTMLButtonElement>("popup-settings");
const themeButton = requireElement<HTMLButtonElement>("popup-theme");
const historyButton = requireElement<HTMLButtonElement>("popup-history-button");
const historyPanel = requireElement<HTMLElement>("popup-history");
const historyBackButton = requireElement<HTMLButtonElement>("popup-history-back");
const historyCount = requireElement<HTMLSpanElement>("popup-history-count");
const historyList = requireElement<HTMLUListElement>("popup-history-list");
const historyEmpty = requireElement<HTMLParagraphElement>("popup-history-empty");

let prompts: PromptTemplate[] = [];
let defaultPromptId: string | undefined;
let inputText = "";
let conversation: Conversation | null = null;
let conversationCompleted = false;
let followUpText = "";
let busy = false;
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
  previousConversation: Conversation | null;
  previousConversationCompleted: boolean;
  previousFollowUp: string;
};

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
      output: currentReply()?.content ?? "",
      promptId: resolvePromptId(defaultPromptId),
      conversation,
      completed: conversationCompleted,
      updatedAt: Date.now(),
      followUp: followUpText,
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

function currentReply() {
  return conversation?.messages.at(-1);
}

function updateFollowUp(): void {
  followUpForm.hidden = !conversation?.messages.some(
    (message) => message.role === "assistant" && message.content.trim(),
  );
  main.classList.toggle("has-conversation", !followUpForm.hidden);
  followUpInput.disabled = busy;
  followUpButton.disabled = busy || !followUpText.trim();
}

function updateOutput(): void {
  if (conversation) {
    const fragment = document.createDocumentFragment();
    for (const message of conversation.messages.slice(1)) {
      const section = document.createElement("section");
      section.className = `popup-message popup-message-${message.role}`;
      section.setAttribute("aria-label", message.role === "user" ? "You" : "AI");
      if (message.role === "user") {
        section.textContent = message.content;
      } else if (message.content) {
        section.append(renderMarkdown(message.content));
      } else {
        section.textContent = busy ? "Thinking…" : "No response received.";
      }
      fragment.append(section);
    }
    output.replaceChildren(fragment);
  } else {
    output.textContent = "Output";
  }
  updateFollowUp();
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
  const reply = currentReply();
  if (reply) reply.content += next;
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
  input.readOnly = nextBusy;
  promptSelect.disabled = nextBusy || prompts.length === 0;
  historyButton.disabled = nextBusy;
  updateFollowUp();
}

function closeHistory(): void {
  historyPanel.hidden = true;
  main.classList.remove("is-hidden");
  historyButton.setAttribute("aria-expanded", "false");
  historyButton.focus();
}

function openHistoryEntry(entry: TranslationHistoryEntry): void {
  if (busy) return;
  conversation = restoreConversation(entry);
  conversationCompleted = true;
  inputText = entry.inputText;
  input.value = inputText;
  defaultPromptId = resolvePromptId(entry.prompt.id);
  followUpText = "";
  followUpInput.value = "";
  outputAutoScroll = false;
  setError(null);
  renderPromptOptions();
  updateOutput();
  output.scrollTop = 0;
  closeHistory();
  input.focus();
  void saveDraftNow();
}

async function showHistory(): Promise<void> {
  if (busy) return;
  setError(null);
  main.classList.toggle("is-hidden", true);
  historyPanel.hidden = false;
  historyButton.setAttribute("aria-expanded", "true");
  historyList.replaceChildren();
  historyCount.textContent = "";
  historyEmpty.textContent = "Loading history…";
  historyEmpty.hidden = false;
  historyBackButton.focus();

  try {
    const entries = await loadHistory();
    historyCount.textContent = `${entries.length} / ${HISTORY_LIMIT}`;
    historyEmpty.textContent = "No translations yet. Run a translation to save it here.";
    historyEmpty.hidden = entries.length > 0;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary popup-history-entry";
      const meta = document.createElement("span");
      meta.className = "popup-history-meta";
      const promptName = document.createElement("span");
      promptName.textContent = entry.prompt.name;
      const time = document.createElement("time");
      const date = new Date(entry.updatedAt);
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      meta.append(promptName, time);
      const source = document.createElement("span");
      source.className = "popup-history-source";
      source.textContent = entry.inputText;
      const result = document.createElement("span");
      result.className = "popup-history-result";
      result.textContent = entry.messages[1].content;
      button.append(meta, source, result);
      button.addEventListener("click", () => openHistoryEntry(entry));
      item.append(button);
      fragment.append(item);
    }
    historyList.replaceChildren(fragment);
  } catch (error) {
    historyEmpty.textContent = "Reopen History to try again.";
    setError(`Could not load translation history. ${formatError(error)}`);
  }
}

async function loadHistory(): Promise<TranslationHistoryEntry[]> {
  return loadTranslationHistory(prompts, defaultPromptId);
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
  const reply = currentReply();
  if (reply) reply.content += streamQueue;
  clearStreamQueue();
  if (!reply?.content.trim()) {
    conversation = currentRun.previousConversation;
    conversationCompleted = currentRun.previousConversationCompleted;
    followUpText = currentRun.previousFollowUp;
    followUpInput.value = followUpText;
  }
  try {
    currentRun.port.disconnect();
  } catch {
    // ignore
  }
  if (activeRun?.token === currentRun.token) {
    activeRun = null;
  }
  updateBusy(false);
  updateOutput();
  await saveDraftNow();
}

async function run(question?: string): Promise<void> {
  if (busy) return;
  const isFollowUp = question !== undefined;
  const requestInput = isFollowUp ? question.trim() : inputText;
  const prompt = isFollowUp
    ? conversation?.prompt
    : prompts.find((item) => item.id === resolvePromptId(defaultPromptId));
  if (!requestInput.trim() || !prompt) return;
  const previousConversation = structuredClone(conversation);
  const previousConversationCompleted = conversationCompleted;
  const previousFollowUp = followUpText;
  const history = isFollowUp ? conversation?.messages ?? [] : [];

  const token = ++runSeq;

  setError(null);
  const nextConversation = {
    id: (isFollowUp && conversation?.id) || crypto.randomUUID(),
    inputText: isFollowUp ? conversation?.inputText ?? inputText : requestInput,
    prompt: { ...prompt },
    messages: [
      ...buildConversationMessages(prompt.template, requestInput, history),
      { role: "assistant" as const, content: "" },
    ],
  };
  conversation = nextConversation;
  conversationCompleted = false;
  followUpText = "";
  followUpInput.value = "";
  updateBusy(true);
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
      previousConversation,
      previousConversationCompleted,
      previousFollowUp,
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
          settle(() => {
            reject(new Error(String(message.error ?? "Stream error")));
          });
        }
        if (message?.type === "STREAM_END") {
          if (activeRun?.token !== token) return;
          const text = (currentReply()?.content ?? "") + streamQueue;
          // Persist on completion, before the display animation finishes or the popup closes.
          // Older background versions may finish a stream without saving its history.
          const saved = text.trim() ? saveTranslationHistory({
            inputText: requestInput,
            history,
            conversationId: nextConversation.id,
            originalInputText: nextConversation.inputText,
          }, prompt, text).then(() => "", (error) =>
            `Translation finished, but its history could not be saved. ${formatError(error)}`,
          ) : Promise.resolve("");
          void Promise.all([waitForStreamFlush(), saved]).then(async ([, historyError]) => {
            if (activeRun?.token !== token) return;
            if (!currentReply()?.content.trim()) {
              settle(() => reject(new Error("No response received. Try again.")));
              return;
            }
            conversationCompleted = true;
            if (historyError) setError(historyError);
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
        inputText: requestInput,
        promptId: prompt.id,
        prompt,
        history,
        conversationId: nextConversation.id,
        originalInputText: nextConversation.inputText,
      });
    });
  } catch (error) {
    if (runSeq === token && busy) {
      clearStreamQueue();
      conversation = previousConversation;
      conversationCompleted = previousConversationCompleted;
      followUpText = previousFollowUp;
      followUpInput.value = followUpText;
      setError(formatError(error));
    }
  } finally {
    if (activeRun?.token === token || (runSeq === token && busy)) {
      if (activeRun) {
        activeRun.disconnectExpected = true;
        try {
          activeRun.port.disconnect();
        } catch {
          // The port may already have disconnected.
        }
      }
      activeRun = null;
      updateBusy(false);
      updateOutput();
      if (isFollowUp) followUpInput.focus();
      void saveDraftNow();
    }
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
  if (!historyPanel.hidden) return;
  if (event.repeat || event.isComposing || event.keyCode === 229) return;
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
  void run(event.target === followUpInput ? followUpText : undefined);
}

function handleShortcutKeyup(event: KeyboardEvent): void {
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
  scheduleDraftSave();
});

followUpInput.addEventListener("input", () => {
  followUpText = followUpInput.value;
  updateFollowUp();
  scheduleDraftSave();
});

followUpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void run(followUpText);
});

output.addEventListener("scroll", () => {
  outputAutoScroll = isOutputAtBottom();
});
output.addEventListener("wheel", disableOutputAutoScroll, { passive: true });
output.addEventListener("pointerdown", disableOutputAutoScroll);
output.addEventListener("touchstart", disableOutputAutoScroll, {
  passive: true,
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !historyPanel.hidden) {
    event.preventDefault();
    closeHistory();
    return;
  }
  if (event.key === "Escape" && busy) {
    event.preventDefault();
    void stop();
  }
});

window.addEventListener("keydown", handleRunShortcut, true);
window.addEventListener("keyup", handleShortcutKeyup, true);
document.addEventListener("keydown", handleRunShortcut, true);
document.addEventListener("keyup", handleShortcutKeyup, true);
input.addEventListener("keydown", handleRunShortcut, true);
input.addEventListener("keyup", handleShortcutKeyup, true);
window.addEventListener("blur", () => {
  runShortcutModifierDown = false;
});
window.addEventListener("pagehide", () => {
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

settingsButton.addEventListener("click", () => {
  openSettingsPage();
});

historyButton.addEventListener("click", () => {
  if (!historyPanel.hidden) closeHistory();
  else void showHistory();
});
historyBackButton.addEventListener("click", closeHistory);

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
  historyPanel.hidden = true;
  try {
    const state = await getAll();
    prompts = state.prompts;
    defaultPromptId = resolvePromptId(state.defaultPromptId);
    renderPromptOptions();
    let hasSelectionDraft = false;

    try {
      // Recover the previous response before a selection or new run replaces its draft.
      await loadHistory();
    } catch (error) {
      setError(`Could not load translation history. ${formatError(error)}`);
    }

    try {
      const store = chrome.storage?.session ?? chrome.storage?.local;
      const prefs = await chrome.storage?.local?.get(["selectionPrefillEnabled"]);
      const savedDraft = await chrome.storage?.local?.get(["popupDraft"]);
      const saved = savedDraft?.popupDraft;
      const selectionPrefillEnabled = prefs?.selectionPrefillEnabled !== false;
      const draft = await readDraftText(store);

      if (selectionPrefillEnabled) {
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
      }
      await clearDraftText(store);

      if (saved?.promptId) {
        defaultPromptId = resolvePromptId(saved.promptId);
      }
      if (!hasSelectionDraft && !inputText.trim()) {
        if (saved?.input) {
          inputText = saved.input;
          input.value = saved.input;
        }
      }
      if (!hasSelectionDraft) {
        conversation = restoreConversation(saved?.conversation);
        conversationCompleted = saved?.completed !== false;
        // Keep output saved before conversation support was introduced.
        if (!conversation && typeof saved?.output === "string" && saved.output) {
          const prompt = prompts.find((item) => item.id === defaultPromptId);
          if (prompt && typeof saved.input === "string") {
            conversation = {
              prompt: { ...prompt },
              messages: [
                ...buildConversationMessages(prompt.template, saved.input),
                { role: "assistant", content: saved.output },
              ],
            };
          }
        }
        followUpText = typeof saved?.followUp === "string" ? saved.followUp : "";
        if (conversation && !currentReply()?.content.trim()) {
          if (conversation.messages.length > 2) {
            followUpText ||= conversation.messages.at(-2)?.content ?? "";
            conversation.messages.splice(-2);
            conversationCompleted = true;
          } else {
            conversation = null;
            conversationCompleted = false;
          }
        }
        followUpInput.value = followUpText;
        if (conversation && conversation.inputText === undefined) {
          conversation.inputText = typeof saved?.input === "string" ? saved.input : inputText;
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
    historyButton.disabled = false;

    window.requestAnimationFrame(() => {
      input.focus();
      if (!inputText) {
        input.setSelectionRange(0, 0);
      }
    });

    if (hasSelectionDraft) {
      void run();
    }
  } catch (error) {
    loading.hidden = true;
    setError(formatError(error));
  }
}

void initialize();
