import type { ApiKeys, PromptTemplate } from "@wild/shared";

export type StorageShape = {
  apiKeys: ApiKeys;
  prompts: PromptTemplate[];
  defaultPromptId?: string;
};

const DEFAULTS: StorageShape = {
  apiKeys: {},
  prompts: [
    {
      id: "default-translate",
      name: "Translate",
      template: "Translate the following text to Japanese:\n\n{{text}}",
      provider: "openai"
    }
  ],
  defaultPromptId: "default-translate"
};

function ensureChrome() {
  if (typeof chrome === "undefined" || !chrome.storage?.sync) {
    throw new Error("chrome.storage is not available (are you running inside the extension?)");
  }
}

export async function getAll(): Promise<StorageShape> {
  ensureChrome();
  const raw = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return {
    apiKeys: (raw.apiKeys ?? DEFAULTS.apiKeys) as ApiKeys,
    prompts: (raw.prompts ?? DEFAULTS.prompts) as PromptTemplate[],
    defaultPromptId: (raw.defaultPromptId ?? DEFAULTS.defaultPromptId) as string
  };
}

export async function setAll(next: Partial<StorageShape>): Promise<void> {
  ensureChrome();
  await chrome.storage.sync.set(next);
}
