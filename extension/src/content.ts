const HOST_ID = "wild-translate-fab-host";
const LEGACY_BUTTON_ID = "wild-translate-fab";
const BUTTON_SIZE = 30;

let lastSelection = "";
let lastSelectionKey = "";
let openingSelectionKey = "";
let suppressedSelectionKey = "";
let hideTimer: number | null = null;
let lastPointer: { x: number; y: number } | null = null;
let hostEl: HTMLDivElement | null = null;
let buttonEl: HTMLButtonElement | null = null;
let lastSelectionRect: DOMRect | null = null;

type SelectionInfo = {
  text: string;
  rect: DOMRect | null;
};

function createButton() {
  removeLegacyButton();
  if (hostEl?.isConnected && buttonEl) return;
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: `${BUTTON_SIZE}px`,
    height: `${BUTTON_SIZE}px`,
    display: "none",
    pointerEvents: "auto",
  } as CSSStyleDeclaration);
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  host.style.setProperty("display", "none", "important");
  host.addEventListener("mousedown", (e) => e.stopPropagation());
  host.addEventListener("click", (e) => e.stopPropagation());

  const shadow = host.attachShadow({ mode: "closed" });
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "WT";
  btn.setAttribute("aria-label", "Open わいるどぱんち");
  Object.assign(btn.style, {
    all: "initial",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${BUTTON_SIZE}px`,
    height: `${BUTTON_SIZE}px`,
    borderRadius: "999px",
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
    padding: "0",
    lineHeight: `${BUTTON_SIZE}px`,
    textAlign: "center",
    userSelect: "none",
  } as CSSStyleDeclaration);

  btn.style.setProperty("width", `${BUTTON_SIZE}px`, "important");
  btn.style.setProperty("height", `${BUTTON_SIZE}px`, "important");
  btn.style.setProperty("pointer-events", "auto", "important");

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const info = getSelectionInfo(e.target);
    const text = info.text || lastSelection;
    if (!text) return;
    const key = info.text ? getSelectionKey(info) : lastSelectionKey || text;
    const rect = info.rect ?? lastSelectionRect;
    lastSelection = text;
    openingSelectionKey = key;
    hideButton();
    void openToolbarPopup(text).then((opened) => {
      if (openingSelectionKey === key) openingSelectionKey = "";
      if (opened) {
        suppressedSelectionKey = key;
        return;
      }

      const current = getSelectionInfo();
      const retryRect = current.rect ?? rect;
      if (current.text === text && retryRect) {
        showButton(retryRect);
      }
    });
  });

  shadow.append(btn);
  document.documentElement.appendChild(host);
  hostEl = host;
  buttonEl = btn;
}

function isEditableSelectionElement(
  value: Element | null,
): value is HTMLInputElement | HTMLTextAreaElement {
  if (!value) return false;
  return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement;
}

function getEditableSelection(el: HTMLInputElement | HTMLTextAreaElement): SelectionInfo {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (typeof start !== "number" || typeof end !== "number" || start === end) {
    return { text: "", rect: null };
  }

  return {
    text: el.value.slice(Math.min(start, end), Math.max(start, end)).trim(),
    rect: el.getBoundingClientRect(),
  };
}

function getWindowSelectionText() {
  const sel = window.getSelection?.();
  const text = sel?.toString?.() ?? "";
  return text.trim();
}

function getWindowSelectionRect(): DOMRect | null {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return rect;
}

function getSelectionInfo(target?: EventTarget | null): SelectionInfo {
  const targetElement = target instanceof Element ? target : null;
  const activeElement = document.activeElement;
  const editable = isEditableSelectionElement(targetElement)
    ? targetElement
    : isEditableSelectionElement(activeElement)
      ? activeElement
      : null;

  if (editable) {
    const editableSelection = getEditableSelection(editable);
    if (editableSelection.text) return editableSelection;
  }

  return {
    text: getWindowSelectionText(),
    rect: getWindowSelectionRect(),
  };
}

function getSelectionKey(info: SelectionInfo): string {
  const rect = info.rect;
  const rectKey = rect
    ? [rect.left, rect.top, rect.right, rect.bottom]
        .map((value) => Math.round(value))
        .join(",")
    : "no-rect";
  return `${info.text}\n${rectKey}`;
}

async function openToolbarPopup(text: string): Promise<boolean> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "OPEN_UI_WITH_TEXT",
      text,
      fallbackToTab: false,
    });
    if (!resp?.ok) throw new Error(resp?.error ?? "Failed to open popup");
    return true;
  } catch (err) {
    console.warn("わいるどぱんち: failed to open toolbar popup", err);
    return false;
  }
}

function positionButton(rect: DOMRect) {
  if (!hostEl) return;

  const anchorX = lastPointer?.x ?? rect.right;
  const anchorY = lastPointer?.y ?? rect.bottom;
  const left = Math.min(anchorX + 8, window.innerWidth - BUTTON_SIZE - 8);
  const top = Math.min(anchorY + 8, window.innerHeight - BUTTON_SIZE - 8);

  hostEl.style.left = `${Math.max(8, left)}px`;
  hostEl.style.top = `${Math.max(8, top)}px`;
}

function showButton(rect: DOMRect) {
  if (!hostEl) return;
  removeLegacyButton();
  positionButton(rect);
  hostEl.style.width = `${BUTTON_SIZE}px`;
  hostEl.style.height = `${BUTTON_SIZE}px`;
  buttonEl?.style.setProperty("display", "flex", "important");
  hostEl.style.setProperty("display", "block", "important");
}

function hideButton() {
  buttonEl?.style.setProperty("display", "none", "important");
  hostEl?.style.setProperty("display", "none", "important");
}

function removeLegacyButton() {
  const legacy = document.getElementById(LEGACY_BUTTON_ID);
  if (
    legacy instanceof HTMLButtonElement &&
    legacy.textContent?.trim() === "WT"
  ) {
    legacy.remove();
  }
}

function clearHideTimer() {
  if (!hideTimer) return;
  window.clearTimeout(hideTimer);
  hideTimer = null;
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    const { text } = getSelectionInfo();
    if (!text) hideButton();
  }, 120);
}

function handleSelection(target?: EventTarget | null) {
  const info = getSelectionInfo(target);
  const { text, rect } = info;
  if (!text) {
    lastSelection = "";
    lastSelectionKey = "";
    openingSelectionKey = "";
    suppressedSelectionKey = "";
    lastSelectionRect = null;
    scheduleHide();
    return;
  }

  const key = getSelectionKey(info);
  lastSelection = text;
  lastSelectionKey = key;
  lastSelectionRect = rect;
  if (key === openingSelectionKey || key === suppressedSelectionKey) {
    hideButton();
    return;
  }
  if (!rect) {
    scheduleHide();
    return;
  }

  showButton(rect);
}

function onSelectionChange(target?: EventTarget | null) {
  window.requestAnimationFrame(() => handleSelection(target));
}

function setup() {
  createButton();
  document.addEventListener("mouseup", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    onSelectionChange(e.target);
  });
  document.addEventListener("selectionchange", () => {
    lastPointer = null;
    onSelectionChange();
  });
  document.addEventListener(
    "select",
    (e) => {
      lastPointer = null;
      onSelectionChange(e.target);
    },
    true,
  );
  document.addEventListener("keyup", (e) => {
    lastPointer = null;
    onSelectionChange(e.target);
  });
  document.addEventListener("scroll", () => hideButton(), true);
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target === hostEl || target.id === HOST_ID) return;
    if (!getSelectionInfo(target).text) hideButton();
  });
}

setup();
