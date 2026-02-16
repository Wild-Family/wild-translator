import { useEffect, useRef, useState } from "react";
import type { PromptTemplate } from "@wild/shared";
import { Layout } from "../components/Layout";
import { getAll, setAll } from "../lib/storage";

type GenerateResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

export default function PopupPage() {
  useEffect(() => {
    const width = 520;
    const height = 720;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.style.width = `${width}px`;
      el.style.minWidth = `${width}px`;
      el.style.height = `${height}px`;
      el.style.minHeight = `${height}px`;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string | undefined>(undefined);

  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const moveCaretToEndRef = useRef(false);
  const selectionDraftRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await getAll();
        setPrompts(s.prompts);
        setDefaultPromptId(s.defaultPromptId);

        // Prefill from selection draft (set by background/content).
        try {
          const store = chrome.storage?.session ?? chrome.storage?.local;
          const prefs = await chrome.storage?.local?.get(["selectionPrefillEnabled"]);
          if (prefs?.selectionPrefillEnabled === false) {
            if (store) await store.remove(["draftText"]);
          } else {
            const draft = store ? await store.get(["draftText"]) : {};
            const t = (draft as any)?.draftText;
            if (typeof t === "string") {
              setInputText(t);
              setOutputText("");
              selectionDraftRef.current = true;
              if (t.trim()) moveCaretToEndRef.current = true;
            }
            if (store) await store.remove(["draftText"]);
          }
        } catch {
          // ignore
        }

        // Restore last draft from previous popup session (if no selection draft).
        try {
          if (selectionDraftRef.current) return;
          const store = chrome.storage?.local;
          const draft = store ? await store.get(["popupDraft"]) : {};
          const saved = (draft as any)?.popupDraft as { input?: string; output?: string; promptId?: string } | undefined;
          if (saved?.input && !inputText.trim()) setInputText(saved.input);
          if (saved?.output) setOutputText(saved.output);
          if (saved?.promptId) setDefaultPromptId(saved.promptId);
        } catch {
          // ignore
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        if (moveCaretToEndRef.current) {
          const end = el.value.length;
          el.setSelectionRange(end, end);
          moveCaretToEndRef.current = false;
        }
      });
    }
  }, [loading, inputText]);

  useEffect(() => {
    if (loading) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        chrome.storage?.local?.set({
          popupDraft: { input: inputText, output: outputText, promptId: defaultPromptId }
        });
      } catch {
        // ignore
      }
    }, 250);
  }, [inputText, outputText, defaultPromptId, loading]);

  async function run() {
    setError(null);
    setBusy(true);
    setOutputText("");

    try {
      const p = chrome.runtime.connect({ name: "wild:generate" });
      await new Promise<void>((resolve, reject) => {
        p.onMessage.addListener((m: any) => {
          if (m?.type === "STREAM_DELTA") setOutputText((t) => t + String(m.delta ?? ""));
          if (m?.type === "STREAM_ERROR") {
            try {
              p.disconnect();
            } catch {}
            reject(new Error(String(m.error ?? "Stream error")));
          }
          if (m?.type === "STREAM_END") {
            try {
              p.disconnect();
            } catch {}
            resolve();
          }
        });

        p.postMessage({
          type: "GENERATE_STREAM",
          inputText,
          promptId: defaultPromptId
        });
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Layout title="わいるどぱんち">Loading...</Layout>;

  return (
    <Layout title="わいるどぱんち">
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

      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <textarea
          ref={inputRef}
          placeholder="Input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!busy && inputText.trim()) {
                void run();
              }
            }
          }}
          rows={7}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={run} disabled={busy || !inputText.trim()} style={{ flex: 1 }}>
            {busy ? "Running…" : "Run (Cmd+Enter)"}
          </button>
        </div>
        <div
          style={{
            width: "100%",
            minHeight: 180,
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "8px 10px",
            background: "var(--surface)",
            whiteSpace: "pre-wrap",
            fontSize: 13,
            maxHeight: 280,
            overflowY: "auto"
          }}
        >
          {outputText || "Output"}
        </div>
      </div>
    </Layout>
  );
}
