import { describe, expect, it } from "vitest";
import { renderPromptTemplate } from "../src/prompt";

describe("renderPromptTemplate", () => {
  it("replaces variables", () => {
    expect(renderPromptTemplate("Translate: {{text}}", { text: "hello" })).toBe("Translate: hello");
  });

  it("unknown vars become empty string", () => {
    expect(renderPromptTemplate("X={{missing}}", { text: "hello" })).toBe("X=");
  });

  it("trims spaces inside braces", () => {
    expect(renderPromptTemplate("{{  text }}", { text: "ok" })).toBe("ok");
  });
});
