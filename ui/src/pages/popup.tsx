import { useEffect, useMemo, useState } from "react";
import type { PromptTemplate, ProviderId } from "@wild/shared";
import { Layout } from "../components/Layout";
import { getAll, setAll } from "../lib/storage";

type GenerateResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

function newId() {
  return `p_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export default function PopupPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string | undefined>(undefined);

  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState(true);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === defaultPromptId) ?? prompts[0],
    [prompts, defaultPromptId]
  );

  useEffect(() => {
    (async () => {
      try {
        const s = await getAll();
        setPrompts(s.prompts);
        setDefaultPromptId(s.defaultPromptId);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function run() {
    setError(null);
    setBusy(true);
    setOutputText("");

    try {
      if (stream) {
        const port = chrome.runtime.connect({ name: "wild:generate" });

        await new Promise<void>((resolve, reject) => {
          port.onMessage.addListener((m: any) => {
            if (m?.type === "STREAM_DELTA") setOutputText((t) => t + String(m.delta ?? ""));
            if (m?.type === "STREAM_ERROR") {
              port.disconnect();
              reject(new Error(String(m.error ?? "Stream error")));
            }
            if (m?.type === "STREAM_END") {
              port.disconnect();
              resolve();
            }
          });

          port.postMessage({
            type: "GENERATE_STREAM",
            inputText,
            promptId: defaultPromptId
          });
        });
      } else {
        const resp: GenerateResponse = await chrome.runtime.sendMessage({
          type: "GENERATE",
          inputText,
          promptId: defaultPromptId
        });
        if (!resp.ok) throw new Error(resp.error);
        setOutputText(resp.text);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function savePrompts(next: PromptTemplate[], nextDefaultId?: string) {
    setPrompts(next);
    setDefaultPromptId(nextDefaultId);
    await setAll({ prompts: next, defaultPromptId: nextDefaultId });
  }

  if (loading) return <Layout title="Wild Translator">Loading...</Layout>;

  return (
    <Layout title="Wild Translator">
      {error && (
        <div style={{ background: "#fee", border: "1px solid #f99", padding: 8, marginBottom: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <select
          value={defaultPromptId}
          onChange={async (e) => {
            const id = e.target.value;
            setDefaultPromptId(id);
            await setAll({ defaultPromptId: id });
          }}
          style={{ flex: 1 }}
        >
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />
          Stream
        </label>

        <button
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
          +
        </button>
      </div>

      {selectedPrompt && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12 }}>Edit prompt</summary>
          <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>
              Name
              <input
                value={selectedPrompt.name}
                onChange={async (e) => {
                  const next = prompts.map((p) => (p.id === selectedPrompt.id ? { ...p, name: e.target.value } : p));
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

            <button
              onClick={async () => {
                const next = prompts.filter((p) => p.id !== selectedPrompt.id);
                const nextDefault = next.find((p) => p.id === defaultPromptId)?.id ?? next[0]?.id;
                await savePrompts(next, nextDefault);
              }}
              style={{ background: "#fff", border: "1px solid #f66", color: "#b00" }}
            >
              Delete
            </button>
          </div>
        </details>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <textarea
          placeholder="Input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={7}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={run} disabled={busy || !inputText.trim()} style={{ flex: 1 }}>
            {busy ? "Running…" : "Run"}
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(outputText);
            }}
            disabled={!outputText}
          >
            Copy
          </button>
        </div>
        <textarea
          placeholder="Output"
          value={outputText}
          readOnly
          rows={8}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>
    </Layout>
  );
}
