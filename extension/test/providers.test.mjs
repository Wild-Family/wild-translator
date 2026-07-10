import test from "node:test";
import assert from "node:assert/strict";

import { generateOpenAiSpeech } from "../../build/extension/src/providers.js";

test("generateOpenAiSpeech posts to OpenAI speech API and returns base64 audio", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };

  try {
    const result = await generateOpenAiSpeech({
      apiKey: "sk-test",
      inputText: "Hello from the test.",
      instructions: "Read clearly.",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/audio/speech");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "gpt-4o-mini-tts");
    assert.equal(body.voice, "marin");
    assert.equal(body.input, "Hello from the test.");
    assert.equal(body.response_format, "mp3");
    assert.equal(body.instructions, "Read clearly.");

    assert.equal(result.audioBase64, "AQID");
    assert.equal(result.mediaType, "audio/mpeg");
    assert.equal(result.byteLength, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
