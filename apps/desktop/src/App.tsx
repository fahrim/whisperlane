import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FirstRun } from "./FirstRun";
import { deliveryNote, transcriptMatters } from "./delivery";
import type {
  Download,
  HotkeyChoice,
  InputDevice,
  LanguageChoice,
  Microphone,
  ModelOption,
  PipelineStatus,
  Settings,
} from "./types";
import "./App.css";

interface SttStatus {
  model_file: string;
  model_present: boolean;
  backend: string;
  backend_verified: boolean;
  service: "unloaded" | "starting" | "ready" | "failed";
  detail: string | null;
}

function App() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [stt, setStt] = useState<SttStatus | null>(null);
  const [hotkey, setHotkey] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeyChoice[]>([]);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [askMic, setAskMic] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [download, setDownload] = useState<Download | null>(null);
  const [firstRun, setFirstRun] = useState(true);

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

  const live =
    status !== null &&
    (status.phase === "listening" || status.phase === "thinking");

  // The chosen model's own entry, for the first-run line that says
  // whether it is ready. Found by id, so a settings file naming a model
  // the catalog dropped falls back to the default rather than vanishing.
  const chosenModel =
    modelOptions.find((option) => option.id === settings?.model) ??
    modelOptions.find((option) => option.is_default) ??
    null;

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        setStatus(await invoke<PipelineStatus>("get_pipeline_state"));
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
    // First run brings the model down on its own, quietly, while the
    // user reads the one instruction. Later runs never fetch anything
    // the user did not ask for.
    invoke<Download>("ensure_model_ready")
      .then(setDownload)
      .catch((e) => setError(String(e)));
    const timer = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="container">
      {firstRun && (
        <FirstRun
          hotkey={hotkey}
          settings={settings ?? { language: "…", hotkey, microphone: { kind: "system_default" }, model: "" }}
          status={status}
          download={download}
          model={chosenModel}
          onDownload={() =>
            chosenModel && downloadModel(chosenModel.id)
          }
          onDone={() => setFirstRun(false)}
        />
      )}
      {!firstRun && (
      <>
      <h1>whisperlane</h1>
      <p className="settings-lead">
        Hold <strong>{hotkey}</strong> to talk, or tap it to keep talking.
        Your words go wherever the cursor is.
      </p>
      {error && <p role="alert">state error: {error}</p>}
      {live && (
        <p role="status">
          Listening — press {hotkey} again to insert, Escape to discard.
        </p>
      )}
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
        <h2>speech model</h2>
        {stt ? (
          <>
            <p>
              {stt.model_present
                ? `Ready, transcribing on the ${stt.backend} path`
                : "Not downloaded yet — dictation needs it before the first take."}
            </p>
            <p className="settings-note">
              The backend is {stt.backend_verified
                ? "confirmed by launching the engine"
                : "reported by the runtime, not yet confirmed"}
              .
            </p>
            {stt.detail && <p>{stt.detail}</p>}
          </>
        ) : (
          <p>loading service state…</p>
        )}
      </section>
      {status !== null &&
        transcriptMatters(status.last_text, status.delivery) && (
        <section aria-label="last take">
          <h2>last take</h2>
          <p>
            <strong>{status.last_text}</strong>
          </p>
          <p role="status">{deliveryNote(status.delivery, status.detail)}</p>
          <button
            type="button"
            onClick={() =>
              invoke<PipelineStatus>("copy_last_text")
                .then(setStatus)
                .catch((e) => setError(String(e)))
            }
          >
            {status.delivery === "clipboard" ? "copy again" : "copy to clipboard"}
          </button>
        </section>
      )}
      </>
      )}
    </main>
  );
}

export default App;
