import assert from "node:assert/strict";
import test from "node:test";

import { restoreTranslationHistory } from "../../build/shared/src/history.js";

function entry(index) {
  return {
    id: `translation-${index}`, inputText: `Input ${index}`,
    createdAt: index, updatedAt: index,
    prompt: { id: "translate", name: "Translate", template: "{{text}}" },
    messages: [
      { role: "user", content: `Input ${index}` },
      { role: "assistant", content: `訳文 ${index}` },
    ],
  };
}

test("restores only the newest 50 complete translations in descending order", () => {
  const saved = Array.from({ length: 55 }, (_, index) => entry(index));
  const restored = restoreTranslationHistory(saved);
  assert.equal(restored.length, 50);
  assert.equal(restored[0].id, "translation-54");
  assert.equal(restored.at(-1).id, "translation-5");
  restored[0].messages[1].content = "Changed";
  restored[0].prompt.name = "Changed";
  assert.equal(saved[54].messages[1].content, "訳文 54");
  assert.equal(saved[54].prompt.name, "Translate");
});

test("corrupt, incomplete, and invalid date entries are skipped", () => {
  const valid = entry(1);
  for (const value of [null, {}, "history"]) {
    assert.deepEqual(restoreTranslationHistory(value), []);
  }
  assert.deepEqual(restoreTranslationHistory([
    null, {}, valid,
    { ...valid, id: 42 },
    { ...valid, inputText: undefined },
    { ...valid, createdAt: "yesterday" },
    { ...valid, updatedAt: Infinity },
    { ...valid, updatedAt: 1e16 },
    { ...valid, messages: valid.messages.slice(0, 1) },
    { ...valid, messages: [valid.messages[0], { role: "assistant", content: " " }] },
    { ...valid, prompt: { ...valid.prompt, provider: "unknown" } },
  ]), [valid]);
});
