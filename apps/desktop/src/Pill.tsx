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

export function Pill() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // The core publishes every phase change, so the pill follows the
    // pipeline rather than guessing from a timer.
    const unlisten = listen<PipelineStatus>("pipeline-state", (event) => {
      if (alive) setStatus(event.payload);
    });
    invoke<PipelineStatus>("get_pipeline_state")
      .then((state) => {
        if (alive) setStatus(state);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
      void unlisten.then((off) => off());
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
  const signal = signalFor(status);

  return (
    <div className="pill" data-phase={status?.phase ?? "idle"}>
      <div className="pill-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <p className="pill-state" role="status" aria-live="polite">
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
          // Right-click is the same discard as the hover cancel, so the
          // gesture stays reachable when the pointer never hovers the
          // control itself.
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
  );
}