import assert from "node:assert/strict";
import test from "node:test";

import { buildConversationMessages } from "../../build/shared/src/conversation.js";

test("renders the preset only for the first question", () => {
  assert.deepEqual(buildConversationMessages("Translate: {{text}}", "hello"), [
    { role: "user", content: "Translate: hello" },
  ]);
});

test("follow-ups retain previous turns and are not wrapped in the preset", () => {
  const history = Object.freeze([
    { role: "user", content: "Translate: hello" },
    { role: "assistant", content: "こんにちは" },
    { role: "user", content: "Can you make that more casual?" },
    { role: "assistant", content: "やあ" },
  ]);

  assert.deepEqual(
    buildConversationMessages("Translate: {{text}}", "Why?", history),
    [...history, { role: "user", content: "Why?" }],
  );
  assert.equal(history.length, 4);
});
