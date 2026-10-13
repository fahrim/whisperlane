import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Phase = "idle" | "listening" | "thinking" | "done" | "failed" | "cancelled";

interface PipelineStatus {
  phase: Phase;
  target: string | { agent: string };
  detail: string | null;
  valid_next: Phase[];
  last_text: string | null;
}

interface KeyDiag {
  last_event: string;
  last_count: number;
  ctrl: boolean;
  shift: boolean;
  trigger: boolean;
  active: boolean;
  chords_seen: number;
  swallowed: number;
}

interface SttStatus {
  model_file: string;
  model_present: boolean;
  backend: string;
  service: "unloaded" | "starting" | "ready" | "failed";
  detail: string | null;
}

interface Settings {
  language: string;
  hotkey: string;
}

interface LanguageChoice {
  code: string;
  label: string;
}

interface HotkeyChoice {
  code: string;
  label: string;
}

function targetLabel(target: PipelineStatus["target"]): string {
  if (typeof target === "string") return target;
  return `agent:${target.agent}`;
}

function App() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [stt, setStt] = useState<SttStatus | null>(null);
  const [diag, setDiag] = useState<KeyDiag | null>(null);
  const [hotkey, setHotkey] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeyChoice[]>([]);

  async function refreshStt() {
    try {
      setStt(await invoke<SttStatus>("get_stt_status"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseLanguage(code: string) {
    try {
      setSettings(await invoke<Settings>("set_language", { language: code }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseHotkey(code: string) {
    try {
      setSettings(await invoke<Settings>("set_hotkey", { hotkey: code }));
      setHotkey(await invoke<string>("get_hotkey_label"));
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
    let stop = false;
    async function poll() {
      try {
        setStatus(await invoke<PipelineStatus>("get_pipeline_state"));
        setDiag(await invoke<KeyDiag>("get_key_diag"));
        await refreshStt();
      } catch (e) {
        if (!stop) setError(String(e));
      }
    }
    invoke<string>("get_hotkey_label")
      .then(setHotkey)
      .catch((e) => setError(String(e)));
    invoke<Settings>("get_settings")
      .then(setSettings)
      .catch((e) => setError(String(e)));
    invoke<LanguageChoice[]>("list_languages")
      .then(setLanguages)
      .catch((e) => setError(String(e)));
    invoke<HotkeyChoice[]>("list_hotkeys")
      .then(setHotkeys)
      .catch((e) => setError(String(e)));
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
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
      <section aria-label="hotkey diagnostics">
        <h2>hotkey diagnostics</h2>
        {diag ? (
          <>
            <p>last: {diag.last_event || "—"}</p>
            <p>
              chord state: ctrl={String(diag.ctrl)} shift={String(diag.shift)}{" "}
              trigger={String(diag.trigger)} active={String(diag.active)}
            </p>
            <p>
              edges: {diag.chords_seen} (swallowed {diag.swallowed})
            </p>
          </>
        ) : (
          <p>loading…</p>
        )}
      </section>
      <section aria-label="settings">
        <h2>settings</h2>
        <label>
          hotkey:{" "}
          <select
            value={settings?.hotkey ?? ""}
            onChange={(e) => chooseHotkey(e.target.value)}
          >
            {hotkeys.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          language:{" "}
          <select
            value={settings?.language ?? ""}
            onChange={(e) => chooseLanguage(e.target.value)}
          >
            {languages.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <p>language applies to the next take; the service reloads.</p>
      </section>
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
          <>
            <p>
              transcript: <strong>{status.last_text}</strong>
            </p>
            {status.phase === "done" && (
              <button
                type="button"
                onClick={() =>
                  invoke<PipelineStatus>("copy_last_text")
                    .then(setStatus)
                    .catch((e) => setError(String(e)))
                }
              >
                copy again
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;
