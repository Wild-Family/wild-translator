import assert from "node:assert/strict";
import test from "node:test";

test("generation caches distinguish conversation history and retain the original preset", async (t) => {
  const local = {};
  const listeners = {};
  const event = (name) => ({
    addListener(listener) { listeners[name] = listener; },
  });
  const originalPrompt = {
    id: "translate",
    name: "Translate",
    template: "Translate: {{text}}",
    provider: "openai",
    model: "original-model",
  };
  const sync = {
    apiKeys: { openai: "test-key" },
    prompts: [{ ...originalPrompt, model: "changed-model", template: "Changed" }],
    defaultPromptId: "translate",
  };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      onMessage: event("message"),
      onConnect: event("connect"),
      onInstalled: event("installed"),
    },
    storage: {
      sync: { async get() { return sync; } },
      local: {
        async get() { return structuredClone(local); },
        async set(items) { Object.assign(local, structuredClone(items)); },
      },
    },
    contextMenus: { onClicked: event("contextMenu") },
    commands: { onCommand: event("command") },
  };
  t.after(() => { globalThis.chrome = originalChrome; });
  const requests = [];
  let emptyResponse = false;
  let failResponse = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (failResponse) throw new Error("Provider unavailable");
    const text = emptyResponse ? "" : `reply-${requests.length}`;
    return new Response(init.body.includes('"stream":true')
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
  await import("../../build/extension/src/background.js");

  const generate = (history, overrides = {}) => new Promise((resolve) => {
    listeners.message({
      type: "GENERATE", inputText: "Why?", prompt: originalPrompt, history,
      ...overrides,
    }, { id: "test-extension" }, resolve);
  });
  let lastStreamEnd;
  const stream = (history, overrides = {}) => new Promise((resolve, reject) => {
    let onMessage;
    let text = "";
    listeners.connect({
      name: "wild:generate",
      sender: { id: "test-extension" },
      onMessage: { addListener(listener) { onMessage = listener; } },
      onDisconnect: { addListener() {} },
      postMessage(message) {
        if (message.type === "STREAM_DELTA") text += message.delta;
        if (message.type === "STREAM_END") {
          lastStreamEnd = message;
          resolve(text);
        }
        if (message.type === "STREAM_ERROR") reject(new Error(message.error));
      },
    });
    onMessage({
      type: "GENERATE_STREAM", inputText: "Why?", prompt: originalPrompt, history,
      ...overrides,
    });
  });
  const first = [
    { role: "user", content: "Translate: hello" },
    { role: "assistant", content: "こんにちは" },
  ];
  const second = [
    { role: "user", content: "Translate: goodbye" },
    { role: "assistant", content: "さようなら" },
  ];
  assert.deepEqual(await generate(first), { ok: true, text: "reply-1" });
  assert.equal(local.translationHistory.length, 1);
  assert.deepEqual(await generate(first), { ok: true, text: "reply-1" });
  assert.equal(local.translationHistory.length, 2);
  assert.equal(await stream(first), "reply-1");
  assert.equal(local.translationHistory.length, 3);
  assert.equal(requests.length, 1);
  assert.equal(await stream(second), "reply-2");
  assert.equal(local.translationHistory.length, 4);
  assert.equal(await stream(second), "reply-2");
  assert.equal(local.translationHistory.length, 5);
  assert.deepEqual(local.translationHistory[0].prompt, originalPrompt);
  assert.deepEqual(local.translationHistory[0].messages, [
    ...second, { role: "user", content: "Why?" },
    { role: "assistant", content: "reply-2" },
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "original-model");
  assert.equal(requests[1].model, "original-model");
  assert.deepEqual(requests[1].messages, [
    ...second, { role: "user", content: "Why?" },
  ]);

  for (const streaming of [false, true]) {
    await t.test(`empty ${streaming ? "streaming" : "non-streaming"} responses are retried without using the cache`, async () => {
      emptyResponse = true;
      const retryHistory = [
        { role: "user", content: streaming ? "Streaming retry" : "Retry" },
        { role: "assistant", content: "Earlier answer" },
      ];
      const before = requests.length;
      const historyBefore = structuredClone(local.translationHistory);
      const request = () => streaming ? stream(retryHistory) : generate(retryHistory);
      await request();
      await request();
      assert.equal(requests.length, before + 2);
      assert.deepEqual(local.translationHistory, historyBefore);
    });
  }

  await t.test("history remains enabled when caching is disabled and follow-ups update the same entry", async () => {
    emptyResponse = false;
    local.cacheEnabled = false;
    const before = local.translationHistory.length;
    const response = await generate([], {
      conversationId: "continued", inputText: "Original source",
      originalInputText: "Original source",
    });
    assert.equal(response.ok, true);
    const entry = structuredClone(local.translationHistory[0]);
    assert.equal(entry.id, "continued");
    await stream(entry.messages, {
      conversationId: entry.id, originalInputText: entry.inputText,
    });
    assert.equal(local.translationHistory.length, before + 1);
    assert.equal(local.translationHistory[0].id, entry.id);
    assert.equal(local.translationHistory[0].inputText, "Original source");
    assert.equal(local.translationHistory[0].messages.length, 4);
  });

  await t.test("provider failures do not overwrite completed history", async () => {
    failResponse = true;
    const before = structuredClone(local.translationHistory);
    assert.deepEqual(await generate([]), { ok: false, error: "Provider unavailable" });
    await assert.rejects(stream([]), /Provider unavailable/);
    assert.deepEqual(local.translationHistory, before);
    failResponse = false;
  });

  await t.test("history storage failures report a warning while fresh and cached translations succeed", async () => {
    local.cacheEnabled = true;
    const before = structuredClone(local.translationHistory);
    const set = chrome.storage.local.set;
    chrome.storage.local.set = async (items) => {
      if ("translationHistory" in items) throw new Error("Storage full");
      await set(items);
    };
    try {
      for (const streaming of [false, true]) {
        const overrides = { inputText: `Storage failure ${streaming}` };
        let firstResponse;
        for (const cached of [false, true]) {
          const beforeRequests = requests.length;
          if (streaming) {
            const text = await stream([], overrides);
            assert.match(text, /^reply-/);
            assert.match(lastStreamEnd.historyError, /history could not be saved.*Storage full/);
            firstResponse ??= text;
            assert.equal(text, firstResponse);
          } else {
            const response = await generate([], overrides);
            assert.equal(response.ok, true);
            assert.match(response.text, /^reply-/);
            assert.match(response.historyError, /history could not be saved.*Storage full/);
            firstResponse ??= response.text;
            assert.equal(response.text, firstResponse);
          }
          assert.equal(requests.length, beforeRequests + (cached ? 0 : 1));
          assert.deepEqual(local.translationHistory, before);
        }
      }
    } finally {
      chrome.storage.local.set = set;
    }
  });

  await t.test("disconnecting after a partial stream does not save an entry", async () => {
    const before = structuredClone(local.translationHistory);
    const messages = [];
    let onMessage;
    let onDisconnect;
    const disconnected = new Promise((resolve) => {
      listeners.connect({
        name: "wild:generate", sender: { id: "test-extension" },
        onMessage: { addListener(listener) { onMessage = listener; } },
        onDisconnect: { addListener(listener) { onDisconnect = listener; } },
        postMessage(message) {
          messages.push(message);
          if (message.type === "STREAM_DELTA") {
            onDisconnect();
            resolve();
          }
        },
      });
    });
    onMessage({ type: "GENERATE_STREAM", inputText: "Interrupted", prompt: originalPrompt });
    await disconnected;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(messages.some((message) => message.type === "STREAM_END"), false);
    assert.deepEqual(local.translationHistory, before);
  });
});
