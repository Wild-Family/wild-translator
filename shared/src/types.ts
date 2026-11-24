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

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type Conversation = {
  id?: string;
  inputText?: string;
  prompt: PromptTemplate;
  messages: ConversationMessage[];
};

export type TranslationHistoryEntry = Conversation & {
  id: string;
  inputText: string;
  createdAt: number;
  updatedAt: number;
};

export type GenerateRequest = {
  inputText: string;
  promptId?: string;
  prompt?: PromptTemplate;
  history?: ConversationMessage[];
  conversationId?: string;
  originalInputText?: string;
};

export type GenerateParams = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  inputText: string;
  template: string;
  history?: ConversationMessage[];
  signal?: AbortSignal;
};

export type GenerateResult = {
  text: string;
};
