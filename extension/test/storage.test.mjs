import test from "node:test";
import assert from "node:assert/strict";

import { storage } from "../../build/extension/src/storage.js";

function installChromeMock(syncStore) {
  globalThis.chrome = {
    storage: {
      sync: {
        async get(keys) {
          const output = {};
          for (const key of keys) {
            output[key] = syncStore[key];
          }
          return output;
        },
        async set(values) {
          Object.assign(syncStore, values);
        },
      },
    },
  };
}

test("storage.getAll returns defaults when empty", async () => {
  const syncStore = {};
  installChromeMock(syncStore);

  const state = await storage.getAll();
  assert.ok(state.prompts.length > 0);
  assert.ok(state.defaultPromptId);
});

test("storage.setAll persists values", async () => {
  const syncStore = {};
  installChromeMock(syncStore);

  await storage.setAll({ defaultPromptId: "x" });
  const state = await storage.getAll();
  assert.equal(state.defaultPromptId, "x");
});
