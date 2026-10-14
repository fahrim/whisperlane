// The pill overlay: the surface the user actually looks at while
// dictating (docs/04-experience.md). Three elements, one meaning each,
// and every state legible from here alone without opening settings.
//
// Stop delivers, cancel discards (ADR-008). The main control starts a
// take at rest and stops one while live; the cancel appears only during
// a live take, so the pill never carries a fourth element.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deliveryNote } from "./delivery";
import { LastTakeCard } from "./LastTakeCard";
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

/** Which way a panel opened out of the pill, as the core decided it. */
type Placement = "up" | "down";

/** What the pill is showing besides itself. */
type Panel = "menu" | "take" | null;

/** How long the copy confirmation stays up. */
const COPIED_MS = 1500;

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
  const [panel, setPanel] = useState<Panel>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [alignEnd, setAlignEnd] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);

  const phase: Phase = status?.phase ?? "idle";
  const isRecording = phase === "listening";
  const isProcessing = phase === "thinking";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const copiedTimer = useRef<number | null>(null);

  // The copy confirmation is on a timer; leaving it running past the end
  // of the surface would set state on a card that is no longer there.
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

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
    setPanel(null);
    setElapsedSec(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  // A new take is a new set of words, so a card the user had emptied
  // shows the new take rather than staying empty, and a copy confirmation
  // left over from the previous one is withdrawn rather than shown
  // against text that was never copied.
  const lastText = status?.last_text ?? null;
  useEffect(() => {
    setCleared(false);
    setCopied(false);
  }, [lastText]);

  /**
   * Opens or closes the panel by growing the window toward the side
   * that has room.
   *
   * The panel is measured rather than guessed at, and the window is not
   * grown until it has been measured, so a panel never appears inside a
   * window too small to hold it. Which way it opens, and which side of
   * the pill it hangs off, are both the core's answer: it is the only
   * side that knows where the taskbar is.
   */
  const resizeForPanel = useCallback(async () => {
    const element = panelRef.current;
    if (!element) {
      await invoke("set_pill_panel", { requiredHeight: 0 }).catch(() => {});
      setPlacement(null);
      return;
    }
    const placed = await invoke<{
      direction: Placement;
      align_end: boolean;
    } | null>("set_pill_panel", { requiredHeight: element.offsetHeight }).catch(
      () => null,
    );
    if (!placed) {
      setPlacement(null);
      return;
    }
    setPlacement(placed.direction);
    setAlignEnd(placed.align_end);
  }, []);

  useLayoutEffect(() => {
    void resizeForPanel();
  }, [panel, resizeForPanel]);

  // A panel whose own content changes height has to be measured again.
  // Long text, a language label, anything the user did inside it: the
  // window follows the panel rather than the other way round.
  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => void resizeForPanel());
    observer.observe(element);
    return () => observer.disconnect();
  }, [panel, resizeForPanel]);

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
      setSettings(
        await invoke<Settings>("set_language", { language: next.code }),
      );
    } catch (e) {
      setError(String(e));
    }
  }

  async function copyTake() {
    try {
      // The core answers with the take it actually copied, so the
      // confirmation is a fact rather than a hope.
      const after = await invoke<PipelineStatus>("copy_last_text");
      if (!after.last_text) return;
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, COPIED_MS);
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
    <div
      className="pill"
      data-phase={phase}
      data-panel={placement ?? undefined}
      data-align={alignEnd ? "end" : "start"}
    >
      <LiquidRefraction />

      {/* The shell carries the pill and one panel. Which end the pill
          sits on is the placement's job, so the pill lands on the same
          screen pixels whichever way the panel opens. */}
      <div className="pill-shell">
        {/* The dock hugs the pill and nothing else, so the aura is the
            pill's own light rather than the shell's: an open panel must
            not make the glow any wider than the capsule it comes from.
            It also stays under the glass, because the glass bends what
            is behind it and the thing behind it has to be ours. */}
        <div className="pill-dock">
          <div className="pill-aura" aria-hidden="true" />

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
              setPanel(null);
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
                aria-expanded={panel === "menu"}
                title="Options"
                onClick={() => setPanel((prev) => (prev === "menu" ? null : "menu"))}
              >
                <span className="pill-glyph pill-dots" />
              </button>
            )}
          </div>

          {error && <span role="alert">{error}</span>}
          </div>
        </div>

        {panel && (
          <div className="pill-panel" ref={panelRef}>
            {panel === "take" ? (
              <LastTakeCard
                text={lastText}
                languageLabel={currentLangLabel}
                onCycleLanguage={() => void cycleLanguage()}
                onCopy={() => void copyTake()}
                onClose={() => setPanel(null)}
                onClear={() => setCleared(true)}
                copied={copied}
                cleared={cleared}
              />
            ) : (
              <div className="pill-popover" role="menu" aria-label="Quick options">
                <button
                  type="button"
                  className="pill-popover-item"
                  role="menuitem"
                  onClick={() => setPanel("take")}
                >
                  <span>Last take</span>
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
                    setPanel(null);
                    void invoke("toggle_settings").catch((e) =>
                      setError(String(e)),
                    );
                  }}
                >
                  <span>Settings...</span>
                </button>
                <div className="pill-popover-divider" />
                <button
                  type="button"
                  className="pill-popover-item pill-popover-quit"
                  role="menuitem"
                  onClick={() => {
                    setPanel(null);
                    void invoke("quit_app").catch((e) => setError(String(e)));
                  }}
                >
                  <span>Quit</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}