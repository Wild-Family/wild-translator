import { renderPromptTemplate } from "./prompt.js";
import type { ConversationMessage } from "./types.js";

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
