import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BASE_URLS,
  normalizeBaseUrl,
  resolveClaudeUrl,
  resolveGeminiUrl,
  resolveOpenAiUrl,
} from "../../build/shared/src/endpoints.js";

test("resolveOpenAiUrl uses the default base when none is set", () => {
  assert.equal(
    resolveOpenAiUrl(),
    "https://api.openai.com/v1/chat/completions",
  );
});

test("resolveOpenAiUrl honors a custom base and trims trailing slashes", () => {
  assert.equal(
    resolveOpenAiUrl("http://localhost:11434/v1/"),
    "http://localhost:11434/v1/chat/completions",
  );
});

test("resolveOpenAiUrl falls back to default for blank/whitespace input", () => {
  assert.equal(resolveOpenAiUrl("   "), resolveOpenAiUrl());
});

test("resolveClaudeUrl appends /v1/messages to the base", () => {
  assert.equal(resolveClaudeUrl(), "https://api.anthropic.com/v1/messages");
  assert.equal(
    resolveClaudeUrl("https://claude.example.com/"),
    "https://claude.example.com/v1/messages",
  );
});

test("resolveGeminiUrl builds generate and streaming URLs", () => {
  assert.equal(
    resolveGeminiUrl("gemini-1.5-flash", "KEY"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=KEY",
  );
  assert.equal(
    resolveGeminiUrl("gemini-1.5-flash", "KEY", { stream: true }),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=KEY",
  );
});

test("resolveGeminiUrl respects a custom base and encodes the key", () => {
  assert.equal(
    resolveGeminiUrl("m", "a b", { baseUrl: "https://gw.example.com/" }),
    "https://gw.example.com/v1beta/models/m:generateContent?key=a%20b",
  );
});

test("normalizeBaseUrl returns provider defaults", () => {
  assert.equal(normalizeBaseUrl("openai"), DEFAULT_BASE_URLS.openai);
  assert.equal(normalizeBaseUrl("gemini"), DEFAULT_BASE_URLS.gemini);
  assert.equal(normalizeBaseUrl("claude"), DEFAULT_BASE_URLS.claude);
});
