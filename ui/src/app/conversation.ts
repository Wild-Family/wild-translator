import type {
  ConversationMessage,
  PromptTemplate,
} from "../../../shared/src/types.js";

export type Conversation = {
  prompt: PromptTemplate;
  messages: ConversationMessage[];
};

export function restoreConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== "object") return null;
  const { prompt, messages } = value as Partial<Conversation>;
  if (
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
    prompt: { ...prompt },
    messages: messages.map(({ role, content }) => ({ role, content })),
  };
}
