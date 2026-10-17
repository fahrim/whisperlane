import { useEffect, useRef, useState } from "react";
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
  ThemeChoice,
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
  const [themes, setThemes] = useState<ThemeChoice[]>([]);
  const [startWithWindows, setStartWithWindows] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [askMic, setAskMic] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [download, setDownload] = useState<Download | null>(null);

  // Derived from the saved settings rather than remembered here. Held in
  // state, the introduction would come back on every reload, and a
  // "first run" that repeats is not one.
  const firstRun = settings !== null && !settings.onboarded;

  async function finishOnboarding() {
    try {
      setSettings(await invoke<Settings>("complete_onboarding"));
    } catch (e) {
      setError(String(e));
    }
  }

  // The theme is applied to the document, not painted into components,
  // so the whole surface follows one attribute and the stylesheet stays
  // the only place that knows what dark looks like. Removing the
  // attribute is what "follow the system" means — the stylesheet's media
  // query then answers, which is why switching to the system theme is
  // live without a reload.
  useEffect(() => {
    const value = settings?.theme ?? "system";
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, [settings?.theme]);

  // The close button in the title bar and the operating system's own
  // close must mean the same thing: the window goes away and the tray
  // keeps the application alive. The core decides what happens on close,
  // so this asks rather than hides.
  async function hideWindow() {
    try {
      await invoke("toggle_settings");
    } catch (e) {
      setError(String(e));
    }
  }

  // A frameless window has nothing to make it look the size it is, so it
  // is sized to its content. Measured after layout, and again whenever the
  // content changes, because a setting that adds a row must move the edge
  // rather than be clipped by it.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      const bleed = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--window-bleed"),
      ) || 0;
      void invoke("fit_window", {
        contentWidth: frame.offsetWidth,
        contentHeight: frame.offsetHeight,
        bleed,
      }).catch(() => {});
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

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

  async function chooseTheme(code: string) {
    try {
      setSettings(await invoke<Settings>("set_theme", { theme: code }));
    } catch (e) {
      setError(String(e));
    }
  }

  // Read back from the system rather than assuming the click landed:
  // the registration can be refused, and a checkbox that claims to be on
  // when it is off is worse than one that says it failed.
  async function chooseStartWithWindows(start: boolean) {
    setStartBusy(true);
    try {
      await invoke<Settings>("set_start_with_windows", { start });
      setStartWithWindows(await invoke<boolean>("is_start_with_windows"));
    } catch (e) {
      setStartWithWindows(await invoke<boolean>("is_start_with_windows").catch(() => start));
      setError(String(e));
    } finally {
      setStartBusy(false);
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
    invoke<ThemeChoice[]>("list_themes")
      .then(setThemes)
      .catch((e) => setError(String(e)));
    invoke<boolean>("is_start_with_windows")
      .then(setStartWithWindows)
      .catch(() => {});
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
    <div className="window">
      <div className="window-frame" ref={frameRef}>
        <header className="title-bar" data-tauri-drag-region="deep">
          <span className="title-bar-name">whisperlane</span>
          <span className="title-bar-drag" />
          <button
            type="button"
            className="title-bar-close"
            aria-label="Close"
            onClick={hideWindow}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <main className="content">
      {/* Nothing is chosen until the saved settings answer which screen
          this launch is. Rendering the settings screen first would flash
          it at someone who has not been here before. */}
      {settings === null && <p role="status">loading…</p>}
      {settings !== null && firstRun && (
        <FirstRun
          hotkey={hotkey}
          settings={settings ?? { language: "…", hotkey, microphone: { kind: "system_default" }, model: "" }}
          status={status}
          download={download}
          model={chosenModel}
          onDownload={() =>
            chosenModel && downloadModel(chosenModel.id)
          }
          onDone={finishOnboarding}
        />
      )}
      {settings !== null && !firstRun && (
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

        <label>
          theme:
          <select
            value={settings?.theme ?? "system"}
            onChange={(e) => void chooseTheme(e.target.value)}
          >
            {themes.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <p>matching the system keeps up with it as it changes.</p>

        <label className="setting-row">
          <span>start with Windows:</span>
          <input
            type="checkbox"
            checked={startWithWindows}
            disabled={startBusy}
            onChange={(e) => void chooseStartWithWindows(e.target.checked)}
          />
        </label>
        <p>so the chord is there when you want it. change it any time.</p>
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
      </div>
    </div>
  );
}

export default App;
