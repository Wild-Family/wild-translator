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
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const text = `reply-${requests.length}`;
    return new Response(init.body.includes('"stream":true')
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
  await import("../../build/extension/src/background.js");

  const generate = (history) => new Promise((resolve) => {
    listeners.message({
      type: "GENERATE", inputText: "Why?", prompt: originalPrompt, history,
    }, { id: "test-extension" }, resolve);
  });
  const stream = (history) => new Promise((resolve, reject) => {
    let onMessage;
    let text = "";
    listeners.connect({
      name: "wild:generate",
      sender: { id: "test-extension" },
      onMessage: { addListener(listener) { onMessage = listener; } },
      onDisconnect: { addListener() {} },
      postMessage(message) {
        if (message.type === "STREAM_DELTA") text += message.delta;
        if (message.type === "STREAM_END") resolve(text);
        if (message.type === "STREAM_ERROR") reject(new Error(message.error));
      },
    });
    onMessage({
      type: "GENERATE_STREAM", inputText: "Why?", prompt: originalPrompt, history,
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
  assert.deepEqual(await generate(first), { ok: true, text: "reply-1" });
  assert.equal(await stream(first), "reply-1");
  assert.equal(requests.length, 1);
  assert.equal(await stream(second), "reply-2");
  assert.equal(await stream(second), "reply-2");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "original-model");
  assert.equal(requests[1].model, "original-model");
  assert.deepEqual(requests[1].messages, [
    ...second, { role: "user", content: "Why?" },
  ]);
});
