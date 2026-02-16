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

export type GenerateParams = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  apiUrl?: string;
  inputText: string;
  template: string;
};

export type GenerateResult = {
  text: string;
};
