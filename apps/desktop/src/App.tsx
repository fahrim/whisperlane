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

  // Held while the introduction is being closed, for the reason given
  // below it.
  const [leaving, setLeaving] = useState(false);

  // Which screen this window is showing. The introduction is derived from
  // the saved settings rather than remembered here: held in state it would
  // come back on every reload, and a "first run" that repeats is not one.
  //
  // While closing, the introduction stays up. Blanking the window for the
  // moment between the click and the window going away is its own kind of
  // flicker, and so is showing the settings screen — which is the thing
  // being avoided — for the same moment.
  const showIntroduction =
    settings !== null && (!settings.onboarded || leaving);
  const showSettings = settings !== null && settings.onboarded && !leaving;

  // Finishing the introduction closes the window rather than swapping it
  // for the settings screen. The window exists for onboarding and the
  // occasional setting, so handing someone the full list the moment they
  // have finished setting up is the product insisting on being looked at;
  // it belongs in the tray, and settings are one right-click away.
  async function finishOnboarding() {
    setLeaving(true);
    try {
      setSettings(await invoke<Settings>("complete_onboarding"));
      await invoke("toggle_settings");
    } catch (e) {
      setLeaving(false);
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

  // Choosing a model says which model, and nothing else. It used to fetch
  // the one chosen, which quietly spent the user's bandwidth on a decision
  // they had only made provisionally — and a settings window is where
  // someone changes their mind. Fetching is its own act, behind its own
  // control, so the size of the download is something they agreed to
  // rather than something that happened.
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
  // when it is off is worse than one that says it failed. Answers with
  // whether it took, so a question on the first screen cannot keep a
  // choice the operating system declined.
  async function chooseStartWithWindows(start: boolean): Promise<boolean> {
    setStartBusy(true);
    try {
      await invoke<Settings>("set_start_with_windows", { start });
      setStartWithWindows(await invoke<boolean>("is_start_with_windows"));
      return true;
    } catch (e) {
      setStartWithWindows(await invoke<boolean>("is_start_with_windows").catch(() => start));
      setError(String(e));
      return false;
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

  // The one thing that fetches a model, offered whenever the chosen one is
  // not on disk and nothing is already on its way. It sits beside the
  // choice rather than below it so that what is missing and what to do
  // about it are the same gesture.
  const canDownload =
    chosenModel !== null && !chosenModel.present && !download?.running;

  // Progress has to move while a download runs, and the model list has to
  // change once it finishes. Both are read from the core on every tick
  // rather than only when the last tick said a download was running: this
  // poll is written once, at mount, so the `download` it closes over is
  // the value from that first render and never changes. Asking "is it
  // running" of a frozen answer means never asking.
  //
  // Whether the previous tick saw one running is kept in a ref for the
  // same reason, and because state cannot be read here without waiting.
  const wasDownloading = useRef(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        setStatus(await invoke<PipelineStatus>("get_pipeline_state"));
        await refreshStt();
        const state = await invoke<Download>("get_download");
        setDownload(state);
        if (wasDownloading.current && !state.running) await refreshModels();
        wasDownloading.current = state.running;
      } catch (e) {
        if (!stop) setError(String(e));
      }
    }
    invoke<string>("get_hotkey_label")
      .then(setHotkey)
      .catch((e) => setError(String(e)));
    invoke<Settings>("get_settings")
      .then((loaded) => {
        setSettings(loaded);
        // First run brings the model down on its own, quietly, while the
        // user reads the one instruction. Later runs never fetch anything
        // the user did not ask for: a missing model then is shown on the
        // model row with a download control, not fetched behind their
        // back.
        return invoke<Download>("ensure_model_ready", {
          firstRun: !loaded.onboarded,
        });
      })
      .then(setDownload)
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
      {/* Above both screens, because the first screen is where a refusal
          arrives: answering the startup question there and being told
          nothing would look like a control that does nothing. */}
      {error && (
        <p role="alert" className="banner">
          {error}
        </p>
      )}
      {showIntroduction && (
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
            startWithWindows: (next) => chooseStartWithWindows(next),
          }}
          onDownload={() =>
            chosenModel && downloadModel(chosenModel.id)
          }
          onDone={finishOnboarding}
        />
      )}
      {showSettings && (
      <>
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
        <div className="field">
          <span className="field-text">
            <span className="field-label">Hold to talk</span>
          </span>
          <Picker
            label="Hold to talk"
            value={settings.hotkey}
            options={hotkeys}
            onChange={chooseHotkey}
          />
        </div>
        <div className="field">
          <span className="field-text">
            <span className="field-label">Microphone</span>
            {askMic && (
              <span className="field-hint">pick the one you speak into</span>
            )}
          </span>
          <Picker
            label="Microphone"
            value={
              settings.microphone.kind === "device"
                ? (settings.microphone.id ?? "")
                : "system_default"
            }
            options={[
              { code: "system_default", label: "System default" },
              ...devices.map((device) => ({ code: device.id, label: device.label })),
            ]}
            onChange={(value) =>
              void chooseMicrophone(
                value === "system_default"
                  ? { kind: "system_default" }
                  : { kind: "device", id: value },
              )
            }
          />
        </div>
        <div className="field">
          <span className="field-text">
            <span className="field-label">Language</span>
            <span className="field-hint">applies to the next take</span>
          </span>
          <Picker
            label="Language"
            value={settings.language}
            options={languages}
            onChange={chooseLanguage}
          />
        </div>
      </section>

      <section aria-label="speech model">
        <h2>Speech model</h2>
        <div className="field">
          <span className="field-text">
            <span className="field-label">Model</span>
            <span className="field-hint">
              bigger hears more, but answers slower
            </span>
          </span>
          <span className="field-control">
            <Picker
              label="Model"
              value={settings.model}
              options={modelOptions.map((option) => ({
                code: option.id,
                label: option.label,
              }))}
              onChange={chooseModel}
            />
            {canDownload && chosenModel && (
              <button
                type="button"
                className="download-button"
                aria-label={`Download the speech model, ${chosenModel.size_mb} MB`}
                onClick={() => downloadModel(chosenModel.id)}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 2.5 V10 M4.6 7.2 L8 10.6 L11.4 7.2 M2.8 13 H13.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </span>
        </div>
        {modelLine && <p className="field-status">{modelLine}</p>}
        {download?.error && (
          <p role="alert" className="field-status">
            {download.error}
          </p>
        )}
      </section>

      <section aria-label="appearance">
        <h2>Appearance</h2>
        <div className="field">
          <span className="field-text">
            <span className="field-label">Theme</span>
            <span className="field-hint">
              following the system keeps up as it changes
            </span>
          </span>
          <Picker
            label="Theme"
            value={settings.theme}
            options={themes}
            onChange={chooseTheme}
          />
        </div>
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
