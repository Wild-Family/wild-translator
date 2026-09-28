export type InlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "break" }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type ListItemNode = {
  children: InlineNode[];
  sublist: BlockNode | null;
};

export type BlockNode =
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "code-block"; language: string; text: string }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "list"; ordered: boolean; items: ListItemNode[] }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*(\S*)/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BLOCKQUOTE_RE = /^\s*>\s?/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const SAFE_LINK_PROTOCOL_RE = /^(https?:|mailto:)/i;

type InlineRule = {
  pattern: RegExp;
  build: (match: RegExpExecArray) => InlineNode;
};

const INLINE_RULES: InlineRule[] = [
  {
    pattern: /`([^`\n]+)`/,
    build: (match) => ({ type: "code", text: match[1] }),
  },
  {
    pattern: /\*\*([^\n]+?)\*\*/,
    build: (match) => ({ type: "strong", children: parseInline(match[1]) }),
  },
  {
    pattern: /(?<![\w_])__([^\n]+?)__(?![\w_])/,
    build: (match) => ({ type: "strong", children: parseInline(match[1]) }),
  },
  {
    pattern: /\*([^*\n]+)\*/,
    build: (match) => ({ type: "em", children: parseInline(match[1]) }),
  },
  {
    pattern: /(?<![\w_])_([^_\n]+)_(?![\w_])/,
    build: (match) => ({ type: "em", children: parseInline(match[1]) }),
  },
  {
    pattern: /~~([^\n]+?)~~/,
    build: (match) => ({ type: "del", children: parseInline(match[1]) }),
  },
  {
    pattern: /\[([^\]\n]*)\]\(([^)\s]+)\)/,
    build: (match) =>
      SAFE_LINK_PROTOCOL_RE.test(match[2])
        ? { type: "link", href: match[2], children: parseInline(match[1]) }
        : { type: "text", text: match[0] },
  },
];

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;

  while (rest.length > 0) {
    let best: { rule: InlineRule; match: RegExpExecArray } | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (!match) continue;
      if (!best || match.index < best.match.index) {
        best = { rule, match };
      }
    }

    if (!best) {
      nodes.push({ type: "text", text: rest });
      break;
    }

    if (best.match.index > 0) {
      nodes.push({ type: "text", text: rest.slice(0, best.match.index) });
    }
    nodes.push(best.rule.build(best.match));
    rest = rest.slice(best.match.index + best.match[0].length);
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function startsNewBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    LIST_ITEM_RE.test(line) ||
    (line.includes("|") && next !== undefined && isTableSeparator(next))
  );
}

type ParsedListLine = { indent: number; ordered: boolean; text: string };

function buildList(
  items: ParsedListLine[],
  start: number,
  end: number,
): BlockNode {
  const baseIndent = items[start].indent;
  const listItems: ListItemNode[] = [];
  let i = start;

  while (i < end) {
    let next = i + 1;
    while (next < end && items[next].indent > baseIndent) next += 1;
    listItems.push({
      children: parseInline(items[i].text),
      sublist: next > i + 1 ? buildList(items, i + 1, next) : null,
    });
    i = next;
  }

  return { type: "list", ordered: items[start].ordered, items: listItems };
}

function parseList(lines: string[]): BlockNode {
  const items = lines.map((line): ParsedListLine => {
    const match = LIST_ITEM_RE.exec(line);
    if (!match) {
      return { indent: 0, ordered: false, text: line.trim() };
    }
    return {
      indent: match[1].length,
      ordered: /^\d/.test(match[2]),
      text: match[3],
    };
  });
  return buildList(items, 0, items.length);
}

export function parseMarkdown(text: string): BlockNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const closeRe = fence[1].startsWith("`")
        ? /^\s*`{3,}\s*$/
        : /^\s*~{3,}\s*$/;
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !closeRe.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({
        type: "code-block",
        language: fence[2] ?? "",
        text: buffer.join("\n"),
      });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].replace(/\s+#+\s*$/, "").trim()),
      });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        buffer.push(lines[i].replace(BLOCKQUOTE_RE, ""));
        i += 1;
      }
      blocks.push({
        type: "blockquote",
        children: parseMarkdown(buffer.join("\n")),
      });
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const buffer: string[] = [];
      while (
        i < lines.length &&
        LIST_ITEM_RE.test(lines[i]) &&
        !HR_RE.test(lines[i])
      ) {
        buffer.push(lines[i]);
        i += 1;
      }
      blocks.push(parseList(buffer));
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const header = splitTableRow(line).map((cell) => parseInline(cell));
      const rows: InlineNode[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]).map((cell) => parseInline(cell)));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const buffer: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !startsNewBlock(lines[i], lines[i + 1])
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    const children: InlineNode[] = [];
    buffer.forEach((paragraphLine, index) => {
      if (index > 0) children.push({ type: "break" });
      children.push(...parseInline(paragraphLine));
    });
    blocks.push({ type: "paragraph", children });
  }

  return blocks;
}

function appendInline(parent: HTMLElement, nodes: InlineNode[]): void {
  for (const node of nodes) {
    parent.append(renderInline(node));
  }
}

function renderInline(node: InlineNode): Node {
  switch (node.type) {
    case "text":
      return document.createTextNode(node.text);
    case "break":
      return document.createElement("br");
    case "code": {
      const code = document.createElement("code");
      code.textContent = node.text;
      return code;
    }
    case "strong":
    case "em":
    case "del": {
      const element = document.createElement(node.type);
      appendInline(element, node.children);
      return element;
    }
    case "link": {
      const anchor = document.createElement("a");
      anchor.href = node.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      appendInline(anchor, node.children);
      return anchor;
    }
  }
}

function renderBlock(block: BlockNode): HTMLElement {
  switch (block.type) {
    case "heading": {
      const heading = document.createElement(`h${block.level}`);
      appendInline(heading, block.children);
      return heading;
    }
    case "paragraph": {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children);
      return paragraph;
    }
    case "code-block": {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (block.language) {
        code.dataset.language = block.language;
      }
      code.textContent = block.text;
      pre.append(code);
      return pre;
    }
    case "blockquote": {
      const quote = document.createElement("blockquote");
      for (const child of block.children) {
        quote.append(renderBlock(child));
      }
      return quote;
    }
    case "list": {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const entry = document.createElement("li");
        appendInline(entry, item.children);
        if (item.sublist) {
          entry.append(renderBlock(item.sublist));
        }
        list.append(entry);
      }
      return list;
    }
    case "table": {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cell of block.header) {
        const th = document.createElement("th");
        appendInline(th, cell);
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement("tbody");
      for (const row of block.rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          appendInline(td, cell);
          tr.append(td);
        }
        tbody.append(tr);
      }
      table.append(tbody);
      return table;
    }
    case "hr":
      return document.createElement("hr");
  }
}

export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(text)) {
    fragment.append(renderBlock(block));
  }
  return fragment;
}
