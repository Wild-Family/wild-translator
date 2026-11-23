import test from "node:test";
import assert from "node:assert/strict";

import {
  generate,
  generateStream,
  isUnsupportedTemperatureError,
  supportsCustomTemperature,
} from "../../build/extension/src/providers.js";

test("supportsCustomTemperature allows classic chat models", () => {
  assert.equal(supportsCustomTemperature("gpt-4o-mini"), true);
  assert.equal(supportsCustomTemperature("gpt-4o"), true);
  assert.equal(supportsCustomTemperature("gpt-4.1"), true);
});

const history = [
  { role: "user", content: "Translate: hello" },
  { role: "assistant", content: "こんにちは" },
  { role: "user", content: "Make it casual." },
  { role: "assistant", content: "やあ" },
];

const providerResponses = {
  openai: {
    json: { choices: [{ message: { content: "answer" } }] },
    stream: 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n',
  },
  gemini: {
    json: { candidates: [{ content: { parts: [{ text: "answer" }] } }] },
    stream: 'data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}\n\n',
  },
  claude: {
    json: { content: [{ text: "answer" }] },
    stream: 'event: content_block_delta\ndata: {"delta":{"text":"answer"}}\n\nevent: message_stop\ndata: {}\n\n',
  },
};

for (const provider of ["openai", "gemini", "claude"]) {
  for (const streaming of [false, true]) {
    for (const withHistory of [false, true]) {
      test(`${provider} ${streaming ? "stream" : "generate"} sends ${withHistory ? "all previous turns and the follow-up" : "the rendered initial prompt"}`, async (t) => {
        let body;
        t.mock.method(globalThis, "fetch", async (_url, init) => {
          body = JSON.parse(init.body);
          const response = providerResponses[provider];
          return new Response(
            streaming ? response.stream : JSON.stringify(response.json),
          );
        });
        const params = {
          provider,
          apiKey: "test-key",
          inputText: withHistory ? "Why?" : "hello",
          template: "Translate: {{text}}",
          ...(withHistory ? { history } : {}),
        };
        let text = "";
        if (streaming) {
          for await (const delta of generateStream(params)) text += delta;
        } else {
          text = (await generate(params)).text;
        }
        assert.equal(text, "answer");

        const expected = withHistory
          ? [...history, { role: "user", content: "Why?" }]
          : [{ role: "user", content: "Translate: hello" }];
        if (provider === "gemini") {
          assert.deepEqual(
            body.contents,
            expected.map(({ role, content }) => ({
              role: role === "assistant" ? "model" : "user",
              parts: [{ text: content }],
            })),
          );
        } else {
          assert.deepEqual(body.messages, expected);
        }
      });
    }
  }
}

test("supportsCustomTemperature rejects reasoning models", () => {
  assert.equal(supportsCustomTemperature("gpt-5"), false);
  assert.equal(supportsCustomTemperature("gpt-5-mini"), false);
  assert.equal(supportsCustomTemperature("gpt-6-sol"), false);
  assert.equal(supportsCustomTemperature("gpt-10"), false);
  assert.equal(supportsCustomTemperature("o1"), false);
  assert.equal(supportsCustomTemperature("o3-mini"), false);
  assert.equal(supportsCustomTemperature("o4-mini"), false);
});

const unsupportedTemperatureBody = JSON.stringify({
  error: {
    message:
      "Unsupported value: 'temperature' does not support 0.2 with this model.",
    type: "invalid_request_error",
    param: "temperature",
    code: "unsupported_value",
  },
});

test("isUnsupportedTemperatureError matches only the temperature 400", () => {
  assert.equal(
    isUnsupportedTemperatureError(400, unsupportedTemperatureBody),
    true,
  );
  assert.equal(
    isUnsupportedTemperatureError(401, unsupportedTemperatureBody),
    false,
  );
  assert.equal(isUnsupportedTemperatureError(400, "not json"), false);
  assert.equal(
    isUnsupportedTemperatureError(
      400,
      JSON.stringify({ error: { param: "model", code: "unsupported_value" } }),
    ),
    false,
  );
});

test("openai generate retries without temperature on unsupported_value", async (t) => {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if ("temperature" in body) {
      return new Response(unsupportedTemperatureBody, { status: 400 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "hola" } }] }),
      { status: 200 },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await generate({
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    inputText: "hello",
    template: "{text}",
  });

  assert.equal(result.text, "hola");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].temperature, 0.2);
  assert.equal("temperature" in bodies[1], false);
});
