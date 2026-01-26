import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      chrome.storage?.local?.get(["uiTheme"], (res: { uiTheme?: string }) => {
        const next = res?.uiTheme === "dark" ? "dark" : "light";
        setTheme(next);
        document.documentElement.dataset.theme = next;
      });
    } catch {
      // ignore
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      chrome.storage?.local?.set({ uiTheme: next });
    } catch {
      // ignore
    }
  };

  const themeAriaLabel = useMemo(() => (theme === "dark" ? "Switch to light mode" : "Switch to dark mode"), [theme]);

  const openSettings = () => {
    const runtime: any = (globalThis as any)?.chrome?.runtime;
    if (runtime?.openOptionsPage) {
      runtime.openOptionsPage();
      return;
    }

    const url = runtime?.getURL?.("ui/options/index.html");
    if (url) {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div
      className="wt-app"
      style={{
        padding: 12,
        width: 520,
        minWidth: 520,
        height: "100%",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ fontSize: 14, margin: 0 }}>{title}</h1>
        <button
          type="button"
          onClick={openSettings}
          style={{
            fontSize: 12,
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--accent-strong)",
            textDecoration: "underline",
            cursor: "pointer"
          }}
        >
          Settings
        </button>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 8,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center"
        }}
      >
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={themeAriaLabel}
          title={themeAriaLabel}
          style={{ padding: "6px 10px", fontSize: 14 }}
        >
          {theme === "dark" ? "🌞" : "🌙"}
        </button>
      </div>
    </div>
  );
}
