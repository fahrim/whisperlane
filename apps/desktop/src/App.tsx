import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Phase = "idle" | "listening" | "thinking" | "done" | "failed" | "cancelled";

interface PipelineStatus {
  phase: Phase;
  target: string | { agent: string };
  detail: string | null;
  valid_next: Phase[];
  last_text: string | null;
}

interface SttStatus {
  model_file: string;
  model_present: boolean;
  backend: string;
  service: "unloaded" | "starting" | "ready" | "failed";
  detail: string | null;
}

function targetLabel(target: PipelineStatus["target"]): string {
  if (typeof target === "string") return target;
  return `agent:${target.agent}`;
}

function App() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [stt, setStt] = useState<SttStatus | null>(null);
  const [hotkey, setHotkey] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);

  async function refreshStt() {
    try {
      setStt(await invoke<SttStatus>("get_stt_status"));
    } catch (e) {
      setError(String(e));
    }
  }

  const terminal =
    status !== null &&
    (status.phase === "done" ||
      status.phase === "failed" ||
      status.phase === "cancelled");

  async function reset() {
    try {
      setStatus(await invoke<PipelineStatus>("reset_pipeline"));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    invoke<PipelineStatus>("get_pipeline_state")
      .then(setStatus)
      .catch((e) => setError(String(e)));
    invoke<string>("get_hotkey_label")
      .then(setHotkey)
      .catch((e) => setError(String(e)));
    refreshStt().catch((e) => setError(String(e)));
    listen<PipelineStatus>("pipeline-state", (event) => {
      setStatus(event.payload);
      refreshStt().catch((e) => setError(String(e)));
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => setError(String(e)));
    return () => unlisten?.();
  }, []);

  return (
    <main className="container">
      <h1>whisperlane (M0 skeleton)</h1>
      <p>
        hold <strong>{hotkey}</strong> to talk
      </p>
      {error && <p role="alert">state error: {error}</p>}
      {status ? (
        <section aria-label="pipeline status">
          <p>
            phase: <strong>{status.phase}</strong>
          </p>
          <p>target: {targetLabel(status.target)}</p>
          <p>valid next: {status.valid_next.join(", ") || "—"}</p>
          {terminal && (
            <button type="button" onClick={reset}>
              back to idle
            </button>
          )}
          {status.detail && <p>detail: {status.detail}</p>}
        </section>
      ) : (
        !error && <p>loading pipeline state…</p>
      )}
      <p>Hotkey, capture, and transcription land in the next slices.</p>
      <section aria-label="transcription service">
        <h2>transcription</h2>
        {stt ? (
          <>
            <p>
              model: {stt.model_file} (
              {stt.model_present ? "present" : "missing"})
            </p>
            <p>service: {stt.service} (backend: {stt.backend})</p>
            {stt.detail && <p>detail: {stt.detail}</p>}
          </>
        ) : (
          <p>loading service state…</p>
        )}
        {status?.last_text && (
          <p>
            transcript: <strong>{status.last_text}</strong>
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
