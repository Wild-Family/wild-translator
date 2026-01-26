import { useEffect, useState } from "react";
import type { ApiKeys, PromptTemplate, ProviderId } from "@wild/shared";
import { Layout } from "../components/Layout";
import { getAll, setAll } from "../lib/storage";

export default function OptionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [tab, setTab] = useState<"keys" | "prompts" | "shortcuts">("keys");

  const [apiKeys, setApiKeys] = useState<ApiKeys>({});
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const s = await getAll();
        setApiKeys(s.apiKeys ?? {});
        setPrompts(s.prompts ?? []);
        setDefaultPromptId(s.defaultPromptId);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setError(null);
    setSaved(null);
    try {
      await setAll({ apiKeys });
      setSaved("Saved.");
      setTimeout(() => setSaved(null), 1500);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function savePrompts(next: PromptTemplate[], nextDefaultId?: string) {
    setPrompts(next);
    setDefaultPromptId(nextDefaultId);
    await setAll({ prompts: next, defaultPromptId: nextDefaultId });
  }

  function newId() {
    return `p_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  const selectedPrompt = prompts.find((p) => p.id === defaultPromptId) ?? prompts[0];

  const copyShortcutsUrl = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions/shortcuts");
      setSaved("Copied shortcuts URL.");
      setTimeout(() => setSaved(null), 1500);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  if (loading) return <Layout title="Wild Translator Settings">Loading...</Layout>;

  return (
    <Layout title="Wild Translator Settings">
      {error && (
        <div
          style={{
            background: "#fee",
            border: "1px solid #f99",
            color: "#7f1d1d",
            padding: 8,
            marginBottom: 8,
            fontSize: 12
          }}
        >
          {error}
        </div>
      )}
      {saved && (
        <div
          style={{
            background: "#efe",
            border: "1px solid #9f9",
            color: "#065f46",
            padding: 8,
            marginBottom: 8,
            fontSize: 12
          }}
        >
          {saved}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setTab("keys")}
          style={{
            padding: "8px 2px",
            border: "none",
            borderBottom: tab === "keys" ? "2px solid var(--text)" : "2px solid transparent",
            background: "transparent",
            color: tab === "keys" ? "var(--text)" : "var(--muted)",
            fontSize: 12,
            fontWeight: tab === "keys" ? 600 : 400,
            cursor: "pointer",
            borderRadius: 0
          }}
        >
          API Keys
        </button>
        <button
          type="button"
          onClick={() => setTab("prompts")}
          style={{
            padding: "8px 2px",
            border: "none",
            borderBottom: tab === "prompts" ? "2px solid var(--text)" : "2px solid transparent",
            background: "transparent",
            color: tab === "prompts" ? "var(--text)" : "var(--muted)",
            fontSize: 12,
            fontWeight: tab === "prompts" ? 600 : 400,
            cursor: "pointer",
            borderRadius: 0
          }}
        >
          Prompts
        </button>
        <button
          type="button"
          onClick={() => setTab("shortcuts")}
          style={{
            padding: "8px 2px",
            border: "none",
            borderBottom: tab === "shortcuts" ? "2px solid var(--text)" : "2px solid transparent",
            background: "transparent",
            color: tab === "shortcuts" ? "var(--text)" : "var(--muted)",
            fontSize: 12,
            fontWeight: tab === "shortcuts" ? 600 : 400,
            cursor: "pointer",
            borderRadius: 0
          }}
        >
          Shortcuts
        </button>
      </div>

      {tab === "keys" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 12 }}>
            OpenAI API Key
            <input
              value={apiKeys.openai ?? ""}
              onChange={(e) => setApiKeys((k) => ({ ...k, openai: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="sk-..."
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Gemini API Key
            <input
              value={apiKeys.gemini ?? ""}
              onChange={(e) => setApiKeys((k) => ({ ...k, gemini: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="AIza..."
            />
          </label>

          <label style={{ fontSize: 12 }}>
            Claude API Key
            <input
              value={apiKeys.claude ?? ""}
              onChange={(e) => setApiKeys((k) => ({ ...k, claude: e.target.value }))}
              style={{ width: "100%" }}
              placeholder="sk-ant-..."
            />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={save}>Save</button>
          </div>
          <p style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.4 }}>
            Keys are stored in <code>chrome.storage.sync</code> on your browser profile.
          </p>
        </div>
      ) : tab === "prompts" ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={selectedPrompt?.id}
              onChange={(e) => setDefaultPromptId(e.target.value)}
              style={{ flex: 1 }}
            >
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                const p: PromptTemplate = {
                  id: newId(),
                  name: `Prompt ${prompts.length + 1}`,
                  template: "{{text}}",
                  provider: "openai" satisfies ProviderId
                };
                await savePrompts([p, ...prompts], p.id);
              }}
            >
              Add
            </button>
          </div>

          {selectedPrompt && (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontSize: 12 }}>
                Name
                <input
                  value={selectedPrompt.name}
                  onChange={async (e) => {
                    const next = prompts.map((p) =>
                      p.id === selectedPrompt.id ? { ...p, name: e.target.value } : p
                    );
                    await savePrompts(next, defaultPromptId);
                  }}
                  style={{ width: "100%" }}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Provider
                <select
                  value={selectedPrompt.provider ?? "openai"}
                  onChange={async (e) => {
                    const next = prompts.map((p) =>
                      p.id === selectedPrompt.id ? { ...p, provider: e.target.value as ProviderId } : p
                    );
                    await savePrompts(next, defaultPromptId);
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="claude">Claude</option>
                </select>
              </label>

              <label style={{ fontSize: 12 }}>
                Model (optional)
                <input
                  value={selectedPrompt.model ?? ""}
                  onChange={async (e) => {
                    const v = e.target.value || undefined;
                    const next = prompts.map((p) => (p.id === selectedPrompt.id ? { ...p, model: v } : p));
                    await savePrompts(next, defaultPromptId);
                  }}
                  style={{ width: "100%" }}
                />
              </label>

              <label style={{ fontSize: 12 }}>
                Template (use {'{{text}}'})
                <textarea
                  value={selectedPrompt.template}
                  onChange={async (e) => {
                    const next = prompts.map((p) =>
                      p.id === selectedPrompt.id ? { ...p, template: e.target.value } : p
                    );
                    await savePrompts(next, defaultPromptId);
                  }}
                  rows={6}
                  style={{ width: "100%" }}
                />
              </label>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={async () => {
                    const next = prompts.filter((p) => p.id !== selectedPrompt.id);
                    const nextDefault = next.find((p) => p.id === defaultPromptId)?.id ?? next[0]?.id;
                    await savePrompts(next, nextDefault);
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedPrompt) return;
                    await savePrompts(prompts, selectedPrompt.id);
                  }}
                  style={{ background: "var(--surface)", color: "var(--text)" }}
                >
                  Set Default
                </button>
              </div>
              <p style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.4, margin: 0 }}>
                The default prompt is used by the popup&apos;s Run action.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            Chrome blocks extensions from opening <code>chrome://</code> URLs directly.
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            Open <code>chrome://extensions/shortcuts</code> manually to set the shortcut.
          </p>
          <button onClick={copyShortcutsUrl} type="button" style={{ width: "fit-content" }}>
            Copy shortcuts URL
          </button>
        </div>
      )}
    </Layout>
  );
}
