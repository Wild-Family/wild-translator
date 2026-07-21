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

export type GenerateParams = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  inputText: string;
  template: string;
  signal?: AbortSignal;
};

export type GenerateResult = {
  text: string;
};
