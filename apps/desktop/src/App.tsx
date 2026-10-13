import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Phase = "idle" | "listening" | "thinking" | "done" | "failed" | "cancelled";

type DeliveryKind = "none" | "typed" | "partial" | "clipboard";

interface PipelineStatus {
  phase: Phase;
  target: string | { agent: string };
  detail: string | null;
  valid_next: Phase[];
  last_text: string | null;
  delivery: DeliveryKind;
}

interface KeyDiag {
  last_event: string;
  last_count: number;
  ctrl: boolean;
  shift: boolean;
  trigger: boolean;
  active: boolean;
  chords_seen: number;
}

interface SttStatus {
  model_file: string;
  model_present: boolean;
  backend: string;
  backend_verified: boolean;
  service: "unloaded" | "starting" | "ready" | "failed";
  detail: string | null;
}

interface Settings {
  language: string;
  hotkey: string;
  microphone: Microphone;
  model: string;
}

interface ModelOption {
  id: string;
  label: string;
  size_mb: number;
  present: boolean;
  is_default: boolean;
}

interface Download {
  running: boolean;
  model: string | null;
  received_mb: number;
  total_mb: number;
  percent: number | null;
  error: string | null;
}

interface Microphone {
  kind: "system_default" | "device";
  id?: string;
}

interface InputDevice {
  id: string;
  label: string;
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
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [askMic, setAskMic] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [download, setDownload] = useState<Download | null>(null);

  async function refreshModels() {
    try {
      setModelOptions(await invoke<ModelOption[]>("list_models"));
      setDownload(await invoke<Download>("get_download"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseModel(id: string) {
    try {
      setSettings(await invoke<Settings>("set_model", { model: id }));
      await refreshModels();
    } catch (e) {
      setError(String(e));
    }
  }

  async function downloadModel(id: string) {
    try {
      setDownload(await invoke<Download>("download_model", { id }));
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshStt() {
    try {
      setStt(await invoke<SttStatus>("get_stt_status"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseMicrophone(microphone: Microphone) {
    try {
      setSettings(await invoke<Settings>("set_microphone", { microphone }));
      setAskMic(await invoke<boolean>("needs_microphone_choice"));
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

  const live =
    status !== null &&
    (status.phase === "listening" || status.phase === "thinking");

  async function reset() {
    try {
      setStatus(await invoke<PipelineStatus>("reset_pipeline"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function cancel() {
    try {
      setStatus(await invoke<PipelineStatus>("cancel_live_take"));
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
        // Progress has to move while a download runs, and the list has
        // to change once it finishes.
        if (download?.running) {
          setDownload(await invoke<Download>("get_download"));
          if (!download.running) await refreshModels();
        }
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
    invoke<InputDevice[]>("list_input_devices")
      .then(setDevices)
      .catch((e) => setError(String(e)));
    invoke<boolean>("needs_microphone_choice")
      .then(setAskMic)
      .catch((e) => setError(String(e)));
    refreshModels();
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="container">
      <h1>whisperlane (M1)</h1>
      <p>
        hold <strong>{hotkey}</strong> to talk, or tap it to toggle — the
        chord starts a new take straight away after one finishes
      </p>
      {error && <p role="alert">state error: {error}</p>}
      {status ? (
        <section aria-label="pipeline status">
          <p>
            phase: <strong>{status.phase}</strong>
          </p>
          <p>target: {targetLabel(status.target)}</p>
          <p>valid next: {status.valid_next.join(", ") || "—"}</p>
          {live && (
            <button type="button" onClick={cancel}>
              discard (Esc)
            </button>
          )}
          {terminal && (
            <button type="button" onClick={reset}>
              clear
            </button>
          )}
          {status.delivery === "typed" && (
            <p role="status">typed into the focused app</p>
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
            <p>chords: {diag.chords_seen} (nothing is swallowed)</p>
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
          model:{" "}
          <select
            value={settings?.model ?? ""}
            onChange={(e) => chooseModel(e.target.value)}
          >
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} ({option.size_mb} MB
                {option.present ? "" : ", not downloaded"})
              </option>
            ))}
          </select>
        </label>
        {modelOptions
          .filter((option) => !option.present)
          .map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={download?.running}
              onClick={() => downloadModel(option.id)}
            >
              download {option.label} ({option.size_mb} MB)
            </button>
          ))}
        {download?.running && (
          <p>
            downloading {download.model}: {download.received_mb} /{" "}
            {download.total_mb} MB
            {download.percent !== null ? ` (${download.percent}%)` : ""} —
            dictation stays available
          </p>
        )}
        {download?.error && <p role="alert">download failed: {download.error}</p>}
        <label>
          microphone:{" "}
          <select
            value={
              settings?.microphone.kind === "device"
                ? (settings.microphone.id ?? "")
                : "system_default"
            }
            onChange={(e) =>
              chooseMicrophone(
                e.target.value === "system_default"
                  ? { kind: "system_default" }
                  : { kind: "device", id: e.target.value },
              )
            }
          >
            <option value="system_default">System default</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        {askMic && (
          <p>
            dictation works with the system default right now — pick the
            microphone you actually speak into.
          </p>
        )}
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
            <p>
              service: {stt.service} (backend: {stt.backend}
              {stt.backend_verified
                ? ", verified by launching"
                : ", from runtime files"})
            </p>
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
                {status.delivery === "clipboard" ? "copy again" : "copy anyway"}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default App;
