import type {
  GenerateParams,
  GenerateResult,
  ProviderId,
} from "../../shared/src/types.js";
import { renderPromptTemplate } from "../../shared/src/prompt.js";

export type SpeechFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export type OpenAiSpeechParams = {
  apiKey: string;
  inputText: string;
  model?: string;
  voice?: string;
  responseFormat?: SpeechFormat;
  instructions?: string;
  apiUrl?: string;
  signal?: AbortSignal;
};

export type OpenAiSpeechResult = {
  audioBase64: string;
  mediaType: string;
  byteLength: number;
};

const SPEECH_MEDIA_TYPES: Record<SpeechFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};

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

export async function generateOpenAiSpeech({
  apiKey,
  inputText,
  model,
  voice,
  responseFormat = "mp3",
  instructions,
  apiUrl,
  signal,
}: OpenAiSpeechParams): Promise<OpenAiSpeechResult> {
  const url = apiUrl
    ? `${validateApiUrl(apiUrl)}/v1/audio/speech`
    : "https://api.openai.com/v1/audio/speech";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: model ?? "gpt-4o-mini-tts",
      voice: voice ?? "marin",
      input: inputText,
      response_format: responseFormat,
      ...(instructions ? { instructions } : {}),
    }),
  });

  if (!res.ok)
    throw new Error(`OpenAI speech error: ${res.status} ${await res.text()}`);

  const audio = await res.arrayBuffer();
  return {
    audioBase64: arrayBufferToBase64(audio),
    mediaType: SPEECH_MEDIA_TYPES[responseFormat],
    byteLength: audio.byteLength,
  };
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
  signal,
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
    signal,
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
  signal,
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
    signal,
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
  signal,
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
    signal,
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
  signal,
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
    signal,
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
  signal,
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
    signal,
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
  signal,
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
    signal,
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

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const next = takeSseChunk(buf);
        if (!next) break;
        buf = next.rest;
        const parsed = parseSseJsonChunk(next.chunk);
        if (typeof parsed === "undefined") continue;
        yield parsed;
        if (parsed === "[DONE]") return;
      }
    }

    buf += decoder.decode();
    const parsed = parseSseJsonChunk(buf);
    if (typeof parsed !== "undefined") {
      yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

type SseEvent = { event?: string; data?: any };

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      while (true) {
        const next = takeSseChunk(buf);
        if (!next) break;
        buf = next.rest;
        const event = parseSseEventChunk(next.chunk);
        if (event) yield event;
      }
    }

    buf += decoder.decode();
    const event = parseSseEventChunk(buf);
    if (event) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function takeSseChunk(
  buf: string,
): { chunk: string; rest: string } | null {
  const separator = findSseSeparator(buf);
  if (!separator) return null;
  return {
    chunk: buf.slice(0, separator.index),
    rest: buf.slice(separator.index + separator.length),
  };
}

function parseSseJsonChunk(chunk: string): any | "[DONE]" | undefined {
  const dataStr = getSseDataString(chunk);
  if (!dataStr) return undefined;
  if (dataStr === "[DONE]") return "[DONE]";
  return JSON.parse(dataStr);
}

function parseSseEventChunk(chunk: string): SseEvent | null {
  const lines = chunk.trimEnd().split(/\r?\n/u);
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = readSseFieldValue(line, "event:");
    }
    if (line.startsWith("data:")) {
      dataLines.push(readSseFieldValue(line, "data:"));
    }
  }

  if (!event && !dataLines.length) return null;

  const dataStr = dataLines.join("\n").trim();
  return {
    event,
    data: dataStr ? JSON.parse(dataStr) : undefined,
  };
}

function getSseDataString(chunk: string): string | undefined {
  const dataLines = chunk
    .trimEnd()
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => readSseFieldValue(line, "data:"));
  const dataStr = dataLines.join("\n").trim();
  return dataStr || undefined;
}

function readSseFieldValue(line: string, field: "data:" | "event:"): string {
  const value = line.slice(field.length);
  return value.startsWith(" ") ? value.slice(1) : value;
}

function findSseSeparator(buf: string): { index: number; length: number } | null {
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (lf === -1) return { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
