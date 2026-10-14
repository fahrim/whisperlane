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
import type {
  LanguageChoice,
  MainAction,
  Phase,
  PipelineStatus,
  Settings,
} from "./types";
import "./pill.css";

type TakeCommand = "control" | "discard";

/** What the main control offers in each of the core's meanings. */
const CONTROL_LABEL: Record<MainAction, string> = {
  start: "Start recording",
  stop: "Stop and insert",
  dismiss: "Start recording",
  unavailable: "Processing...",
};

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
    case "idle":
    default:
      return "Ready";
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * The primary orb icon: microphone at rest and after a take, square stop
 * while recording, and a clean symmetric sparkle/spinner while processing.
 */
function OrbIcon({ phase }: { phase: Phase }) {
  if (phase === "listening") {
    return (
      <svg
        className="pill-orb-svg"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
      </svg>
    );
  }

  if (phase === "thinking") {
    return (
      <svg
        className="pill-orb-svg pill-orb-spinner"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 2.5C12.4 7.2 16.8 11.6 21.5 12C16.8 12.4 12.4 16.8 12 21.5C11.6 16.8 7.2 12.4 2.5 12C7.2 11.6 11.6 7.2 12 2.5Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      className="pill-orb-svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 18v3M9 21h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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
 * Which face the waveform / equalizer shows:
 * - "recording" (Listening): full colored Siri ribbons
 * - "processing" (Thinking): white equalizer with left-to-right scanner wave
 * - "muted" (Failed / Cancelled): white equalizer with right-middle bars (11 & 14)
 * - "idle" (Idle / Done): white equalizer with left-start bars (3 & 4)
 */
function waveStateFor(phase: PipelineStatus["phase"]): WaveState {
  switch (phase) {
    case "listening":
      return "recording";
    case "thinking":
      return "processing";
    case "failed":
    case "cancelled":
      return "muted";
    case "idle":
    case "done":
    default:
      return "idle";
  }
}

export function Pill() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveTranscriptOpen, setLiveTranscriptOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);

  const phase: Phase = status?.phase ?? "idle";
  const isRecording = phase === "listening";
  const isProcessing = phase === "thinking";

  useEffect(() => {
    let alive = true;
    const unlisten = listen<PipelineStatus>("pipeline-state", (event) => {
      if (alive) setStatus(event.payload);
    });
    const unlistenLevel = listen<number>("audio-level", (event) => {
      if (alive) setAudioLevel(event.payload);
    });
    invoke<PipelineStatus>("get_pipeline_state")
      .then((state) => {
        if (alive) setStatus(state);
      })
      .catch((e) => setError(String(e)));
    invoke<Settings>("get_settings")
      .then((s) => {
        if (alive) setSettings(s);
      })
      .catch(() => {});
    invoke<LanguageChoice[]>("list_languages")
      .then((langs) => {
        if (alive) setLanguages(langs);
      })
      .catch(() => {});
    return () => {
      alive = false;
      void unlisten.then((off) => off());
      void unlistenLevel.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      setElapsedSec(0);
      return;
    }
    setMenuOpen(false);
    setElapsedSec(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    void invoke("set_popover_open", { open: menuOpen || liveTranscriptOpen }).catch(() => {});
  }, [menuOpen, liveTranscriptOpen]);

  async function press(command: TakeCommand) {
    try {
      await invoke<PipelineStatus>("take_control", { command });
    } catch (e) {
      setError(String(e));
    }
  }

  async function cycleLanguage() {
    if (languages.length === 0) return;
    const currentIdx = languages.findIndex((l) => l.code === settings?.language);
    const next = languages[(currentIdx + 1) % languages.length];
    try {
      const updated = await invoke<Settings>("set_language", {
        language: next.code,
      });
      setSettings(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  const action: MainAction = status?.main_action ?? "start";
  const waveState = waveStateFor(phase);
  const signal = signalFor(status);
  const currentLangLabel =
    settings?.language === "auto" || !settings?.language
      ? "Auto"
      : (languages.find((l) => l.code === settings.language)?.label ??
          settings.language.toUpperCase());

  return (
    <div className="pill" data-phase={phase}>
      <LiquidRefraction />

      {/* Dynamic wrapper: binds the neon glow spheres and popover directly
          to the pill's own dynamic width so the glow never detaches or
          spills far outside the capsule. */}
      <div className="pill-shell">
        <div className="pill-aura" aria-hidden="true" />

        {liveTranscriptOpen && status?.last_text && (
          <div className="pill-transcript-card" role="region" aria-label="Live Transcript">
            <span className="pill-transcript-text">{status.last_text}</span>
          </div>
        )}

        {menuOpen && !isRecording && !isProcessing && (
          <div className="pill-popover" role="menu" aria-label="Quick Options">
            <button
              type="button"
              className="pill-popover-item"
              role="menuitem"
              onClick={() => {
                setLiveTranscriptOpen((v) => !v);
                setMenuOpen(false);
              }}
            >
              <span>Live Transcript</span>
              <span className="pill-popover-badge">
                {liveTranscriptOpen ? "On" : "Off"}
              </span>
            </button>
            <button
              type="button"
              className="pill-popover-item"
              role="menuitem"
              onClick={() => void cycleLanguage()}
            >
              <span>Language</span>
              <span className="pill-popover-badge">{currentLangLabel}</span>
            </button>
            <button
              type="button"
              className="pill-popover-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void invoke("toggle_settings").catch((e) => setError(String(e)));
              }}
            >
              <span>Settings...</span>
            </button>
            {phase !== "idle" && (
              <>
                <button
                  type="button"
                  className="pill-popover-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void invoke<PipelineStatus>("reset_pipeline").catch((e) =>
                      setError(String(e)),
                    );
                  }}
                >
                  <span>Settle to quiet</span>
                </button>
                <div className="pill-popover-divider" />
              </>
            )}
            <button
              type="button"
              className="pill-popover-item pill-popover-quit"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void invoke("quit_app").catch((e) => setError(String(e)));
              }}
            >
              <span>Quit</span>
            </button>
          </div>
        )}

        <div className="liquid-pill">
          {/* 1. LEFT — Primary Orb Button (40px x 40px)
              Always starts a new recording from Idle/Done/Failed/Cancelled,
              and stops+delivers while Recording. Never quits the app. */}
          <button
            type="button"
            className="pill-control"
            aria-label={CONTROL_LABEL[action]}
            title={CONTROL_LABEL[action]}
            disabled={action === "unavailable"}
            onClick={() => {
              setMenuOpen(false);
              void press("control");
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              void press("discard");
            }}
          >
            <OrbIcon phase={phase} />
          </button>

          {/* 2. CENTER — Waveform / State-Aware White Equalizer + Status Text */}
          <div className="pill-center" data-tauri-drag-region>
            {isRecording ? (
              <LiquidWaveform
                state="recording"
                audioLevel={audioLevel}
                width={165}
                height={44}
              />
            ) : (
              <div className="pill-status-row" data-tauri-drag-region>
                <LiquidWaveform
                  state={waveState}
                  audioLevel={0}
                  width={90}
                  height={22}
                />
                <p
                  className="pill-state"
                  role="status"
                  aria-live="polite"
                  data-tauri-drag-region
                >
                  {signal || status?.label || ""}
                </p>
              </div>
            )}
          </div>

          {/* 3. RIGHT — Secondary Controls (Timer, Cancel, Popover Trigger) */}
          <div className="pill-actions">
            {isRecording && (
              <>
                <span className="pill-timer" aria-label="Recording duration">
                  {formatDuration(elapsedSec)}
                </span>
                <button
                  type="button"
                  className="pill-cancel"
                  aria-label="Discard this take"
                  title="Discard this take (Esc)"
                  onClick={() => void press("discard")}
                >
                  <span className="pill-glyph pill-close" />
                </button>
              </>
            )}

            {!isRecording && !isProcessing && (
              <button
                type="button"
                className="pill-options"
                aria-label="More options"
                aria-expanded={menuOpen}
                title="Options"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                <span className="pill-glyph pill-dots" />
              </button>
            )}
          </div>

          {error && <span role="alert">{error}</span>}
        </div>
      </div>
    </div>
  );
}