import test from "node:test";
import assert from "node:assert/strict";

import { renderPromptTemplate } from "../../build/shared/src/prompt.js";

test("renderPromptTemplate replaces variables", () => {
  assert.equal(
    renderPromptTemplate("Translate: {{text}}", { text: "hello" }),
    "Translate: hello",
  );
});

test("renderPromptTemplate turns unknown vars into empty strings", () => {
  assert.equal(
    renderPromptTemplate("X={{missing}}", { text: "hello" }),
    "X=",
  );
});

test("renderPromptTemplate trims spaces inside braces", () => {
  assert.equal(renderPromptTemplate("{{  text }}", { text: "ok" }), "ok");
});
