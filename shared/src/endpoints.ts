import type { ProviderId } from "./types.js";

/**
 * Default API base URLs per provider.
 *
 * The conventions match each vendor SDK's `baseURL`, so a custom value can be a
 * drop-in replacement (e.g. an OpenAI-compatible gateway or a local proxy):
 * - openai: base ends at `/v1`; `/chat/completions` is appended.
 * - gemini: base is the host root; `/v1beta/models/...` is appended.
 * - claude: base is the host root; `/v1/messages` is appended.
 */
export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com",
  claude: "https://api.anthropic.com",
};

/**
 * Returns the base URL to use for a provider: the trimmed custom value when
 * present, otherwise the provider default. Any trailing slashes are removed so
 * callers can safely append `/path` segments.
 */
export function normalizeBaseUrl(
  provider: ProviderId,
  baseUrl?: string,
): string {
  const fallback = DEFAULT_BASE_URLS[provider];
  const trimmed = (baseUrl ?? "").trim();
  const chosen = trimmed || fallback;
  return chosen.replace(/\/+$/u, "");
}

export function resolveOpenAiUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl("openai", baseUrl)}/chat/completions`;
}

export function resolveClaudeUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl("claude", baseUrl)}/v1/messages`;
}

export function resolveGeminiUrl(
  model: string,
  apiKey: string,
  options: { baseUrl?: string; stream?: boolean } = {},
): string {
  const base = normalizeBaseUrl("gemini", options.baseUrl);
  const method = options.stream ? "streamGenerateContent" : "generateContent";
  const key = `key=${encodeURIComponent(apiKey)}`;
  const query = options.stream ? `?alt=sse&${key}` : `?${key}`;
  return `${base}/v1beta/models/${encodeURIComponent(model)}:${method}${query}`;
}
