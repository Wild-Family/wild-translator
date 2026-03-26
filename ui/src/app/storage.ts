import type { StorageShape } from "./models.js";
import { DEFAULTS } from "./models.js";

function ensureChrome() {
  if (typeof chrome === "undefined" || !chrome.storage?.sync) {
    throw new Error(
      "chrome.storage is not available (are you running inside the extension?)",
    );
  }
}

export async function getAll(): Promise<StorageShape> {
  ensureChrome();
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return {
    apiKeys: raw.apiKeys ?? DEFAULTS.apiKeys,
    prompts: raw.prompts ?? DEFAULTS.prompts,
    defaultPromptId: raw.defaultPromptId ?? DEFAULTS.defaultPromptId,
  };
}

export async function setAll(next: Partial<StorageShape>): Promise<void> {
  ensureChrome();
  await chrome.storage.sync.set(next);
}
