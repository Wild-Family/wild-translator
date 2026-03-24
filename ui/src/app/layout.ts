import { el, setStyles } from "./dom.js";

type LayoutOptions = {
  title: string;
  showSettingsLink?: boolean;
};

type LayoutHandle = {
  content: HTMLDivElement;
};

async function getTheme(): Promise<"light" | "dark"> {
  try {
    const result = await chrome.storage?.local?.get(["uiTheme"]);
    return result?.uiTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: "light" | "dark", button: HTMLButtonElement): void {
  document.documentElement.dataset.theme = theme;
  button.textContent = theme === "dark" ? "🌞" : "🌙";
  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function openSettingsPage(): void {
  const runtime = chrome?.runtime;
  if (runtime?.openOptionsPage) {
    runtime.openOptionsPage();
    return;
  }

  const url = runtime?.getURL?.("ui/options/index.html");
  if (url) {
    window.open(url, "_blank", "noopener");
  }
}

export function createLayout(
  root: HTMLElement,
  options: LayoutOptions,
): LayoutHandle {
  const app = el("div", { className: "wt-app" });
  setStyles(app, {
    padding: "12px",
    width: "520px",
    minWidth: "520px",
    height: "100%",
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });

  const header = el("div");
  setStyles(header, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "8px",
  });

  const title = el("h1", { text: options.title });
  setStyles(title, { fontSize: "14px", margin: "0" });
  header.append(title);

  if (options.showSettingsLink !== false) {
    const settingsButton = el("button", { text: "Settings" });
    settingsButton.type = "button";
    setStyles(settingsButton, {
      fontSize: "12px",
      background: "none",
      border: "none",
      padding: "0",
      color: "var(--accent-strong)",
      textDecoration: "underline",
      cursor: "pointer",
    });
    settingsButton.addEventListener("click", openSettingsPage);
    header.append(settingsButton);
  } else {
    header.append(el("div"));
  }

  const content = el("div");
  setStyles(content, { flex: "1" });

  const footer = el("div");
  setStyles(footer, {
    borderTop: "1px solid var(--border)",
    paddingTop: "8px",
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
  });

  const themeButton = el("button", { className: "btn-secondary" });
  themeButton.type = "button";
  setStyles(themeButton, { padding: "6px 10px", fontSize: "14px" });
  footer.append(themeButton);

  let theme: "light" | "dark" = "light";

  themeButton.addEventListener("click", async () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme, themeButton);
    try {
      await chrome.storage?.local?.set({ uiTheme: theme });
    } catch {
      // ignore
    }
  });

  void getTheme().then((nextTheme) => {
    theme = nextTheme;
    applyTheme(theme, themeButton);
  });

  app.append(header, content, footer);
  root.replaceChildren(app);

  return { content };
}
