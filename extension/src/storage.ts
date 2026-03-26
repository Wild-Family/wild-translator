import type { ApiKeys, PromptTemplate } from "../../shared/src/types.js";

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
      provider: "openai",
    },
  ],
  defaultPromptId: "default-translate",
};

export const storage = {
  async getAll(): Promise<StorageShape> {
    const raw = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    return {
      apiKeys: (raw.apiKeys ?? DEFAULTS.apiKeys) as ApiKeys,
      prompts: (raw.prompts ?? DEFAULTS.prompts) as PromptTemplate[],
      defaultPromptId: (raw.defaultPromptId ??
        DEFAULTS.defaultPromptId) as string,
    };
  },

  async setAll(next: Partial<StorageShape>): Promise<void> {
    await chrome.storage.sync.set(next);
  },
};
