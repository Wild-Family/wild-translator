export type ProviderId = "openai" | "gemini" | "claude";

export type PromptTemplate = {
  id: string;
  name: string;
  template: string;
  provider?: ProviderId;
  model?: string;
};

export type ApiKeys = {
  openai?: string;
  gemini?: string;
  claude?: string;
};

export type BaseUrls = {
  openai?: string;
  gemini?: string;
  claude?: string;
};

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com",
  claude: "https://api.anthropic.com",
};

export type StorageShape = {
  apiKeys: ApiKeys;
  baseUrls: BaseUrls;
  prompts: PromptTemplate[];
  defaultPromptId?: string;
};

export const DEFAULTS: StorageShape = {
  apiKeys: {},
  baseUrls: {},
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
