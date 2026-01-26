import { generate, generateStream, requireApiKey } from "./providers";
import { storage } from "./storage";

type GenerateMessage = {
  type: "GENERATE";
  inputText: string;
  promptId?: string;
};

type GetSelectionMessage = {
  type: "GET_SELECTION";
};

type OpenUiWithTextMessage = {
  type: "OPEN_UI_WITH_TEXT";
  text: string;
};

type GenerateResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
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

        const result = await generate({
          provider,
          apiKey,
          model: prompt.model,
          inputText,
          template: prompt.template
        });

        sendResponse({ ok: true, text: result.text } satisfies GenerateResponse);
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message ?? String(e) } satisfies GenerateResponse);
      }
    })();

    return true; // async
  }

  if (msg.type === "GET_SELECTION") {
    (async () => {
      try {
        const text = await getSelectionTextFromActiveTab();
        sendResponse({ ok: true, text });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message ?? String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "OPEN_UI_WITH_TEXT") {
    (async () => {
      try {
        const { text } = msg as OpenUiWithTextMessage;
        await openUiWithText(text ?? "");
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message ?? String(e) });
      }
    })();
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "wild:generate") return;

  port.onMessage.addListener((msg: any) => {
    if (msg?.type !== "GENERATE_STREAM") return;

    (async () => {
      try {
        const { inputText, promptId } = msg as { type: "GENERATE_STREAM"; inputText: string; promptId?: string };
        const s = await storage.getAll();
        const pid = promptId ?? s.defaultPromptId ?? s.prompts[0]?.id;
        const prompt = s.prompts.find((p) => p.id === pid) ?? s.prompts[0];
        if (!prompt) throw new Error("No prompt configured");

        const provider = prompt.provider ?? "openai";
        const apiKey = requireApiKey(provider, s.apiKeys);

        port.postMessage({ type: "STREAM_START" });
        for await (const delta of generateStream({
          provider,
          apiKey,
          model: prompt.model,
          inputText,
          template: prompt.template
        })) {
          port.postMessage({ type: "STREAM_DELTA", delta });
        }
        port.postMessage({ type: "STREAM_END" });
      } catch (e: any) {
        port.postMessage({ type: "STREAM_ERROR", error: e?.message ?? String(e) });
      }
    })();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "wild:open",
    title: "Open Wild Translator",
    contexts: ["page", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "wild:open") return;
  const text = info.selectionText ?? (await getSelectionTextFromActiveTab());
  await openUiWithText(text ?? "");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open_ui") return;
  const text = await getSelectionTextFromActiveTab();
  await setDraftText(text ?? "");

  try {
    // Try to open the action popup (works in MV3 with user gesture).
    await chrome.action.openPopup();
  } catch {
    // Fallback to tab if popup cannot be opened.
    const url = chrome.runtime.getURL("ui/popup/index.html");
    await chrome.tabs.create({ url });
  }
});

async function openUiWithText(text: string) {
  await setDraftText(text ?? "");
  await chrome.action.openPopup();
}

async function setDraftText(text: string) {
  // storage.session is MV3-only and stays local to the browser profile.
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ draftText: text });
  } else {
    await chrome.storage.local.set({ draftText: text });
  }
}

async function getSelectionTextFromActiveTab(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";
  const url = tab.url ?? "";
  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension://")
  ) {
    return "";
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript<{ result: string }>({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection?.();
        return sel?.toString?.() ?? "";
      }
    });

    return typeof result === "string" ? result : "";
  } catch {
    return "";
  }
}
