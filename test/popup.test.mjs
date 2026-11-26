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
  children = [];
  ownText = "";
  dataset = {};
  classList = { remove() {}, toggle() {} };

  append(...children) {
    for (const child of children) {
      if (child.isFragment) this.children.push(...child.children);
      else this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.textContent = "";
    this.append(...children);
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this.ownText = value;
    this.children = [];
  }

  setAttribute() {}
  focus() {}
  setSelectionRange() {}
}

async function setup(t, {
  local = {}, session = {}, rejectPopup = false, manualStream = false,
  allowStartupError = false,
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
      createDocumentFragment: () => Object.assign(new Element(), { isFragment: true }),
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
        if (!allowStartupError) assert.equal(elements.get("popup-error").textContent, "");
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
        return new Promise((resolve, reject) => {
          void chrome.runtime.onMessage.emit(
            message, { id: chrome.runtime.id }, resolve,
          ).then((results) => {
            if (!results.includes(true)) resolve(undefined);
          }, reject);
        });
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
    conversationId: popup.chrome.storage.local.values.popupDraft.conversation.id,
    originalInputText: "Selected text",
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
  const popup = await setup(t, { session: { draftText: "Recovered selection" }, allowStartupError: true });
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
        id: "saved-conversation",
        inputText: "hello",
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
  assert.equal(popup.requests[0].originalInputText, "hello");
  assert.equal(popup.requests[0].conversationId, original.id);
  await finish(popup, "First answer");
  popup.type("popup-follow-up", "Unsent question");
  window.dispatchEvent(new Event("pagehide"));
  await popup.openPopup();

  assert.equal(popup.element("popup-follow-up").value, "Unsent question");
  popup.submit();
  assert.equal(popup.requests[1].history.length, 4);
  assert.deepEqual(popup.requests[1].prompt, original.prompt);
  assert.equal(popup.requests[1].conversationId, original.id);
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

function historyEntry(id, updatedAt) {
  return {
    ...savedConversation().popupDraft.conversation,
    id, createdAt: updatedAt, updatedAt,
  };
}

async function click(popup, id) {
  popup.element(id).dispatchEvent(new Event("click"));
  await delay(0);
}

test("History recovers the existing saved translation without another API call", async (t) => {
  const local = savedConversation();
  const popup = await setup(t, { local });
  await popup.openPopup();
  await click(popup, "popup-history-button");

  assert.equal(popup.element("popup-history-count").textContent, "1 / 50");
  assert.match(popup.element("popup-history-list").textContent, /hello.*こんにちは/s);
  assert.equal(local.translationHistory[0].id, local.popupDraft.conversation.id);
  assert.deepEqual(popup.requests, []);
});

test("recovering an older response precedes replacing its draft with a new selection", async (t) => {
  const local = { popupDraft: {
    input: "Previous source", output: "Previous response", promptId: "translate",
  } };
  const popup = await setup(t, { local });
  await popup.rightClick("New selection");
  await click(popup, "popup-history-button");
  assert.equal(popup.element("popup-history-count").textContent, "2 / 50");
  assert.match(popup.element("popup-history-list").textContent, /Previous source.*Previous response/s);
  await popup.openPopup();
  assert.equal(local.translationHistory.length, 2);
  assert.deepEqual(popup.requests.map((request) => request.inputText), ["New selection"]);
});

test("stopped partial responses stay out of History after reopening", async (t) => {
  const local = {};
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-input", "hello");
  await click(popup, "popup-run");
  await popup.respond({ type: "STREAM_DELTA", delta: "Partial response" });
  await click(popup, "popup-run");
  assert.equal(local.popupDraft.completed, false);
  await popup.openPopup();
  await click(popup, "popup-history-button");
  assert.equal(popup.element("popup-history-count").textContent, "0 / 50");
});

test("history save warnings preserve the completed response and allow later recovery", async (t) => {
  const local = {};
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-input", "hello");
  await click(popup, "popup-run");
  await popup.respond({ type: "STREAM_DELTA", delta: "こんにちは" });
  await popup.respond({ type: "STREAM_END", historyError: "History storage is full" });
  await popup.waitForIdle();
  assert.equal(popup.element("popup-output").textContent, "こんにちは");
  assert.equal(popup.element("popup-error").textContent, "History storage is full");
  assert.equal(local.popupDraft.completed, true);
  await click(popup, "popup-history-button");
  assert.equal(popup.element("popup-history-count").textContent, "1 / 50");
});

test("history loading failures are visible while the translator remains usable", async (t) => {
  const popup = await setup(t, { allowStartupError: true });
  const get = popup.chrome.storage.local.get;
  popup.chrome.storage.local.get = async (keys) => {
    if (keys.includes("translationHistory")) throw new Error("Storage unavailable");
    return get(keys);
  };
  await popup.openPopup();
  assert.match(popup.element("popup-error").textContent, /Could not load translation history.*Storage unavailable/);
  await click(popup, "popup-history-button");
  assert.match(popup.element("popup-error").textContent, /Storage unavailable/);
  assert.equal(popup.element("popup-history-count").textContent, "");
});

test("History lists the latest 50 translations with original text and response previews", async (t) => {
  const entries = Array.from({ length: 55 }, (_, index) => ({
    ...historyEntry(`translation-${index}`, index + 1), inputText: `Source ${index}`,
  }));
  const popup = await setup(t, { local: { translationHistory: entries } });
  await popup.openPopup();
  await click(popup, "popup-history-button");

  assert.equal(popup.element("popup-history").hidden, false);
  assert.equal(popup.element("popup-history-count").textContent, "50 / 50");
  assert.equal(popup.element("popup-history-empty").hidden, true);
  const items = popup.element("popup-history-list").children;
  assert.equal(items.length, 50);
  assert.match(items[0].textContent, /Source 54.*こんにちは/s);
  assert.match(items.at(-1).textContent, /Source 5.*こんにちは/s);
  assert.deepEqual(popup.requests, []);
});

test("reopening an entry restores its complete conversation and continues with its original preset", async (t) => {
  const entry = historyEntry("old-translation", 1000);
  entry.prompt.id = "deleted-preset";
  entry.messages.push(
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
  );
  const local = { translationHistory: [entry] };
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  await click(popup, "popup-history-button");
  popup.element("popup-history-list").children[0].children[0].dispatchEvent(new Event("click"));

  assert.equal(popup.element("popup-history").hidden, true);
  assert.equal(popup.element("popup-input").value, "hello");
  assert.match(popup.element("popup-output").textContent, /こんにちは.*Earlier question.*Earlier answer/s);
  assert.equal(popup.element("popup-follow-up-form").hidden, false);
  assert.deepEqual(popup.requests, []);
  await popup.openPopup();
  assert.equal(local.popupDraft.conversation.id, entry.id);

  popup.type("popup-input", "Edited source");
  popup.type("popup-follow-up", "Continue");
  popup.submit();
  assert.equal(popup.requests[0].conversationId, entry.id);
  assert.equal(popup.requests[0].originalInputText, "hello");
  assert.deepEqual(popup.requests[0].history, entry.messages);
  assert.deepEqual(popup.requests[0].prompt, entry.prompt);
  await finish(popup, "New answer");
  assert.equal(local.translationHistory[0].messages.length, 4);
});

test("Back and Escape preserve the current draft and shortcuts do not run from History", async (t) => {
  const popup = await setup(t, { local: savedConversation() });
  await popup.openPopup();
  popup.type("popup-input", "Unsent input");
  popup.type("popup-follow-up", "Unsent question");
  await click(popup, "popup-history-button");
  assert.equal(popup.element("popup-history-count").textContent, "1 / 50");
  popup.shortcut("keydown");
  assert.deepEqual(popup.requests, []);
  await click(popup, "popup-history-back");
  assert.equal(popup.element("popup-history").hidden, true);
  assert.equal(popup.element("popup-input").value, "Unsent input");
  assert.equal(popup.element("popup-follow-up").value, "Unsent question");
  await click(popup, "popup-history-button");
  popup.shortcut("keydown", { key: "Escape", ctrlKey: false });
  assert.equal(popup.element("popup-history").hidden, true);
});

test("History is disabled during generation", async (t) => {
  const popup = await setup(t, { manualStream: true });
  await popup.openPopup();
  popup.type("popup-input", "hello");
  await click(popup, "popup-run");
  assert.equal(popup.element("popup-history-button").disabled, true);
  await click(popup, "popup-history-button");
  assert.equal(popup.element("popup-history").hidden, true);
  await finish(popup, "こんにちは");
  assert.equal(popup.element("popup-history-button").disabled, false);
});

test("legacy drafts keep their original input when a follow-up creates their first history entry", async (t) => {
  const local = savedConversation();
  delete local.popupDraft.conversation.id;
  delete local.popupDraft.conversation.inputText;
  const popup = await setup(t, { local, manualStream: true });
  await popup.openPopup();
  popup.type("popup-input", "Edited input");
  popup.type("popup-follow-up", "Why?");
  popup.submit();
  assert.equal(popup.requests[0].originalInputText, "hello");
  assert.equal(typeof popup.requests[0].conversationId, "string");
  await finish(popup, "Answer");
});
