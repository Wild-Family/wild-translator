import assert from "node:assert/strict";
import test from "node:test";

import { loadTranslationHistory, saveTranslationHistory } from "../../build/extension/src/history.js";

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

test("saving the same completion from the popup and background preserves dates and ordering", async (t) => {
  const values = setup(t);
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const request = { conversationId: "same", inputText: "hello" };
  await saveTranslationHistory(request, prompt, "こんにちは");
  const original = structuredClone(values.translationHistory[0]);
  now = 2000;
  await saveTranslationHistory({ conversationId: "newer", inputText: "bye" }, prompt, "さようなら");
  now = 3000;
  await saveTranslationHistory(request, prompt, "こんにちは");
  assert.deepEqual(values.translationHistory.map((entry) => entry.id), ["newer", "same"]);
  assert.deepEqual(values.translationHistory[1], original);
});

test("a late save of the first response cannot remove a completed follow-up", async (t) => {
  const values = setup(t);
  const request = { conversationId: "same", inputText: "hello" };
  await saveTranslationHistory(request, prompt, "こんにちは");
  const original = structuredClone(values.translationHistory[0]);
  await saveTranslationHistory({
    ...request, inputText: "Why?", history: original.messages,
  }, prompt, "Explanation");
  const continued = structuredClone(values.translationHistory[0]);
  await saveTranslationHistory(request, prompt, "こんにちは");
  assert.deepEqual(values.translationHistory, [continued]);
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
  await assert.rejects(
    saveTranslationHistory({ inputText: "failed save" }, prompt, "Valid response"),
    /Storage full/,
  );
  assert.equal(values.translationHistory, undefined);
  chrome.storage.local.set = set;
  await saveTranslationHistory({ inputText: "retry" }, prompt, "Saved response");
  assert.equal(values.translationHistory.length, 1);
  assert.equal(values.translationHistory[0].inputText, "retry");
});

test("legacy responses are recovered once with a persistent conversation ID", async (t) => {
  const values = setup(t, {
    popupDraft: { input: "hello", output: "こんにちは", promptId: prompt.id },
  });
  const entries = await loadTranslationHistory([prompt]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].inputText, "hello");
  assert.deepEqual(entries[0].prompt, prompt);
  assert.deepEqual(entries[0].messages, [
    { role: "user", content: "Translate: hello" },
    { role: "assistant", content: "こんにちは" },
  ]);
  assert.equal(values.popupDraft.conversation.id, entries[0].id);
  assert.deepEqual(await loadTranslationHistory([prompt]), entries);
  assert.equal(values.translationHistory.length, 1);
});

test("legacy responses without a preset ID use the configured default", async (t) => {
  setup(t, { popupDraft: { input: "hello", output: "こんにちは" } });
  const entries = await loadTranslationHistory([
    { ...prompt, id: "other" }, prompt,
  ], prompt.id);
  assert.deepEqual(entries[0].prompt, prompt);
});

test("recovery retains the source and preset snapshot after draft edits", async (t) => {
  const values = setup(t);
  await saveTranslationHistory({ conversationId: "existing", inputText: "hello" }, prompt, "こんにちは");
  const original = structuredClone(values.translationHistory[0]);
  values.popupDraft = {
    input: "Edited input", promptId: "another-preset", completed: true, updatedAt: 5000,
    conversation: { ...original, id: "missing" },
  };
  values.translationHistory = [];
  const entries = await loadTranslationHistory([]);
  assert.equal(entries[0].inputText, "hello");
  assert.deepEqual(entries[0].prompt, prompt);
  assert.equal(entries[0].updatedAt, 5000);

  // A stale popup must not replace an archived follow-up or change its ordering.
  await saveTranslationHistory({
    conversationId: "missing", inputText: "Why?", history: entries[0].messages,
  }, prompt, "Explanation");
  const archived = structuredClone(values.translationHistory);
  assert.deepEqual(await loadTranslationHistory([]), archived);
});

test("empty, corrupt, and explicitly interrupted drafts are not recovered", async (t) => {
  const values = setup(t);
  for (const draft of [
    { input: "hello", output: "", promptId: prompt.id },
    { input: "hello", output: "partial", promptId: prompt.id, completed: false },
    { input: "hello", output: "reply", promptId: "deleted-preset" },
    { input: "hello", output: "reply", promptId: prompt.id, conversation: { messages: [] } },
  ]) {
    values.popupDraft = draft;
    assert.deepEqual(await loadTranslationHistory([prompt]), []);
    assert.equal(values.translationHistory, undefined);
  }
});

test("recovery failures remain retryable without losing existing translations", async (t) => {
  const values = setup(t, {
    popupDraft: { input: "hello", output: "こんにちは", promptId: prompt.id },
  });
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async () => { throw new Error("Storage full"); };
  await assert.rejects(loadTranslationHistory([prompt]), /Storage full/);
  assert.equal(values.translationHistory, undefined);
  chrome.storage.local.set = set;
  await Promise.all([
    loadTranslationHistory([prompt]),
    saveTranslationHistory({ inputText: "bye" }, prompt, "さようなら"),
  ]);
  assert.equal(values.translationHistory.length, 2);
});
