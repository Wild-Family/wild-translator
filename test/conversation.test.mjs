import assert from "node:assert/strict";
import test from "node:test";

import { restoreConversation } from "../build/ui/src/app/conversation.js";

const saved = {
  prompt: {
    id: "translate",
    name: "Translate",
    template: "Translate: {{text}}",
    provider: "claude",
    model: "original-model",
  },
  messages: [
    { role: "user", content: "Translate: hello" },
    { role: "assistant", content: "こんにちは" },
    { role: "user", content: "Why?" },
    { role: "assistant", content: "Because…" },
  ],
};

test("restores every turn and the original provider, model, and template", () => {
  const restored = restoreConversation(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored, saved);
});

test("restored conversation can be edited without mutating its saved snapshot", () => {
  const restored = restoreConversation(saved);
  restored.prompt.model = "changed";
  restored.messages[1].content = "changed";
  assert.equal(saved.prompt.model, "original-model");
  assert.equal(saved.messages[1].content, "こんにちは");
});

test("rejects corrupt drafts rather than sending invalid provider messages", () => {
  for (const value of [
    undefined,
    null,
    {},
    { ...saved, prompt: { ...saved.prompt, provider: "unknown" } },
    { ...saved, prompt: { ...saved.prompt, template: null } },
    { ...saved, messages: "text" },
    { ...saved, messages: [] },
    { ...saved, messages: saved.messages.slice(0, 3) },
    { ...saved, messages: [saved.messages[1], saved.messages[0]] },
    { ...saved, messages: [saved.messages[0], { role: "assistant", content: 42 }] },
    { ...saved, messages: [saved.messages[0], null] },
  ]) {
    assert.equal(restoreConversation(value), null);
  }
});
