import { el, setStyles } from "./app/dom.js";
import { createLayout } from "./app/layout.js";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app root");
}

const layout = createLayout(root, {
  title: "わいるどぱんち",
  showSettingsLink: false,
});

const container = el("div");
setStyles(container, { display: "grid", gap: "10px" });

const intro = el("p", {
  text: "AI translator extension with a pure TypeScript popup and options UI.",
});
setStyles(intro, { fontSize: "13px", lineHeight: "1.5", margin: "0" });

const links = el("div");
setStyles(links, { display: "grid", gap: "6px" });

const popupLink = el("a", {
  text: "Open Popup UI",
  attrs: { href: "./popup/index.html" },
});

const optionsLink = el("a", {
  text: "Open Settings",
  attrs: { href: "./options/index.html" },
});

links.append(popupLink, optionsLink);
container.append(intro, links);
layout.content.append(container);
