import { useEffect, useState } from "react";
import type { ApiKeys } from "@wild/shared";
import { Layout } from "../components/Layout";
import { getAll, setAll } from "../lib/storage";

export default function OptionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [apiKeys, setApiKeys] = useState<ApiKeys>({});

  useEffect(() => {
    (async () => {
      try {
        const s = await getAll();
        setApiKeys(s.apiKeys ?? {});
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

  if (loading) return <Layout title="Wild Translator Settings">Loading...</Layout>;

  return (
    <Layout title="Wild Translator Settings">
      {error && (
        <div style={{ background: "#fee", border: "1px solid #f99", padding: 8, marginBottom: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ background: "#efe", border: "1px solid #9f9", padding: 8, marginBottom: 8, fontSize: 12 }}>
          {saved}
        </div>
      )}

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

        <button onClick={save}>Save</button>
        <p style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.4 }}>
          Keys are stored in <code>chrome.storage.sync</code> on your browser profile.
        </p>
      </div>
    </Layout>
  );
}
