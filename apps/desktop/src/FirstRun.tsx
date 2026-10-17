// First run is one screen and one time (docs/04-experience.md).
//
// It was built as an introduction: a sentence, some honest progress, and a
// button. That left the questions to a settings window the user had not
// been told existed. This is the other choice — the same screen, in the
// settings window's own language, holding only the answers that cannot be
// assumed. It is still one screen and still no wizard.
//
// One answer is mandatory. Whether whisperlane starts with Windows is not
// a default worth shipping, because the chord is the whole product and a
// dictation tool that is not running cannot be dictated to; a switch left
// at "off" would be an answer nobody gave. So it is asked as two choices,
// and the screen is not finished until one of them has been taken.

import { useRef, useState } from "react";
import { Picker, Segmented } from "./controls";
import lockupDark from "./assets/whisperlane-lockup-horizontal-on-dark.png";
import lockupLight from "./assets/whisperlane-lockup-horizontal-on-light.png";
import type {
  Download,
  HotkeyChoice,
  InputDevice,
  LanguageChoice,
  ModelOption,
  PipelineStatus,
  Settings,
} from "./types";

export interface FirstRunProps {
  settings: Settings;
  hotkey: string;
  status: PipelineStatus | null;
  download: Download | null;
  model: ModelOption | null;
  /** What the settings window offers, so both screens answer alike. */
  choices: {
    hotkeys: HotkeyChoice[];
    languages: LanguageChoice[];
    devices: InputDevice[];
    startWithWindows: boolean;
  };
  change: {
    hotkey: (code: string) => void;
    language: (code: string) => void;
    microphone: (value: string) => void;
    startWithWindows: (next: boolean) => Promise<boolean>;
  };
  onDownload: () => void;
  onDone: () => void;
  onClose?: () => void;
  isLight?: boolean;
  micTesting?: boolean;
  audioLevel?: number;
  onToggleMicTest?: () => void;
}

const LEVEL_BAR_COUNT = 16;
const RESTING_BARS = 10;

function hotkeyKeycaps(code: string, fallbackLabel: string): string[] {
  if (code === "ctrl_shift_space") return ["Control", "Shift", "Space"];
  if (code === "ctrl_space") return ["Control", "Space"];
  if (code === "ctrl_y") return ["Control", "Y"];
  const cleaned = fallbackLabel.replace(/\s*\(.*\)$/, "").trim();
  if (!cleaned || cleaned === "…") return ["Control", "Shift", "Space"];
  return cleaned.split(/\s*\+\s*/).filter(Boolean);
}

function modelLine(
  model: ModelOption | null,
  download: Download | null,
): string {
  if (download?.running) {
    const size = `${download.received_mb} / ${download.total_mb} MB`;
    const percent =
      download.percent !== null ? ` ${download.percent}%` : "";
    return `Fetching the speech model · ${size}${percent}`;
  }
  if (download?.error) return `The model download failed: ${download.error}`;
  if (!model) return "";
  if (model.present) return `The speech model is ready · ${model.size_mb} MB`;
  return `The speech model is not here yet · ${model.size_mb} MB`;
}

export function FirstRun({
  settings,
  hotkey,
  status,
  download,
  model,
  choices,
  change,
  onDownload,
  onDone,
  onClose,
  isLight = false,
  micTesting = false,
  audioLevel = 0,
  onToggleMicTest,
}: FirstRunProps) {
  const hotkeyButtonRef = useRef<HTMLButtonElement | null>(null);
  const phase = status?.phase ?? "idle";
  // Said only when something is happening. A line reporting "ready" in
  // place of an instruction is a line the user reads past, and this screen
  // has one instruction on it.
  const live =
    phase === "listening" || phase === "thinking" || phase === "failed";
  const modelMissing = model !== null && !model.present && !download?.running;
  // Already on means already answered — someone who has it registered from
  // a previous install is not asked again. Everyone else has to choose,
  // because there is no honest default for a chord that only works if the
  // program is running. Nothing chosen yet is null, which is what the
  // button below is gated on.
  const [answer, setAnswer] = useState<string | null>(
    choices.startWithWindows ? "yes" : null,
  );

  const keycaps = hotkeyKeycaps(settings.hotkey, hotkey);
  const liveListening = phase === "listening" || micTesting;
  const activeBars = liveListening
    ? Math.max(2, Math.min(LEVEL_BAR_COUNT, Math.round(audioLevel * LEVEL_BAR_COUNT)))
    : RESTING_BARS;

  // The answer is only taken once the system has taken it too. Marking it
  // chosen first would leave the screen saying yes over a registration
  // that was refused — a question that reports an answer nobody gave.
  function answerStartup(code: string) {
    void change.startWithWindows(code === "yes").then((took) => {
      setAnswer(took ? code : null);
    });
  }

  return (
    <section aria-label="first run" className="first-run">
      <header className="first-run-topbar" data-tauri-drag-region="deep">
        <div className="first-run-brand">
          <img
            src={isLight ? lockupLight : lockupDark}
            alt="whisperlane"
            className="brand-lockup-img"
            draggable={false}
          />
          <span className="first-run-badge">Welcome Setup</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="title-bar-close settings-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M1 1 L9 9 M9 1 L1 9"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </header>

      <div className="first-run-hero">
        <h1 className="first-run-instruction">
          <span>Hold</span>
          <span className="hotkey-caps first-run-hero-caps">
            {keycaps.map((cap, idx) => (
              <span key={cap} className="hotkey-cap-group">
                {idx > 0 && <span className="hotkey-plus">+</span>}
                <kbd className="hotkey-cap">{cap}</kbd>
              </span>
            ))}
          </span>
          <span>, speak, and release.</span>
        </h1>
        <p className="first-run-hint">
          Tap it instead to keep dictating. Escape throws the take away.
        </p>
      </div>

      <div className="settings-cards first-run-cards">
        <section
          aria-label="on startup"
          className="settings-card first-run-startup-card"
        >
          <div className="settings-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3v9M17.66 6.34a8 8 0 1 1-11.32 0"
                stroke="currentColor"
                strokeWidth="1.85"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="settings-card-body">
            <div className="first-run-card-head">
              <h2 className="settings-card-title">On startup</h2>
              {answer === null && (
                <span className="first-run-required-pill">Choose one</span>
              )}
            </div>
            <p className="settings-card-desc">
              A dictation tool that is not running cannot be dictated to, so
              ask it to be there when you log in.
            </p>
            <div className="first-run-segmented-wrap">
              <Segmented
                value={answer ?? ""}
                onChange={answerStartup}
                options={[
                  { code: "yes", label: "Yes, start with Windows" },
                  { code: "no", label: "No, I will start it" },
                ]}
              />
            </div>
            <p className="settings-card-note">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
              </svg>
              <span>You can change this any time in Settings.</span>
            </p>
          </div>
        </section>

        <section aria-label="dictation" className="first-run-dictation-group">
          <div className="settings-card">
            <div className="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.75" />
                <circle cx="6.5" cy="9.5" r="1" fill="currentColor" />
                <circle cx="10.2" cy="9.5" r="1" fill="currentColor" />
                <circle cx="13.8" cy="9.5" r="1" fill="currentColor" />
                <circle cx="17.5" cy="9.5" r="1" fill="currentColor" />
                <circle cx="6.5" cy="13" r="1" fill="currentColor" />
                <circle cx="17.5" cy="13" r="1" fill="currentColor" />
                <path d="M8.5 15h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </div>
            <div className="settings-card-body">
              <h2 className="settings-card-title">Hold to talk</h2>
              <p className="settings-card-desc">
                Press and hold this shortcut to talk, or tap to toggle.
              </p>
              <div className="settings-card-controls">
                <Picker
                  label="Hold to talk"
                  value={settings.hotkey}
                  options={choices.hotkeys}
                  onChange={change.hotkey}
                  buttonRef={hotkeyButtonRef}
                  renderValue={() => (
                    <span className="hotkey-caps">
                      {keycaps.map((cap, idx) => (
                        <span key={cap} className="hotkey-cap-group">
                          {idx > 0 && <span className="hotkey-plus">+</span>}
                          <kbd className="hotkey-cap">{cap}</kbd>
                        </span>
                      ))}
                    </span>
                  )}
                />
                <button
                  type="button"
                  className="card-action-btn"
                  onClick={() => hotkeyButtonRef.current?.click()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M16.862 3.487a2.1 2.1 0 1 1 2.97 2.97L7.5 18.79 3 20l1.21-4.5L16.862 3.487Z"
                      stroke="currentColor"
                      strokeWidth="1.85"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Change</span>
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
                <path
                  d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="settings-card-body">
              <h2 className="settings-card-title">Microphone</h2>
              <p className="settings-card-desc">
                Choose the microphone you want to use.
              </p>
              <div className="settings-card-controls">
                <Picker
                  label="Microphone"
                  leadingIcon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
                      <path
                        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  }
                  value={
                    settings.microphone.kind === "device"
                      ? (settings.microphone.id ?? "")
                      : "system_default"
                  }
                  options={[
                    { code: "system_default", label: "System default" },
                    ...choices.devices.map((device) => ({
                      code: device.id,
                      label: device.label,
                    })),
                  ]}
                  onChange={change.microphone}
                />
                {onToggleMicTest && (
                  <button
                    type="button"
                    className={`card-action-btn test-mic-btn${micTesting ? " is-testing" : ""}`}
                    onClick={onToggleMicTest}
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="1.5" y="5.5" width="1.8" height="5" rx="0.9" fill="#818CF8" />
                      <rect x="4.5" y="3" width="1.8" height="10" rx="0.9" fill="#A855F7" />
                      <rect x="7.5" y="1.5" width="1.8" height="13" rx="0.9" fill="#C084FC" />
                      <rect x="10.5" y="3.5" width="1.8" height="9" rx="0.9" fill="#818CF8" />
                      <rect x="13.5" y="5.5" width="1.8" height="5" rx="0.9" fill="#60A5FA" />
                    </svg>
                    <span>{micTesting ? "Stop Test" : "Test Mic"}</span>
                  </button>
                )}
              </div>
              <div className="mic-meter-row">
                <div className="mic-level-bars" aria-hidden="true">
                  {Array.from({ length: LEVEL_BAR_COUNT }, (_, idx) => (
                    <span
                      key={idx}
                      className={`mic-level-bar${idx < activeBars ? " is-lit" : ""}`}
                    />
                  ))}
                </div>
                <span className="mic-meter-hint">
                  Speak to see the input level.
                </span>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                <ellipse cx="12" cy="12" rx="4.2" ry="9" stroke="currentColor" strokeWidth="1.65" />
                <path d="M3.5 9.5h17M3.5 14.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <div className="settings-card-body">
              <h2 className="settings-card-title">Language</h2>
              <p className="settings-card-desc">
                The language to transcribe.
              </p>
              <div className="settings-card-controls">
                <Picker
                  label="Language"
                  leadingIcon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                      <ellipse cx="12" cy="12" rx="4.2" ry="9" stroke="currentColor" strokeWidth="1.65" />
                      <path d="M3.5 9.5h17M3.5 14.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  }
                  value={settings.language}
                  options={choices.languages}
                  onChange={change.language}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="first-run-foot">
        {live && (
          <p className="first-run-state" role="status" aria-live="polite">
            {status?.label}
            {status?.detail ? ` — ${status.detail}` : ""}
          </p>
        )}
        {status?.last_text && (
          <p className="first-run-transcript">{status.last_text}</p>
        )}

        {modelLine(model, download) && (
          <div className="first-run-model-row">
            <span className="first-run-model-dot" aria-hidden="true" />
            <p className="first-run-model">
              <span>{modelLine(model, download)}</span>
              {modelMissing && (
                <button
                  type="button"
                  className="card-action-btn"
                  onClick={onDownload}
                >
                  Fetch it
                </button>
              )}
            </p>
          </div>
        )}

        <button
          type="button"
          className="first-run-done"
          disabled={answer === null}
          onClick={onDone}
        >
          Start talking
        </button>
        <p className="first-run-footnote">
          whisperlane stays in the tray. Right-click its icon for Settings.
        </p>
      </div>
    </section>
  );
}