import { renderPromptTemplate } from "./prompt.js";
import type { Conversation, ConversationMessage } from "./types.js";

export function buildConversationMessages(
  template: string,
  inputText: string,
  history: ConversationMessage[] = [],
): ConversationMessage[] {
  return [
    ...history,
    {
      role: "user",
      content: history.length
        ? inputText
        : renderPromptTemplate(template, { text: inputText }),
    },
  ];
}

export function restoreConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const { id, inputText, prompt, messages } = value as Partial<Conversation>;
  if (
    (id !== undefined && (typeof id !== "string" || !id)) ||
    (inputText !== undefined && typeof inputText !== "string") ||
    !prompt ||
    typeof prompt.id !== "string" ||
    typeof prompt.name !== "string" ||
    typeof prompt.template !== "string" ||
    (prompt.provider !== undefined &&
      !["openai", "gemini", "claude"].includes(prompt.provider)) ||
    (prompt.model !== undefined && typeof prompt.model !== "string") ||
    !Array.isArray(messages) ||
    messages.length < 2 ||
    messages.length % 2 !== 0 ||
    !messages.every(
      (message, index) =>
        message &&
        message.role === (index % 2 === 0 ? "user" : "assistant") &&
        typeof message.content === "string",
    )
  ) {
    return null;
  }
  return {
    ...(id !== undefined ? { id } : {}),
    ...(inputText !== undefined ? { inputText } : {}),
    prompt: { ...prompt },
    messages: messages.map(({ role, content }) => ({ role, content })),
  };
}
