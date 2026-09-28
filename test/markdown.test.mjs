import assert from "node:assert/strict";
import test from "node:test";

import {
  parseInline,
  parseMarkdown,
} from "../build/ui/src/app/markdown.js";

test("parses headings, paragraphs, and horizontal rules", () => {
  const blocks = parseMarkdown("# Title\n\nHello world\n\n---\n\n## Sub ##");

  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], {
    type: "heading",
    level: 1,
    children: [{ type: "text", text: "Title" }],
  });
  assert.equal(blocks[1].type, "paragraph");
  assert.equal(blocks[2].type, "hr");
  assert.deepEqual(blocks[3], {
    type: "heading",
    level: 2,
    children: [{ type: "text", text: "Sub" }],
  });
});

test("keeps single line breaks inside a paragraph", () => {
  const blocks = parseMarkdown("line one\nline two");

  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].children, [
    { type: "text", text: "line one" },
    { type: "break" },
    { type: "text", text: "line two" },
  ]);
});

test("parses inline emphasis, code, and strikethrough", () => {
  assert.deepEqual(parseInline("a **bold** *em* `code` ~~del~~"), [
    { type: "text", text: "a " },
    { type: "strong", children: [{ type: "text", text: "bold" }] },
    { type: "text", text: " " },
    { type: "em", children: [{ type: "text", text: "em" }] },
    { type: "text", text: " " },
    { type: "code", text: "code" },
    { type: "text", text: " " },
    { type: "del", children: [{ type: "text", text: "del" }] },
  ]);
});

test("nests emphasis inside strong", () => {
  assert.deepEqual(parseInline("**bold *em* bold**"), [
    {
      type: "strong",
      children: [
        { type: "text", text: "bold " },
        { type: "em", children: [{ type: "text", text: "em" }] },
        { type: "text", text: " bold" },
      ],
    },
  ]);
});

test("does not treat snake_case as emphasis", () => {
  assert.deepEqual(parseInline("use foo_bar_baz here"), [
    { type: "text", text: "use foo_bar_baz here" },
  ]);
});

test("parses links and rejects unsafe protocols", () => {
  assert.deepEqual(parseInline("[site](https://example.com)"), [
    {
      type: "link",
      href: "https://example.com",
      children: [{ type: "text", text: "site" }],
    },
  ]);

  const unsafe = parseInline("[x](javascript:alert(1))");
  assert.ok(unsafe.every((node) => node.type === "text"));
  assert.equal(
    unsafe.map((node) => node.text).join(""),
    "[x](javascript:alert(1))",
  );
});

test("parses unordered and ordered lists with nesting", () => {
  const blocks = parseMarkdown("- one\n- two\n  - nested\n\n1. first\n2. second");

  assert.equal(blocks.length, 2);
  const [unordered, ordered] = blocks;

  assert.equal(unordered.type, "list");
  assert.equal(unordered.ordered, false);
  assert.equal(unordered.items.length, 2);
  assert.deepEqual(unordered.items[0].children, [
    { type: "text", text: "one" },
  ]);
  assert.equal(unordered.items[1].sublist?.type, "list");
  assert.deepEqual(unordered.items[1].sublist?.items[0].children, [
    { type: "text", text: "nested" },
  ]);

  assert.equal(ordered.type, "list");
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.items.length, 2);
});

test("parses fenced code blocks verbatim", () => {
  const blocks = parseMarkdown("```ts\nconst x = **not bold**;\n```");

  assert.deepEqual(blocks, [
    {
      type: "code-block",
      language: "ts",
      text: "const x = **not bold**;",
    },
  ]);
});

test("parses blockquotes recursively", () => {
  const blocks = parseMarkdown("> quoted **text**\n> more");

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "blockquote");
  assert.equal(blocks[0].children.length, 1);
  assert.equal(blocks[0].children[0].type, "paragraph");
});

test("parses tables with header and rows", () => {
  const blocks = parseMarkdown(
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
  );

  assert.equal(blocks.length, 1);
  const table = blocks[0];
  assert.equal(table.type, "table");
  assert.deepEqual(table.header, [
    [{ type: "text", text: "A" }],
    [{ type: "text", text: "B" }],
  ]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[1], [
    [{ type: "text", text: "3" }],
    [{ type: "text", text: "4" }],
  ]);
});

test("paragraph ends when a table starts", () => {
  const blocks = parseMarkdown("intro\n| A | B |\n| --- | --- |\n| 1 | 2 |");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[1].type, "table");
});

test("plain text passes through unchanged", () => {
  const blocks = parseMarkdown("こんにちは、世界。");

  assert.deepEqual(blocks, [
    {
      type: "paragraph",
      children: [{ type: "text", text: "こんにちは、世界。" }],
    },
  ]);
});
