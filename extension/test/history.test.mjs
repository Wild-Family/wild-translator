import assert from "node:assert/strict";
import test from "node:test";

import { saveTranslationHistory } from "../../build/extension/src/history.js";

const prompt = {
  id: "translate", name: "Translate", template: "Translate: {{text}}",
  provider: "claude", model: "original-model",
};

function setup(t, values = {}) {
  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return structuredClone(values); },
        async set(items) { Object.assign(values, structuredClone(items)); },
      },
    },
  };
  return values;
}

test("concurrent translations retain exactly the latest 50 entries locally", async (t) => {
  const values = setup(t, { cacheEnabled: false });
  await Promise.all(Array.from({ length: 60 }, (_, index) =>
    saveTranslationHistory({
      conversationId: `translation-${index}`, inputText: `Input ${index}`,
    }, prompt, `訳文 ${index}`),
  ));

  assert.equal(values.translationHistory.length, 50);
  assert.deepEqual(values.translationHistory.map((entry) => entry.id),
    Array.from({ length: 50 }, (_, index) => `translation-${59 - index}`));
  assert.equal(values.translationHistory[0].inputText, "Input 59");
  assert.deepEqual(values.translationHistory[0].messages, [
    { role: "user", content: "Translate: Input 59" },
    { role: "assistant", content: "訳文 59" },
  ]);
  assert.deepEqual(values.translationHistory[0].prompt, prompt);
});

test("follow-ups update one entry, preserving its original input and creation date", async (t) => {
  const values = setup(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  await saveTranslationHistory({ conversationId: "first", inputText: "hello" }, prompt, "こんにちは");
  const first = structuredClone(values.translationHistory[0]);
  now = 2000;
  await saveTranslationHistory({ conversationId: "second", inputText: "bye" }, prompt, "さようなら");
  now = 3000;
  await saveTranslationHistory({
    conversationId: "first", inputText: "Why?", history: first.messages,
  }, first.prompt, "Explanation");

  assert.equal(values.translationHistory.length, 2);
  const updated = values.translationHistory[0];
  assert.equal(updated.id, "first");
  assert.equal(updated.inputText, "hello");
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 3000);
  assert.deepEqual(updated.messages, [
    ...first.messages,
    { role: "user", content: "Why?" },
    { role: "assistant", content: "Explanation" },
  ]);
});

test("original input survives when an evicted conversation is continued", async (t) => {
  const values = setup(t);
  await saveTranslationHistory({
    conversationId: "evicted", inputText: "Why?", originalInputText: "hello",
    history: [
      { role: "user", content: "Translate: hello" },
      { role: "assistant", content: "こんにちは" },
    ],
  }, prompt, "Explanation");
  assert.equal(values.translationHistory[0].inputText, "hello");
});

test("blank responses and storage failures do not prevent future saves", async (t) => {
  const values = setup(t);
  await saveTranslationHistory({ inputText: "blank" }, prompt, " \n\t");
  assert.equal(values.translationHistory, undefined);

  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error("Storage full"); };
  await saveTranslationHistory({ inputText: "failed save" }, prompt, "Valid response");
  assert.equal(values.translationHistory, undefined);
  chrome.storage.local.set = set;
  await saveTranslationHistory({ inputText: "retry" }, prompt, "Saved response");
  assert.equal(values.translationHistory.length, 1);
  assert.equal(values.translationHistory[0].inputText, "retry");
});
