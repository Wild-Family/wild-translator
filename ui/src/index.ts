async function loadTheme(): Promise<"light" | "dark"> {
  try {
    const saved = await chrome.storage?.local?.get(["uiTheme"]);
    return saved?.uiTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: "light" | "dark", button: HTMLButtonElement): void {
  document.documentElement.dataset.theme = theme;
  const nextLabel =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  button.textContent = theme === "dark" ? "🌞" : "🌙";
  button.setAttribute("aria-label", nextLabel);
  button.title = nextLabel;
}

async function bootstrap(): Promise<void> {
  const button = document.getElementById("theme-toggle");
  if (!(button instanceof HTMLButtonElement)) return;

  let theme = await loadTheme();
  applyTheme(theme, button);

  button.addEventListener("click", async () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme, button);
    try {
      await chrome.storage?.local?.set({ uiTheme: theme });
    } catch {
      // ignore
    }
  });
}

void bootstrap();
