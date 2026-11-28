import {
  buildConversationMessages,
  restoreConversation,
} from "./conversation.js";
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  restoreTranslationHistory,
} from "./history.js";
import type {
  GenerateRequest,
  PromptTemplate,
  TranslationHistoryEntry,
} from "./types.js";

let pendingSave = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingSave.then(() => {
    // Popups, tabs, and the service worker share the extension's origin and lock.
    if (globalThis.navigator?.locks) {
      return navigator.locks.request("wild:translation-history", operation);
    }
    return operation();
  });
  // Recover the queue while leaving the caller able to report this failure.
  pendingSave = result.then(() => {}, () => {});
  return result;
}

export function loadTranslationHistory(
  prompts: PromptTemplate[],
  defaultPromptId?: string,
): Promise<TranslationHistoryEntry[]> {
  return serialize(async () => {
    const raw = await chrome.storage.local.get([HISTORY_STORAGE_KEY, "popupDraft"]);
    const entries = restoreTranslationHistory(raw?.[HISTORY_STORAGE_KEY]);
    const draft = raw?.popupDraft;
    if (!draft || typeof draft !== "object" || draft.completed === false) return entries;

    let conversation = restoreConversation(draft.conversation);
    // Drafts saved before chat support contain only the input and response.
    if (
      !conversation && !draft.conversation && typeof draft.input === "string" &&
      typeof draft.output === "string" && draft.output.trim()
    ) {
      const promptId = draft.promptId ?? defaultPromptId ?? prompts[0]?.id;
      const prompt = prompts.find((item) => item.id === promptId);
      if (prompt) {
        conversation = {
          prompt: { ...prompt },
          messages: [
            ...buildConversationMessages(prompt.template, draft.input),
            { role: "assistant", content: draft.output },
          ],
        };
      }
    }
    if (!conversation?.messages.at(-1)?.content.trim()) return entries;
    const inputText = conversation.inputText ?? draft.input;
    if (typeof inputText !== "string") return entries;
    // Never replace a newer archived conversation with an old popup snapshot.
    if (entries.some((entry) => entry.id === conversation.id)) return entries;

    const now = Date.now();
    const updatedAt = typeof draft.updatedAt === "number" &&
      Number.isFinite(draft.updatedAt) && Math.abs(draft.updatedAt) <= 8.64e15
      ? draft.updatedAt : now;
    const entry: TranslationHistoryEntry = {
      ...conversation,
      id: conversation.id || crypto.randomUUID(),
      inputText,
      createdAt: updatedAt,
      updatedAt,
    };
    const recovered = restoreTranslationHistory([entry, ...entries]);
    // Store the assigned ID atomically so reopening never duplicates a legacy draft.
    await chrome.storage.local.set({
      [HISTORY_STORAGE_KEY]: recovered,
      popupDraft: {
        ...draft,
        conversation: { ...conversation, id: entry.id, inputText },
        completed: true,
        updatedAt,
      },
    });
    return recovered;
  });
}

export function saveTranslationHistory(
  request: GenerateRequest,
  prompt: PromptTemplate,
  text: string,
): Promise<void> {
  if (!text.trim()) return Promise.resolve();
  const now = Date.now();
  const entry: TranslationHistoryEntry = {
    id: request.conversationId || crypto.randomUUID(),
    inputText: request.originalInputText ?? request.inputText,
    prompt: { ...prompt },
    messages: [
      ...buildConversationMessages(prompt.template, request.inputText, request.history),
      { role: "assistant", content: text },
    ],
    createdAt: now,
    updatedAt: now,
  };

  // Serialize writes across popups and tabs so concurrent completions are retained.
  return serialize(async () => {
    const raw = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
    const entries = restoreTranslationHistory(raw?.[HISTORY_STORAGE_KEY]);
    const previous = entries.find((item) => item.id === entry.id);
    if (previous) {
      // The popup can also save a completion handled by an older service worker.
      // Keep repeated saves idempotent and never roll back a completed follow-up.
      if (previous.messages.length > entry.messages.length || (
        previous.messages.length === entry.messages.length &&
        previous.messages.every((message, index) =>
          message.role === entry.messages[index].role &&
          message.content === entry.messages[index].content,
        )
      )) return;
      entry.createdAt = previous.createdAt;
      entry.inputText = previous.inputText;
    }
    await chrome.storage.local.set({
      [HISTORY_STORAGE_KEY]: [
        entry,
        ...entries.filter((item) => item.id !== entry.id),
      ].slice(0, HISTORY_LIMIT),
    });
  });
}
