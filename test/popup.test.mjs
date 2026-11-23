import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

let moduleId = 0;

function chromeEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      return Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function storageArea(values = {}) {
  return {
    values,
    async get(keys) {
      return Object.fromEntries(
        keys.filter((key) => key in values).map((key) => [key, values[key]]),
      );
    },
    async set(next) {
      Object.assign(values, structuredClone(next));
    },
    async remove(keys) {
      for (const key of keys) delete values[key];
    },
  };
}

class Element extends EventTarget {
  hidden = false;
  value = "";
  textContent = "";
  dataset = {};
  classList = { remove() {}, toggle() {} };

  append(...children) {
    this.textContent += children.map((child) => child.textContent).join("");
  }

  replaceChildren(...children) {
    this.textContent = "";
    this.append(...children);
  }

  setAttribute() {}
  focus() {}
  setSelectionRange() {}
}

async function setup(t, {
  local = {}, session = {}, rejectPopup = false, manualStream = false,
} = {}) {
  const timers = new Set();
  const requests = [];
  const ports = [];
  const opened = [];
  const previousGlobals = {
    chrome: globalThis.chrome,
    window: globalThis.window,
    document: globalThis.document,
  };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });

  let elements;
  async function openPopup() {
    elements = new Map();
    globalThis.document = Object.assign(new EventTarget(), {
      documentElement: new Element(),
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement: () => new Element(),
      createDocumentFragment: () => new Element(),
      createTextNode: (textContent) => ({ textContent }),
    });
    globalThis.window = Object.assign(new EventTarget(), {
      setTimeout(callback, ms) {
        const timer = setTimeout(callback, ms);
        timers.add(timer);
        return timer;
      },
      clearTimeout,
      requestAnimationFrame: (callback) => queueMicrotask(callback),
    });

    await import(`../build/ui/src/popup/index.js?test=${moduleId++}`);
    for (let attempt = 0; attempt < 200; attempt++) {
      if (elements.get("popup-loading").hidden) {
        await delay(0);
        if (!manualStream) await waitForIdle();
        assert.equal(elements.get("popup-error").textContent, "");
        return;
      }
      await delay(5);
    }
    assert.fail("Popup did not finish initializing");
  }

  async function waitForIdle() {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (elements.get("popup-run").textContent !== "Stop") return;
      await delay(5);
    }
    assert.fail("Generation did not finish");
  }

  const chrome = {
    storage: {
      sync: storageArea({
        prompts: [
          { id: "translate", name: "Translate", template: "{{text}}" },
          { id: "custom", name: "Custom", template: "{{text}}" },
        ],
        defaultPromptId: "translate",
      }),
      local: storageArea(local),
      session: storageArea(session),
    },
    runtime: {
      id: "test-extension",
      onMessage: chromeEvent(),
      onConnect: chromeEvent(),
      onInstalled: chromeEvent(),
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      async sendMessage(message) {
        let response;
        await chrome.runtime.onMessage.emit(
          message,
          { id: chrome.runtime.id },
          (value) => { response = value; },
        );
        return response;
      },
      connect({ name }) {
        assert.equal(name, "wild:generate");
        const port = {
          onMessage: chromeEvent(),
          onDisconnect: chromeEvent(),
          disconnect() {
            void port.onDisconnect.emit();
          },
          postMessage(message) {
            assert.equal(elements.get("popup-loading").hidden, true);
            requests.push(structuredClone(message));
            if (!manualStream) {
              queueMicrotask(async () => {
                await port.onMessage.emit({ type: "STREAM_DELTA", delta: "OK" });
                await port.onMessage.emit({ type: "STREAM_END" });
              });
            }
          },
        };
        ports.push(port);
        return port;
      },
    },
    contextMenus: { onClicked: chromeEvent() },
    commands: { onCommand: chromeEvent() },
    action: {
      async openPopup() {
        if (rejectPopup) throw new Error("Popup unavailable");
        opened.push("popup");
        await openPopup();
      },
    },
    tabs: {
      async create({ url }) {
        assert.ok(url.endsWith("ui/popup/index.html"));
        opened.push("tab");
        await openPopup();
      },
    },
  };
  globalThis.chrome = chrome;
  await import(`../build/extension/src/background.js?test=${moduleId++}`);

  return {
    chrome,
    requests,
    opened,
    openPopup,
    waitForIdle,
    respond: (message) => ports.at(-1).onMessage.emit(message),
    type(id, value) {
      const element = elements.get(id);
      element.value = value;
      element.dispatchEvent(new Event("input"));
    },
    submit() {
      elements.get("popup-follow-up-form").dispatchEvent(
        new Event("submit", { cancelable: true }),
      );
    },
    shortcut(type, properties = {}) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperties(event, Object.fromEntries(
        Object.entries({
          key: "Enter", ctrlKey: true,
          target: elements.get("popup-follow-up"), ...properties,
        }).map(([key, value]) => [key, { value }]),
      ));
      window.dispatchEvent(event);
    },
    element: (id) => elements.get(id),
    rightClick: (text) => chrome.contextMenus.onClicked.emit({
      menuItemId: "wild:open",
      selectionText: text,
    }),
  };
}

test("context-menu translation runs automatically after restoring the selected prompt", async (t) => {
  const popup = await setup(t, {
    local: {
      popupDraft: { input: "Old input", output: "Old output", promptId: "custom" },
    },
  });

  await popup.rightClick("Selected text");

  assert.deepEqual(popup.requests, [{
    type: "GENERATE_STREAM",
    inputText: "Selected text",
    promptId: "custom",
    prompt: { id: "custom", name: "Custom", template: "{{text}}" },
    history: [],
  }]);
  assert.equal(popup.element("popup-input").value, "Selected text");
  assert.equal(popup.element("popup-output").textContent, "OK");
});

test("opening the popup normally restores the draft without running", async (t) => {
  const popup = await setup(t, {
    local: { popupDraft: { input: "Saved input", output: "Saved output" } },
  });

  await popup.openPopup();

  assert.deepEqual(popup.requests, []);
  assert.equal(popup.element("popup-input").value, "Saved input");
  assert.equal(popup.element("popup-output").textContent, "Saved output");
});

test("reopening the popup does not run the consumed selection again", async (t) => {
  const popup = await setup(t);

  await popup.rightClick("Run once");
  await popup.openPopup();

  assert.equal(popup.requests.length, 1);
  assert.equal(popup.element("popup-input").value, "Run once");
  assert.equal("draftText" in popup.chrome.storage.session.values, false);
});

test("a draft recovered from storage after a worker restart also runs once", async (t) => {
  const popup = await setup(t, { session: { draftText: "Recovered selection" } });
  popup.chrome.runtime.sendMessage = async () => {
    throw new Error("Worker unavailable");
  };

  await popup.openPopup();
  await popup.openPopup();

  assert.equal(popup.requests.length, 1);
  assert.equal(popup.requests[0].inputText, "Recovered selection");
});

test("context-menu translation also runs when opening in a fallback tab", async (t) => {
  const popup = await setup(t, { rejectPopup: true });

  await popup.rightClick("Translate in a tab");

  assert.deepEqual(popup.opened, ["tab"]);
  assert.equal(popup.requests.length, 1);
  assert.equal(popup.requests[0].inputText, "Translate in a tab");
});

test("disabled selection prefill discards the selection without running the saved draft", async (t) => {
  const popup = await setup(t, {
    local: { selectionPrefillEnabled: false, popupDraft: { input: "Saved input" } },
  });

  await popup.rightClick("Ignored selection");

  assert.deepEqual(popup.requests, []);
  assert.equal(popup.element("popup-input").value, "Saved input");

  await popup.chrome.storage.local.set({ selectionPrefillEnabled: true });
  await popup.openPopup();

  assert.deepEqual(popup.requests, []);
  assert.equal(popup.element("popup-input").value, "Saved input");
});

for (const text of ["", " \n\t"]) {
  test(`blank selection ${JSON.stringify(text)} does not run or restore old input`, async (t) => {
    const popup = await setup(t, {
      local: { popupDraft: { input: "Saved input" } },
    });

    await popup.rightClick(text);

    assert.deepEqual(popup.requests, []);
    assert.equal(popup.element("popup-input").value, text);
  });
}

function savedConversation() {
  return {
    popupDraft: {
      input: "hello",
      output: "こんにちは",
      promptId: "translate",
      conversation: {
        prompt: {
          id: "translate", name: "Translate", template: "Translate: {{text}}",
          provider: "claude", model: "original-model",
        },
        messages: [
          { role: "user", content: "Translate: hello" },
          { role: "assistant", content: "こんにちは" },
        ],
      },
    },
  };
}

async function finish(popup, text) {
  if (text !== undefined) {
    await popup.respond({ type: "STREAM_DELTA", delta: text });
  }
  await popup.respond({ type: "STREAM_END" });
  await popup.waitForIdle();
}

test("follow-ups keep the original preset and history after input/preset edits and reopening", async (t) => {
  const local = savedConversation();
  const original = structuredClone(local.popupDraft.conversation);
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-input", "Changed input");
  popup.element("popup-prompt-select").value = "custom";
  popup.element("popup-prompt-select").dispatchEvent(new Event("change"));
  popup.type("popup-follow-up", "Why?");
  popup.submit();

  assert.deepEqual(popup.requests[0].history, original.messages);
  assert.deepEqual(popup.requests[0].prompt, original.prompt);
  assert.equal(popup.requests[0].inputText, "Why?");
  await finish(popup, "First answer");
  popup.type("popup-follow-up", "Unsent question");
  window.dispatchEvent(new Event("pagehide"));
  await popup.openPopup();

  assert.equal(popup.element("popup-follow-up").value, "Unsent question");
  popup.submit();
  assert.equal(popup.requests[1].history.length, 4);
  assert.deepEqual(popup.requests[1].prompt, original.prompt);
  await finish(popup, "Second answer");
});

test("an empty response restores the conversation and question before retrying", async (t) => {
  const local = savedConversation();
  const original = structuredClone(local.popupDraft.conversation);
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-follow-up", "Why?");
  popup.submit();
  await finish(popup);

  assert.deepEqual(local.popupDraft.conversation, original);
  assert.equal(popup.element("popup-follow-up").value, "Why?");
  assert.match(popup.element("popup-error").textContent, /no response/i);
  popup.submit();
  assert.deepEqual(popup.requests[1].history, original.messages);
  await finish(popup, "Retry answer");
});

for (const keyEvent of ["repeat", "keyup"]) {
  test(`Ctrl+Enter ${keyEvent} does not stop an active follow-up`, async (t) => {
    const popup = await setup(t, { local: savedConversation(), manualStream: true });
    await popup.openPopup();
    let now = 1000;
    t.mock.method(Date, "now", () => now);
    popup.type("popup-follow-up", "Why?");
    popup.shortcut("keydown");
    assert.equal(popup.requests.length, 1);
    now += 500;
    popup.shortcut(keyEvent === "repeat" ? "keydown" : "keyup", {
      repeat: keyEvent === "repeat",
    });

    assert.equal(popup.element("popup-run").textContent, "Stop");
    assert.equal(popup.requests.length, 1);
    await finish(popup, "Answer");
  });
}

test("confirming an IME composition does not submit the follow-up on keyup", async (t) => {
  const popup = await setup(t, { local: savedConversation(), manualStream: true });
  await popup.openPopup();
  popup.type("popup-follow-up", "日本語の質問");
  popup.shortcut("keydown", { isComposing: true });
  popup.shortcut("keyup", { isComposing: false });
  assert.equal(popup.requests.length, 0);
});

test("a provider error after partial output restores the previous conversation and draft", async (t) => {
  const local = savedConversation();
  const original = structuredClone(local.popupDraft.conversation);
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-follow-up", "Try again");
  popup.submit();
  await popup.respond({ type: "STREAM_DELTA", delta: "Partial text" });
  await popup.respond({ type: "STREAM_ERROR", error: "Rate limited" });
  await popup.waitForIdle();
  assert.deepEqual(local.popupDraft.conversation, original);
  assert.equal(popup.element("popup-follow-up").value, "Try again");
  assert.equal(popup.element("popup-error").textContent, "Rate limited");
});
