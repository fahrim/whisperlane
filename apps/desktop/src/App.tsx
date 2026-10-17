import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FirstRun } from "./FirstRun";
import { Picker, Switch } from "./controls";
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

  // Choosing a model is the request for it. The three separate download
  // buttons this replaces asked the same question twice: "which model" and
  // "now get it", in two controls, which is how a window ends up offering
  // a gigabyte of choices as three buttons of equal weight. Picking the
  // model fetches it; a button is left only for the case where that fetch
  // failed, and it says so.
  async function chooseModel(id: string) {
    try {
      setSettings(await invoke<Settings>("set_model", { model: id }));
      const chosen = modelOptions.find((option) => option.id === id);
      if (chosen && !chosen.present && !download?.running) {
        setDownload(await invoke<Download>("download_model", { id }));
      }
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

  // One line saying what the model is doing, in the only language a
  // settings window should use for it. The engine's backend name and
  // whether that name has been verified by launching the binary are
  // diagnostics: true, but not the user's business, and shown here they
  // read as though something were wrong.
  //
  // An idle engine reads as ready, because it is: the model is on disk and
  // the service starts on the first take. "Getting ready" is kept for a
  // start already in progress, because a window that says it about a
  // service that has not begun to start is reporting on nothing.
  const modelLine = (() => {
    if (download?.running) {
      const progress =
        download.percent !== null ? ` · ${download.percent}%` : "";
      return `downloading${progress} · ${download.received_mb} of ${download.total_mb} MB`;
    }
    if (!chosenModel) return null;
    if (!chosenModel.present) return `${chosenModel.size_mb} MB · not downloaded`;
    if (!stt) return null;
    if (stt.service === "failed")
      return stt.detail ?? "the engine could not start";
    if (stt.service === "starting") return "getting ready…";
    return `${chosenModel.size_mb} MB · ready`;
  })();

  // Offered whenever the model is absent and nothing is on its way, so a
  // button on this row always means the same thing: fetch it. Choosing a
  // model already starts this, which leaves the button for the fetch that
  // did not finish.
  const retryDownload =
    chosenModel !== null && !chosenModel.present && !download?.running;

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
          settings={settings}
          hotkey={hotkey}
          status={status}
          download={download}
          model={chosenModel}
          choices={{
            hotkeys,
            languages,
            devices,
            startWithWindows,
          }}
          change={{
            hotkey: chooseHotkey,
            language: chooseLanguage,
            microphone: (value) =>
              void chooseMicrophone(
                value === "system_default"
                  ? { kind: "system_default" }
                  : { kind: "device", id: value },
              ),
            startWithWindows: (next) => void chooseStartWithWindows(next),
          }}
          onDownload={() =>
            chosenModel && downloadModel(chosenModel.id)
          }
          onDone={finishOnboarding}
        />
      )}
      {settings !== null && !firstRun && (
      <>
      {error && <p role="alert" className="banner">{error}</p>}
      {live && (
        <p role="status" className="banner">
          Listening — press {hotkey} again to insert, Escape to discard.
        </p>
      )}
      <p className="settings-lead">
        Hold <kbd>{hotkey}</kbd> to talk, or tap it to keep talking.
        Your words go wherever the cursor is.
      </p>

      <section aria-label="dictation">
        <h2>Dictation</h2>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Hold to talk</span>
          </span>
          <Picker value={settings.hotkey} onChange={chooseHotkey}>
            {hotkeys.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </Picker>
        </label>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Microphone</span>
            {askMic && (
              <span className="field-hint">pick the one you speak into</span>
            )}
          </span>
          <Picker
            value={
              settings.microphone.kind === "device"
                ? (settings.microphone.id ?? "")
                : "system_default"
            }
            onChange={(value) =>
              void chooseMicrophone(
                value === "system_default"
                  ? { kind: "system_default" }
                  : { kind: "device", id: value },
              )
            }
          >
            <option value="system_default">System default</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </Picker>
        </label>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Language</span>
            <span className="field-hint">applies to the next take</span>
          </span>
          <Picker value={settings.language} onChange={chooseLanguage}>
            {languages.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </Picker>
        </label>
      </section>

      <section aria-label="speech model">
        <h2>Speech model</h2>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Model</span>
            <span className="field-hint">
              bigger hears more, but answers slower
            </span>
          </span>
          <Picker value={settings.model} onChange={chooseModel}>
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Picker>
        </label>
        {modelLine && (
          <div className="field-status-row">
            <p className="field-status">{modelLine}</p>
            {retryDownload && chosenModel && (
              <button type="button" onClick={() => downloadModel(chosenModel.id)}>
                Download
              </button>
            )}
          </div>
        )}
        {download?.error && (
          <p role="alert" className="field-status">
            {download.error}
          </p>
        )}
      </section>

      <section aria-label="appearance">
        <h2>Appearance</h2>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Theme</span>
            <span className="field-hint">
              following the system keeps up as it changes
            </span>
          </span>
          <Picker value={settings.theme} onChange={chooseTheme}>
            {themes.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </Picker>
        </label>
      </section>

      <section aria-label="startup">
        <h2>Startup</h2>
        <div className="field">
          <span className="field-text">
            <span className="field-label">Start with Windows</span>
            <span className="field-hint">
              so the chord is there when you want it
            </span>
          </span>
          <Switch
            checked={startWithWindows}
            disabled={startBusy}
            label="Start with Windows"
            onChange={(next) => void chooseStartWithWindows(next)}
          />
        </div>
      </section>

      {status !== null &&
        transcriptMatters(status.last_text, status.delivery) && (
          <section aria-label="last take">
            <h2>Last take</h2>
            <p className="last-take-text">{status.last_text}</p>
            <p className="field-status" role="status">
              {deliveryNote(status.delivery, status.detail)}
            </p>
            <div className="field-status-row">
              <span />
              <button
                type="button"
                onClick={() =>
                  invoke<PipelineStatus>("copy_last_text")
                    .then(setStatus)
                    .catch((e) => setError(String(e)))
                }
              >
                {status.delivery === "clipboard" ? "Copy again" : "Copy to clipboard"}
              </button>
            </div>
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
