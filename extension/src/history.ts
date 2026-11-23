import { buildConversationMessages } from "../../shared/src/conversation.js";
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  restoreTranslationHistory,
} from "../../shared/src/history.js";
import type {
  GenerateRequest,
  PromptTemplate,
  TranslationHistoryEntry,
} from "../../shared/src/types.js";

let pendingSave = Promise.resolve();

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
  pendingSave = pendingSave.then(async () => {
    const raw = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
    const entries = restoreTranslationHistory(raw?.[HISTORY_STORAGE_KEY]);
    const previous = entries.find((item) => item.id === entry.id);
    if (previous) {
      entry.createdAt = previous.createdAt;
      entry.inputText = previous.inputText;
    }
    await chrome.storage.local.set({
      [HISTORY_STORAGE_KEY]: [
        entry,
        ...entries.filter((item) => item.id !== entry.id),
      ].slice(0, HISTORY_LIMIT),
    });
  }).catch(() => {
    // A storage failure must not discard a successful translation.
  });
  return pendingSave;
}
