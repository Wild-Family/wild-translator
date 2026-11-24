import { restoreConversation } from "./conversation.js";
import type { TranslationHistoryEntry } from "./types.js";

export const HISTORY_STORAGE_KEY = "translationHistory";
export const HISTORY_LIMIT = 50;

export function restoreTranslationHistory(value: unknown): TranslationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: TranslationHistoryEntry[] = [];
  for (const item of value) {
    const conversation = restoreConversation(item);
    if (
      !conversation?.id ||
      typeof conversation.inputText !== "string" ||
      !conversation.messages.at(-1)?.content.trim() ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt) ||
      typeof item.updatedAt !== "number" ||
      !Number.isFinite(item.updatedAt) ||
      Math.abs(item.updatedAt) > 8.64e15
    ) {
      continue;
    }
    entries.push({
      ...conversation,
      id: conversation.id,
      inputText: conversation.inputText,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, HISTORY_LIMIT);
}
