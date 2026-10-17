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

import { useState } from "react";
import { Picker, Segmented } from "./controls";
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
    startWithWindows: (next: boolean) => void;
  };
  onDownload: () => void;
  onDone: () => void;
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
}: FirstRunProps) {
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

  function answerStartup(code: string) {
    setAnswer(code);
    change.startWithWindows(code === "yes");
  }

  return (
    <section aria-label="first run" className="first-run">
      <h1 className="first-run-instruction">
        Hold <kbd>{hotkey}</kbd>, speak, and release.
      </h1>
      <p className="first-run-hint">
        Tap it instead to keep dictating. Escape throws the take away.
      </p>

      <section aria-label="on startup">
        <h2>On startup</h2>
        <p className="field-hint">
          A dictation tool that is not running cannot be dictated to, so
          ask it to be there when you log in.
        </p>
        <Segmented
          value={answer ?? ""}
          onChange={answerStartup}
          options={[
            { code: "yes", label: "Yes, start with Windows" },
            { code: "no", label: "No, I will start it" },
          ]}
        />
        <p className="field-status">change this any time</p>
      </section>

      <section aria-label="dictation">
        <h2>Dictation</h2>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Hold to talk</span>
          </span>
          <Picker value={settings.hotkey} onChange={change.hotkey}>
            {choices.hotkeys.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </Picker>
        </label>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Microphone</span>
          </span>
          <Picker
            value={
              settings.microphone.kind === "device"
                ? (settings.microphone.id ?? "")
                : "system_default"
            }
            onChange={change.microphone}
          >
            <option value="system_default">System default</option>
            {choices.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </Picker>
        </label>
        <label className="field">
          <span className="field-text">
            <span className="field-label">Language</span>
          </span>
          <Picker value={settings.language} onChange={change.language}>
            {choices.languages.map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
          </Picker>
        </label>
      </section>

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
          <p className="first-run-model">
            {modelLine(model, download)}
            {modelMissing && (
              <button type="button" onClick={onDownload}>
                Fetch it
              </button>
            )}
          </p>
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