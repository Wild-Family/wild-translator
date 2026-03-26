export function clearNode(node: Element): void {
  node.replaceChildren();
}

export function setStyles(
  node: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  Object.assign(node.style, styles);
}

type ElementOptions = {
  className?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);

  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  if (options.style) {
    setStyles(node, options.style);
  }

  return node;
}
