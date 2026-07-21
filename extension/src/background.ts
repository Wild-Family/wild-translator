import {
  generate,
  generateStream,
  requireApiKey,
} from "./providers.js";
import { storage } from "./storage.js";

type GenerateMessage = {
  type: "GENERATE";
  inputText: string;
  promptId?: string;
};

type OpenUiWithTextMessage = {
  type: "OPEN_UI_WITH_TEXT";
  text: string;
  fallbackToTab?: boolean;
};

type GenerateResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

type CacheEntry = {
  text: string;
  ts: number;
};

const CACHE_KEY = "wildCache";
const CACHE_MAX = 50;
let pendingDraftText: string | undefined;

chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!msg?.type) return;

  if (msg.type === "GENERATE") {
    (async () => {
      try {
        const { inputText, promptId } = msg as GenerateMessage;
        const s = await storage.getAll();
        const pid = promptId ?? s.defaultPromptId ?? s.prompts[0]?.id;
        const prompt = s.prompts.find((p) => p.id === pid) ?? s.prompts[0];
        if (!prompt) throw new Error("No prompt configured");

        const provider = prompt.provider ?? "openai";
        const apiKey = requireApiKey(provider, s.apiKeys);
        const baseUrl = s.baseUrls?.[provider];
        const cacheKey = await buildCacheKey({
          provider,
          model: prompt.model,
          baseUrl,
          template: prompt.template,
          inputText,
        });
        const cached = await cacheGet(cacheKey);
        if (cached) {
          sendResponse({
            ok: true,
            text: cached.text,
          } satisfies GenerateResponse);
          return;
        }

        const result = await generate({
          provider,
          apiKey,
          model: prompt.model,
          baseUrl,
          inputText,
          template: prompt.template,
        });

        await cacheSet(cacheKey, result.text);
        sendResponse({
          ok: true,
          text: result.text,
        } satisfies GenerateResponse);
      } catch (e: any) {
        sendResponse({
          ok: false,
          error: e?.message ?? String(e),
        } satisfies GenerateResponse);
      }
    })();

    return true; // async
  }

  if (msg.type === "CONSUME_PENDING_DRAFT") {
    const text = pendingDraftText;
    pendingDraftText = undefined;
    sendResponse({
      ok: true,
      hasDraft: typeof text === "string",
      text,
    });
    return;
  }

  if (msg.type === "OPEN_UI_WITH_TEXT") {
    (async () => {
      try {
        const { text, fallbackToTab } = msg as OpenUiWithTextMessage;
        await openUiWithText(text ?? "", { fallbackToTab: fallbackToTab === true });
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message ?? String(e) });
      }
    })();
    return true;
  }

});

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return;
  if (port.name !== "wild:generate") return;
  let disconnected = false;
  let activeAbortController: AbortController | null = null;
  const postPortMessage = (message: any) => {
    if (disconnected) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      disconnected = true;
      return false;
    }
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    activeAbortController?.abort();
  });

  port.onMessage.addListener((msg: any) => {
    if (msg?.type !== "GENERATE_STREAM") return;

    (async () => {
      const abortController = new AbortController();
      activeAbortController?.abort();
      activeAbortController = abortController;

      try {
        const { inputText, promptId } = msg as {
          type: "GENERATE_STREAM";
          inputText: string;
          promptId?: string;
        };
        const s = await storage.getAll();
        const pid = promptId ?? s.defaultPromptId ?? s.prompts[0]?.id;
        const prompt = s.prompts.find((p) => p.id === pid) ?? s.prompts[0];
        if (!prompt) throw new Error("No prompt configured");

        const provider = prompt.provider ?? "openai";
        const apiKey = requireApiKey(provider, s.apiKeys);
        const baseUrl = s.baseUrls?.[provider];
        const cacheKey = await buildCacheKey({
          provider,
          model: prompt.model,
          baseUrl,
          template: prompt.template,
          inputText,
        });
        const cached = await cacheGet(cacheKey);
        if (cached) {
          if (!postPortMessage({ type: "STREAM_START" })) return;
          if (
            cached.text &&
            !postPortMessage({ type: "STREAM_DELTA", delta: cached.text })
          ) {
            return;
          }
          postPortMessage({ type: "STREAM_END" });
          return;
        }

        if (!postPortMessage({ type: "STREAM_START" })) return;
        let acc = "";
        for await (const delta of generateStream({
          provider,
          apiKey,
          model: prompt.model,
          baseUrl,
          inputText,
          template: prompt.template,
          signal: abortController.signal,
        })) {
          if (abortController.signal.aborted) return;
          const textDelta = String(delta ?? "");
          acc += textDelta;
          if (
            textDelta &&
            !postPortMessage({ type: "STREAM_DELTA", delta: textDelta })
          ) {
            return;
          }
        }
        if (abortController.signal.aborted) return;
        await cacheSet(cacheKey, acc);
        postPortMessage({ type: "STREAM_END" });
      } catch (e: any) {
        if (abortController.signal.aborted) return;
        postPortMessage({
          type: "STREAM_ERROR",
          error: e?.message ?? String(e),
        });
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    })();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "wild:open",
    title: "Translate with わいるどぱんち",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "wild:open") return;
  const text = info.selectionText ?? "";
  await openUiWithText(text ?? "");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_ui") return;
  await openPopupOrTab({ fallbackToTab: true });
});

async function openUiWithText(
  text: string,
  options: { fallbackToTab: boolean } = { fallbackToTab: true },
) {
  const draftText = text ?? "";
  pendingDraftText = draftText;
  await openPopupOrTab(options);
  void setDraftText(draftText);
}

async function openPopupOrTab(options: { fallbackToTab: boolean }) {
  try {
    // Try to open the action popup (works in MV3 with user gesture).
    await chrome.action.openPopup();
  } catch {
    if (!options.fallbackToTab) {
      throw new Error("Chrome rejected opening the toolbar popup.");
    }

    const url = chrome.runtime.getURL("ui/popup/index.html");
    await chrome.tabs.create({ url });
  }
}

async function setDraftText(text: string) {
  // storage.session is MV3-only and stays local to the browser profile.
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ draftText: text });
  } else {
    await chrome.storage.local.set({ draftText: text });
  }
}

async function buildCacheKey(input: Record<string, unknown>): Promise<string> {
  const raw = JSON.stringify(input);
  const data = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cacheGet(key: string): Promise<CacheEntry | null> {
  try {
    const enabled = await cacheEnabled();
    if (!enabled) return null;
    const store = await chrome.storage.local.get([CACHE_KEY]);
    const cache = (store?.[CACHE_KEY] ?? {}) as Record<string, CacheEntry>;
    const hit = cache[key];
    if (!hit) return null;
    return hit;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, text: string): Promise<void> {
  try {
    const enabled = await cacheEnabled();
    if (!enabled) return;
    const store = await chrome.storage.local.get([CACHE_KEY]);
    const cache = (store?.[CACHE_KEY] ?? {}) as Record<string, CacheEntry>;
    cache[key] = { text, ts: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => (cache[a]?.ts ?? 0) - (cache[b]?.ts ?? 0))
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  } catch {
    // ignore
  }
}

async function cacheEnabled(): Promise<boolean> {
  try {
    const store = await chrome.storage.local.get(["cacheEnabled"]);
    if (typeof store?.cacheEnabled === "boolean") return store.cacheEnabled;
  } catch {
    // ignore
  }
  return true;
}
