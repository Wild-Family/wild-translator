import type {
  GenerateParams,
  GenerateResult,
  ProviderId,
} from "../../shared/src/types.js";
import { renderPromptTemplate } from "../../shared/src/prompt.js";

export async function generate(
  params: GenerateParams,
): Promise<GenerateResult> {
  switch (params.provider) {
    case "openai":
      return openaiGenerate(params);
    case "gemini":
      return geminiGenerate(params);
    case "claude":
      return claudeGenerate(params);
    default: {
      const _exhaustive: never = params.provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

export async function* generateStream(
  params: GenerateParams,
): AsyncGenerator<string> {
  switch (params.provider) {
    case "openai":
      yield* openaiGenerateStream(params);
      return;
    case "gemini":
      yield* geminiGenerateStream(params);
      return;
    case "claude":
      yield* claudeGenerateStream(params);
      return;
    default: {
      const _exhaustive: never = params.provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

function buildPrompt(template: string, inputText: string) {
  return renderPromptTemplate(template, { text: inputText });
}

function validateApiUrl(raw: string): string {
  const url = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Invalid API URL scheme (must be http or https): ${url}`);
  }
  return url;
}

async function openaiGenerate({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): Promise<GenerateResult> {
  const prompt = buildPrompt(template, inputText);
  const url = apiUrl
    ? `${validateApiUrl(apiUrl)}/v1/chat/completions`
    : "https://api.openai.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok)
    throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text };
}

async function* openaiGenerateStream({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): AsyncGenerator<string> {
  const prompt = buildPrompt(template, inputText);
  const url = apiUrl
    ? `${validateApiUrl(apiUrl)}/v1/chat/completions`
    : "https://api.openai.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? "gpt-4o-mini",
      stream: true,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok)
    throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  if (!res.body) throw new Error("OpenAI stream: missing response body");

  for await (const data of readSseJson(res.body)) {
    if (data === "[DONE]") return;
    const delta = data?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length) yield delta;
  }
}

async function geminiGenerate({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): Promise<GenerateResult> {
  const prompt = buildPrompt(template, inputText);
  const m = model ?? "gemini-1.5-flash";
  const base = apiUrl
    ? validateApiUrl(apiUrl)
    : "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok)
    throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? "")
      .join("") ?? "";
  return { text };
}

async function* geminiGenerateStream({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): AsyncGenerator<string> {
  const prompt = buildPrompt(template, inputText);
  const m = model ?? "gemini-1.5-flash";
  const base = apiUrl
    ? validateApiUrl(apiUrl)
    : "https://generativelanguage.googleapis.com";
  // SSE streaming
  const url = `${base}/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok)
    throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  if (!res.body) throw new Error("Gemini stream: missing response body");

  for await (const data of readSseJson(res.body)) {
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text ?? "")
        .join("") ?? "";
    if (text) yield text;
  }
}

async function claudeGenerate({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): Promise<GenerateResult> {
  const prompt = buildPrompt(template, inputText);
  const url = apiUrl
    ? `${validateApiUrl(apiUrl)}/v1/messages`
    : "https://api.anthropic.com/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model ?? "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok)
    throw new Error(`Claude error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const text = data?.content?.map((c: any) => c?.text ?? "").join("") ?? "";
  return { text };
}

async function* claudeGenerateStream({
  apiKey,
  model,
  apiUrl,
  inputText,
  template,
}: GenerateParams): AsyncGenerator<string> {
  const prompt = buildPrompt(template, inputText);
  const url = apiUrl
    ? `${validateApiUrl(apiUrl)}/v1/messages`
    : "https://api.anthropic.com/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: model ?? "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok)
    throw new Error(`Claude error: ${res.status} ${await res.text()}`);
  if (!res.body) throw new Error("Claude stream: missing response body");

  for await (const evt of readSseEvents(res.body)) {
    if (evt.event === "content_block_delta") {
      const t = evt.data?.delta?.text;
      if (typeof t === "string" && t.length) yield t;
    }
    if (evt.event === "message_stop") return;
  }
}

export function requireApiKey(
  provider: ProviderId,
  keys: { openai?: string; gemini?: string; claude?: string },
): string {
  const key = keys[provider];
  if (!key) throw new Error(`Missing API key for ${provider}`);
  return key;
}

async function* readSseJson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const lines = chunk.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr) continue;
        if (dataStr === "[DONE]") {
          yield "[DONE]";
          return;
        }
        yield JSON.parse(dataStr);
      }
    }
  }
}

type SseEvent = { event?: string; data?: any };

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event: string | undefined;
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join("\n").trim();
      const data = dataStr ? JSON.parse(dataStr) : undefined;
      yield { event, data };
    }
  }
}
