export type ProviderId = "openai" | "gemini" | "claude";

export type PromptTemplate = {
  id: string;
  name: string;
  template: string;
  provider?: ProviderId;
  model?: string;
  apiUrl?: string;
};

export type ApiKeys = {
  openai?: string;
  gemini?: string;
  claude?: string;
};

export type StorageShape = {
  apiKeys: ApiKeys;
  prompts: PromptTemplate[];
  defaultPromptId?: string;
};

export const DEFAULTS: StorageShape = {
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
