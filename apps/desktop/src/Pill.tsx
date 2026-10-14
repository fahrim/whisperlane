// The pill overlay: the surface the user actually looks at while
// dictating (docs/04-experience.md). Three elements, one meaning each,
// and every state legible from here alone without opening settings.
//
// Stop delivers, cancel discards (ADR-008). The main control starts a
// take at rest and stops one while live; the cancel appears only during
// a live take, so the pill never carries a fourth element.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deliveryNote } from "./delivery";
import { LiquidWaveform, type WaveState } from "./LiquidWaveform";
import type { MainAction, PipelineStatus } from "./types";
import "./pill.css";

type TakeCommand = "control" | "discard";

/** What the main control offers in each of the core's meanings. */
const CONTROL_LABEL: Record<MainAction, string> = {
  start: "Start dictation",
  stop: "Stop and insert",
  dismiss: "Back to quiet",
  unavailable: "Nothing to do right now",
};

/** What the control looks like in each of the core's meanings. */
const CONTROL_GLYPH: Record<MainAction, string> = {
  start: "pill-mic",
  stop: "pill-stop",
  dismiss: "pill-close",
  unavailable: "pill-mic",
};

/** Whether the pill is showing a live take, which is also when the
 *  cancel appears. One rule, read from the phase the core reports. */
function isLive(phase: PipelineStatus["phase"]): boolean {
  return phase === "listening" || phase === "thinking";
}

/** The one word the signal bar turns on, so a glance is enough. */
function signalFor(status: PipelineStatus | null): string {
  switch (status?.phase) {
    case "listening":
      return "hearing you";
    case "thinking":
      return "writing it down";
    case "done":
      return deliveryNote(status.delivery, status.detail);
    case "failed":
      return status.detail ?? "that did not work";
    case "cancelled":
      return "discarded, nothing was inserted";
    default:
      return "";
  }
}

/**
 * The optical refraction the glass is made of. Invisible, mounted once
 * per document, and named by the `--glass-backdrop` token.
 *
 * It bends what is behind the glass rather than only blurring it: a
 * soft noise field becomes a lens gradient, and the displacement map
 * bends the backdrop along it. `scale` is the strength of the bend —
 * past about ten it stops reading as glass and starts reading as a
 * wobble.
 */
function LiquidRefraction() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        <filter id="liquid-refraction" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.015"
            numOctaves={2}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation={3} result="smoothNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smoothNoise"
            scale={6}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Which face the waveform shows. The pill's own phases, reduced to the
 * three the meter knows about: nothing to show, a live voice, or a take
 * being written down.
 */
function waveStateFor(phase: PipelineStatus["phase"]): WaveState {
  switch (phase) {
    case "listening":
      return "recording";
    case "thinking":
      return "processing";
    default:
      return "idle";
  }
}

export function Pill() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    let alive = true;
    // The core publishes every phase change, so the pill follows the
    // pipeline rather than guessing from a timer.
    const unlisten = listen<PipelineStatus>("pipeline-state", (event) => {
      if (alive) setStatus(event.payload);
    });
    // Loudness comes from the capture buffer itself, throttled hard by
    // the core. It ends at zero when the take does, so the meter never
    // shows a level for audio that has stopped.
    const unlistenLevel = listen<number>("audio-level", (event) => {
      if (alive) setAudioLevel(event.payload);
    });
    invoke<PipelineStatus>("get_pipeline_state")
      .then((state) => {
        if (alive) setStatus(state);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
      void unlisten.then((off) => off());
      void unlistenLevel.then((off) => off());
    };
  }, []);

  async function press(command: TakeCommand) {
    try {
      await invoke<PipelineStatus>("take_control", { command });
    } catch (e) {
      setError(String(e));
    }
  }

  async function dismiss() {
    try {
      // A finished take goes back to a quiet idle in one action, from
      // here rather than from the settings window (ADR-007).
      await invoke<PipelineStatus>("reset_pipeline");
    } catch (e) {
      setError(String(e));
    }
  }

  const live = status !== null && isLive(status.phase);
  const action: MainAction = status?.main_action ?? "start";
  const waveState = waveStateFor(status?.phase ?? "idle");
  const signal = signalFor(status);

  return (
    <div className="pill" data-phase={status?.phase ?? "idle"}>
      <LiquidRefraction />
      {/* The light the glass is made of. Inside the document on
          purpose: a backdrop-filter can only bend DOM content, never
          the desktop behind the window. */}
      <div className="pill-aura" aria-hidden="true" />

      <div className="liquid-pill">
        {/* The waveform. Fixed size in every state so nothing shifts
            as the pill moves between faces; processing only fades it. */}
        <LiquidWaveform state={waveState} audioLevel={audioLevel} />

        {/* The written line doubles as the drag handle, so the pill can
            be moved without a setting. The controls sit outside it, so
            dragging can never swallow a click. */}
        <p
          className="pill-state"
          role="status"
          aria-live="polite"
          data-tauri-drag-region
        >
          {signal || status?.label || ""}
        </p>

        <button
          type="button"
          className="pill-control"
          aria-label={CONTROL_LABEL[action]}
          title={CONTROL_LABEL[action]}
          disabled={action === "unavailable"}
          onClick={() =>
            action === "dismiss" ? void dismiss() : void press("control")
          }
          onContextMenu={(e) => {
            // Right-click is the same discard as the hover cancel, so
            // the gesture stays reachable when the pointer never hovers
            // the control itself.
            e.preventDefault();
            void press("discard");
          }}
        >
          <span className={`pill-glyph ${CONTROL_GLYPH[action]}`} />
        </button>

        {live && (
          <button
            type="button"
            className="pill-cancel"
            aria-label="Discard this take"
            title="Discard this take (Esc)"
            onClick={() => press("discard")}
          >
            <span className="pill-glyph pill-close" />
          </button>
        )}

        <button
          type="button"
          className="pill-options"
          aria-label="Settings"
          title="Settings"
          onClick={() =>
            invoke("open_settings").catch((e) => setError(String(e)))
          }
        >
          <span className="pill-glyph pill-dots" />
        </button>

        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}