import test from "node:test";
import assert from "node:assert/strict";

import {
  generate,
  isUnsupportedTemperatureError,
  supportsCustomTemperature,
} from "../../build/extension/src/providers.js";

test("supportsCustomTemperature allows classic chat models", () => {
  assert.equal(supportsCustomTemperature("gpt-4o-mini"), true);
  assert.equal(supportsCustomTemperature("gpt-4o"), true);
  assert.equal(supportsCustomTemperature("gpt-4.1"), true);
});

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
