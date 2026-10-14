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
import type { DeliveryKind, PipelineStatus } from "./types";
import "./pill.css";

type TakeCommand = "control" | "discard";

/**
 * What the pill says about where the text went. Insertion honesty is
 * the whole point: the user must never wonder whether the words landed.
 */
function deliveryNote(delivery: DeliveryKind, detail: string | null): string {
  switch (delivery) {
    case "typed":
      return "Typed where your cursor was.";
    case "clipboard":
      return detail ?? "Could not type there — the text is on the clipboard.";
    case "partial":
      return detail ?? "Only part of the text could be inserted.";
    default:
      return "";
  }
}

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

  const live = status !== null && isLive(status.phase);
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
        aria-label={live ? "Stop and insert" : "Start dictation"}
        title={live ? "Stop and insert" : "Start dictation"}
        onClick={() => press("control")}
        onContextMenu={(e) => {
          // Right-click is the same discard as the hover cancel, so the
          // gesture stays reachable when the pointer never hovers the
          // control itself.
          e.preventDefault();
          void press("discard");
        }}
      >
        {live ? <span className="pill-glyph pill-stop" /> : <span className="pill-glyph pill-mic" />}
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