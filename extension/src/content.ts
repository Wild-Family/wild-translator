const BUTTON_ID = "wild-translate-fab";
const BUTTON_SIZE = 30;
let lastSelection = "";
let hideTimer: number | null = null;
let lastPointer: { x: number; y: number } | null = null;

function createButton() {
  if (document.getElementById(BUTTON_ID)) return;
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "WT";
  btn.setAttribute("aria-label", "Open わいるどぱんち");
  Object.assign(btn.style, {
    position: "fixed",
    zIndex: "2147483647",
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
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "0"
  } as CSSStyleDeclaration);

  btn.style.setProperty("display", "none", "important");
  btn.style.setProperty("width", `${BUTTON_SIZE}px`, "important");
  btn.style.setProperty("height", `${BUTTON_SIZE}px`, "important");
  btn.style.setProperty("pointer-events", "auto", "important");
  btn.style.boxSizing = "border-box";
  btn.style.lineHeight = `${BUTTON_SIZE}px`;
  btn.style.textAlign = "center";
  btn.style.userSelect = "none";

  btn.addEventListener("mousedown", (e) => {
    // Keep selection when clicking the button.
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getSelectionText() || lastSelection;
    if (!text) return;
    lastSelection = text;
    hideButton();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "OPEN_UI_WITH_TEXT", text });
      if (!resp?.ok) throw new Error(resp?.error ?? "Failed to open UI");
    } catch (err) {
      console.warn("わいるどぱんち: failed to open UI", err);
    }
  });

  document.body.appendChild(btn);
}

function getSelectionText() {
  const sel = window.getSelection?.();
  const text = sel?.toString?.() ?? "";
  return text.trim();
}

function getSelectionRect(): DOMRect | null {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return rect;
}

function positionButton(rect: DOMRect) {
  const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) return;

  const anchorX = lastPointer?.x ?? rect.right;
  const anchorY = lastPointer?.y ?? rect.bottom;
  const left = Math.min(anchorX + 8, window.innerWidth - BUTTON_SIZE - 8);
  const top = Math.min(anchorY + 8, window.innerHeight - BUTTON_SIZE - 8);

  btn.style.left = `${Math.max(8, left)}px`;
  btn.style.top = `${Math.max(8, top)}px`;
}

function showButton(rect: DOMRect) {
  const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) return;
  positionButton(rect);
  btn.style.setProperty("display", "flex", "important");
}

function hideButton() {
  const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) return;
  btn.style.display = "none";
}

function scheduleHide() {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    const text = getSelectionText();
    if (!text) hideButton();
  }, 120);
}

function handleSelection() {
  const text = getSelectionText();
  if (!text || text === lastSelection) {
    scheduleHide();
    return;
  }

  lastSelection = text;
  const rect = getSelectionRect();
  if (!rect) {
    scheduleHide();
    return;
  }

  showButton(rect);
}

function onSelectionChange() {
  // debounce micro-bursts
  scheduleHide();
  window.requestAnimationFrame(handleSelection);
}

function setup() {
  createButton();
  document.addEventListener("mouseup", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    onSelectionChange();
  });
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("keyup", onSelectionChange);
  document.addEventListener("scroll", () => hideButton(), true);
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.id === BUTTON_ID) return;
    if (!getSelectionText()) hideButton();
  });
}

setup();
