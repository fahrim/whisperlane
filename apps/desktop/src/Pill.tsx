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
import { BrandWave, type BrandWaveState } from "./BrandWave";
import { deliveryNote } from "./delivery";
import { LastTakeCard, StatusNoticeCard } from "./LastTakeCard";
import {
  GlassProbeBackdrop,
  LiquidGlassSurface,
  LiquidLensDefs,
} from "./LiquidGlassSurface";
import {
  parseBackdropPacket,
  renderLiquidGlassCanvas,
} from "./liquidGlassWebGL";
import { LiquidWaveform } from "./LiquidWaveform";
import type {
  LanguageChoice,
  MainAction,
  ModelReadiness,
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

/**
 * The refraction probe, and how it is turned on.
 *
 * The pill loads with `?glass-probe=1` in its URL — which only
 * `WHISPERLANE_GLASS_PROBE=1` produces (see the core's `pill_url`) — and
 * then draws a high-contrast pattern behind itself and runs the lens at
 * probe strength. The point is to judge the bend by eye: whether the
 * lines really curve at the glass's rim decides whether the lens ever
 * becomes part of the product. It is dev tooling, and a normal launch
 * never sees it.
 */
const GLASS_PROBE =
  new URLSearchParams(window.location.search).get("glass-probe") === "1";

/**
 * How far the pointer has to travel before a press on the pill counts as
 * taking it somewhere rather than as a click on it.
 *
 * Without a threshold every click is a one-pixel drag, and the pill's own
 * drag region sits behind the controls the user is trying to press.
 */
const DRAG_SLOP = 4;

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

/**
 * The pill's own words for a model that is on its way. The row it sits
 * beside carries the fetch; this line says what the app is doing. The
 * missing-model sentence is not here: the core carries that one.
 */
const MODEL_FETCH_LINE = "downloading the model";

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
 * Which face the brand wave shows while no take is live:
 * - "idle" (Idle): the mark is drawn once, then a slow light travels it
 * - "thinking" (Thinking): the same mark, a quicker highlight, blue glow
 * - "done" (Done): one confirming light pass and a green glow
 * - "muted" (Failed / Cancelled): dimmed and still, so the line does the talking
 *
 * Listening is not in this map: a live take keeps the coloured ribbons.
 */
function brandWaveFor(
  phase: PipelineStatus["phase"],
  readyToSpeak: boolean,
): BrandWaveState {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "done":
      return "done";
    case "failed":
    case "cancelled":
      return "muted";
    case "idle":
    case "listening":
    default:
      return readyToSpeak ? "ready" : "idle";
  }
}

export function Pill() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [popoverView, setPopoverView] = useState<"main" | "languages">("main");
  /** Where the language list goes back to: the menu it came from, or the card. */
  const [languageReturn, setLanguageReturn] = useState<"menu" | "take">("menu");
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [alignEnd, setAlignEnd] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice[]>([]);
  const [readiness, setReadiness] = useState<ModelReadiness | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const phase: Phase = status?.phase ?? "idle";
  const isRecording = phase === "listening";
  const isProcessing = phase === "thinking";
  const liveGlass = (settings?.glass ?? "live") !== "performance";
  const action: MainAction = status?.main_action ?? "start";
  const signal = signalFor(status);
  const idleReadiness = phase === "idle" ? readiness : null;
  const facePhase: Phase = idleReadiness?.downloading
    ? "thinking"
    : idleReadiness && !idleReadiness.present
      ? "failed"
      : phase;
  const faceLine = idleReadiness?.downloading
    ? MODEL_FETCH_LINE
    : (idleReadiness?.hint ?? signal);
  const isReadyWaiting =
    facePhase === "idle" && Boolean(idleReadiness?.present);
  const waveSignal = brandWaveFor(facePhase, isReadyWaiting);
  const currentLangLabel =
    settings?.language === "auto" || !settings?.language
      ? "Auto"
      : (languages.find((l) => l.code === settings.language)?.label ??
          settings.language.toUpperCase());
  const statusNoticeText = error
    ? error
    : facePhase !== "idle" && !isRecording
      ? faceLine || status?.label || ""
      : "";
  const showStatusPopup = Boolean(statusNoticeText) && !noticeDismissed;
  const activePanel: "menu" | "take" | "status" | null =
    panel ?? (showStatusPopup ? "status" : null);
  const pillBoxRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selectedLangRef = useRef<HTMLButtonElement | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const dragRef = useRef<{
    /** Where the pointer was when the drag began, in window coordinates. */
    pointer: { x: number; y: number };
    /** Whether the pointer has travelled far enough to be a drag. */
    taken: boolean;
  } | null>(null);
  const dragBusy = useRef(false);

  const blurBusyRef = useRef(false);

  const applyBackdropPacket = useCallback(
    (raw: ArrayBuffer | Uint8Array | null | undefined) => {
      const packet = parseBackdropPacket(raw);
      if (!packet) return;
      const pillEl = pillBoxRef.current;
      if (!pillEl) return;

      const pillCanvas =
        pillEl.querySelector<HTMLCanvasElement>(".lgs-desktop-canvas");
      if (pillCanvas) {
        const latestPill = pillEl.getBoundingClientRect();
        renderLiquidGlassCanvas(pillCanvas, packet, latestPill, 28);
      }

      const panelSurface = panelRef.current
        ?.firstElementChild as HTMLElement | null;
      if (panelSurface) {
        const panelCanvas =
          panelSurface.querySelector<HTMLCanvasElement>(".lgs-desktop-canvas");
        if (panelCanvas) {
          const latestPanel = panelSurface.getBoundingClientRect();
          const panelRadius = panelSurface.classList.contains("last-take-card")
            ? 22
            : 16;
          renderLiquidGlassCanvas(
            panelCanvas,
            packet,
            latestPanel,
            panelRadius,
          );
        }
      }
    },
    [],
  );

  /**
   * Synchronises the native Windows DWM blur region and the live
   * `WDA_EXCLUDEFROMCAPTURE` desktop backdrop canvas with the exact
   * rounded silhouette of the capsule (and any open panel).
   */
  const syncBlurRegion = useCallback(
    (force = false) => {
      if (blurBusyRef.current && !force) return;
      const pillEl = pillBoxRef.current;
      if (!pillEl) return;
      const pillRect = pillEl.getBoundingClientRect();
      if (pillRect.width <= 0 || pillRect.height <= 0) return;
      const panelEl = panelRef.current;
      const panelSurface = panelEl?.firstElementChild as HTMLElement | null;
      const isExiting = panelSurface?.getAttribute("data-exiting") === "true";
      const panelRect =
        activePanel && placement && panelSurface && !isExiting
          ? panelSurface.getBoundingClientRect()
          : null;
      const panelRadius =
        activePanel === "take" || activePanel === "status" ? 22 : 16;

      blurBusyRef.current = true;
      void invoke<ArrayBuffer>("set_pill_blur_region", {
        pillX: pillRect.left,
        pillY: pillRect.top,
        pillW: pillRect.width,
        pillH: pillRect.height,
        panelX: panelRect ? panelRect.left : null,
        panelY: panelRect ? panelRect.top : null,
        panelW: panelRect ? panelRect.width : null,
        panelH: panelRect ? panelRect.height : null,
        panelR: panelRect ? panelRadius : null,
        force,
        capture: liveGlass,
      })
        .then((packet) => {
          if (liveGlass) applyBackdropPacket(packet);
        })
        .catch(() => {})
        .finally(() => {
          blurBusyRef.current = false;
        });
    },
    [applyBackdropPacket, liveGlass, activePanel, placement],
  );

  /**
   * Takes the pointer's movement and lets the core move the window.
   *
   * The drag is ours rather than the platform's: `data-tauri-drag-region`
   * hands the gesture to the system, and the system measures the window
   * rather than the pill. The window is larger than the pill by its own
   * glow, so the system stops the pill short of the screen edge by an
   * amount set in padding — a wall with no visible cause.
   *
   * Nothing here reads the window's own position, and every step is
   * synchronous: reading it needs an `await`, and by the time that
   * resolves the pointer event it belongs to is spent. The core reads the
   * window and the cursor together instead, and this only says when.
   */
  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // Recorded before anything can fail: a drag that cannot capture the
    // pointer is still a drag, and the move handler is what actually
    // moves the pill.
    dragRef.current = {
      pointer: { x: event.clientX, y: event.clientY },
      taken: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture keeps the moves coming once the window starts sliding out
      // from under the pointer. Without it the drag still works, just less
      // forgivingly, so a refusal is not worth abandoning the gesture for.
    }
    void invoke("begin_pill_drag").catch(() => {});
  }

  function continueDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.taken) {
      // Below the slop this is still a click on the pill, not a grip on
      // it: the drag region sits behind the controls the user aims at.
      const movedX = Math.abs(event.clientX - drag.pointer.x);
      const movedY = Math.abs(event.clientY - drag.pointer.y);
      if (movedX < DRAG_SLOP && movedY < DRAG_SLOP) return;
      drag.taken = true;
      // An open panel belongs to where the pill was, so taking the pill
      // somewhere puts it away. The core closes it too, for the frames
      // this side has not rendered yet.
      setPanel(null);
      setNoticeDismissed(true);
    }
    // Coalesced by the round trip rather than by a frame callback: a
    // window that never takes focus does not get animation frames, so a
    // `requestAnimationFrame` throttle here would simply never fire and
    // the drag would never move anything. One move in flight is also the
    // most the window manager can use, and it keeps the last request the
    // newest one instead of replaying stale positions after the hand has
    // stopped.
    if (dragBusy.current) return;
    dragBusy.current = true;
    const pillRect = liveGlass
      ? pillBoxRef.current?.getBoundingClientRect()
      : null;
    void invoke<ArrayBuffer>("continue_pill_drag", {
      pillX: pillRect ? pillRect.left : null,
      pillY: pillRect ? pillRect.top : null,
      pillW: pillRect ? pillRect.width : null,
      pillH: pillRect ? pillRect.height : null,
    })
      .then((packet) => {
        if (liveGlass) applyBackdropPacket(packet);
      })
      .catch(() => {})
      .finally(() => {
        dragBusy.current = false;
      });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Releasing a capture that is already gone is not a failure.
    }
    void invoke("end_pill_drag")
      .then(() => {
        syncBlurRegion(true);
      })
      .catch(() => {});
  }

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
    const unlistenSettings = listen<Settings>("settings-changed", (event) => {
      if (alive) setSettings(event.payload);
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
      void unlistenSettings.then((off) => off());
    };
  }, []);

  // The pill says ready, and only the model can make that true. The
  // rest of the state arrives as phase events, but a fetch is not a
  // phase: it can start or finish in another window while nothing here
  // moves, so the answer is read on the settings window's own rhythm.
  // A read that fails leaves the last answer standing — the line already
  // reports what is known, and a second alert under the capsule would be
  // noise rather than news.
  useEffect(() => {
    let alive = true;
    async function pollReadiness() {
      try {
        const next = await invoke<ModelReadiness>("get_model_readiness");
        if (alive) setReadiness(next);
      } catch {
        // Keep the last answer: see the comment above.
      }
    }
    void pollReadiness();
    const timer = window.setInterval(pollReadiness, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
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

  useEffect(() => {
    setNoticeDismissed(false);
  }, [facePhase, faceLine, status?.detail, error]);

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
  }, [activePanel, statusNoticeText, resizeForPanel]);

  useLayoutEffect(() => {
    syncBlurRegion(true);
  }, [syncBlurRegion, status?.phase, status?.detail, alignEnd]);

  // Keep the DWM blur region locked to the capsule and panel whenever
  // either resizes (including during the capsule's width spring transition).
  useEffect(() => {
    const pillEl = pillBoxRef.current;
    const panelEl = panelRef.current;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      syncBlurRegion(true);
      if (panelEl) void resizeForPanel();
    });
    if (pillEl) observer.observe(pillEl);
    if (panelEl) observer.observe(panelEl);
    return () => observer.disconnect();
  }, [activePanel, statusNoticeText, resizeForPanel, syncBlurRegion]);

  // Continuously sample the live desktop behind the pill while visible so
  // switching windows (Alt+Tab), moving other windows underneath the pill,
  // or scrolling behind it adapts the glass backdrop in real time.
  //
  // Driven by `requestAnimationFrame` rather than a fixed interval: sampling
  // is aligned with the display's refresh (60/120/144 Hz), stops on its own
  // when the webview is hidden or occluded, and `blurBusyRef` provides
  // backpressure — a frame whose capture is still in flight is skipped, so a
  // slow machine degrades its sample rate instead of queueing IPC calls.
  // Unchanged frames are deduplicated by hash in Rust and cost no upload.
  useEffect(() => {
    if (!liveGlass) return;
    let frame = 0;
    const tick = () => {
      syncBlurRegion(false);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [liveGlass, syncBlurRegion]);

  async function press(command: TakeCommand) {
    try {
      await invoke<PipelineStatus>("take_control", { command });
    } catch (e) {
      setError(String(e));
    }
  }

  /**
   * Opens the language list, remembering the surface it was opened from.
   *
   * The list belongs to the popover, not to the card's language chip, so
   * it takes the popover's place and hands the user back to whichever
   * surface asked for it.
   */
  function openLanguageList(returnTo: "menu" | "take") {
    setLanguageReturn(returnTo);
    setPanel("menu");
    setPopoverView("languages");
  }

  function closeLanguageList() {
    setPopoverView("main");
    if (languageReturn === "take") setPanel("take");
    setLanguageReturn("menu");
  }

  async function selectLanguage(code: string) {
    try {
      setSettings(
        await invoke<Settings>("set_language", { language: code }),
      );
      closeLanguageList();
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (popoverView === "languages" && selectedLangRef.current) {
      selectedLangRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [popoverView]);

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

  return (
    <div
      className="pill"
      data-phase={facePhase}
      data-panel={placement ?? undefined}
      data-align={alignEnd ? "end" : "start"}
      data-glass={liveGlass ? "live" : "performance"}
      data-glass-probe={GLASS_PROBE ? "" : undefined}
    >
      <LiquidRefraction />
      <LiquidLensDefs />

      {/* The probe's pattern sits under everything, so the glass and the
          lens both read it: straight lines outside the pill, and — if
          the refraction works — bent ones inside it. */}
      {GLASS_PROBE && <GlassProbeBackdrop />}

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

          <div className="liquid-pill" ref={pillBoxRef}>
            {/* The glass the content sits on: nine optical layers, cut
                to the capsule. */}
            <LiquidGlassSurface geometry="capsule" />

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
            <LiquidGlassSurface geometry="orb" />
            <OrbIcon phase={facePhase} />
          </button>

          {/* 2. CENTER — Live Waveform / Brand Wave. A live take keeps the
              coloured ribbons; the resting face is the drawn wave alone,
              with no status word. Other faces keep their written line. The
              center doubles as the grip: pressing it and moving takes the
              pill somewhere, while a press that never moves is left alone
              so it stays a click. */}
          <div
            className="pill-center"
            onPointerDown={beginDrag}
            onPointerMove={continueDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {isRecording ? (
              <LiquidWaveform audioLevel={audioLevel} width={165} height={44} />
            ) : (
              <div className="pill-status-row">
                <BrandWave state={waveSignal} />
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

            {!isRecording && (
              <button
                type="button"
                className="pill-options"
                aria-label="More options"
                disabled={isProcessing}
                aria-expanded={panel === "menu"}
                title="Options"
                onClick={() => {
                  setLanguageReturn("menu");
                  setPopoverView("main");
                  setPanel((prev) => (prev === "menu" ? null : "menu"));
                }}
              >
                <span className="pill-glyph pill-dots" />
              </button>
            )}
          </div>

          </div>

          {/* The panel anchors against the dock, out of flow: it can
              neither push the pill nor wait on a reflow. Which way it
              opens was decided by the core before this element existed. */}
          {activePanel && (
            <div className="pill-panel" ref={panelRef}>
              {activePanel === "take" ? (
                <LastTakeCard
                  text={lastText}
                  languageLabel={currentLangLabel}
                  onChooseLanguage={() => openLanguageList("take")}
                  onCopy={() => void copyTake()}
                  onClose={() => setPanel(null)}
                  onClear={() => setCleared(true)}
                  copied={copied}
                  cleared={cleared}
                />
              ) : activePanel === "status" ? (
                <StatusNoticeCard
                  phase={facePhase}
                  text={statusNoticeText}
                  isError={Boolean(error)}
                  isDownloadingModel={Boolean(idleReadiness?.downloading)}
                  hasLastTake={Boolean(lastText)}
                  onOpenLastTake={() => setPanel("take")}
                  onClose={() => {
                    setNoticeDismissed(true);
                    if (error) setError(null);
                  }}
                />
              ) : (
                <div className="pill-popover" role="menu" aria-label="Quick options">
                  <LiquidGlassSurface geometry="panel" />
                  {popoverView === "languages" ? (
                    <>
                      <div className="pill-popover-header">
                        <button
                          type="button"
                          className="pill-popover-back"
                          onClick={closeLanguageList}
                          title="Back"
                          aria-label="Back"
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="15 18 9 12 15 6" />
                          </svg>
                          <span>Languages</span>
                        </button>
                      </div>
                      <div className="pill-popover-divider" />
                      <div className="pill-popover-list" role="menu">
                        {languages.map((l) => {
                          const isSelected = (settings?.language ?? "auto") === l.code;
                          return (
                            <button
                              key={l.code}
                              ref={isSelected ? selectedLangRef : null}
                              type="button"
                              className={`pill-popover-item ${isSelected ? "pill-popover-item-selected" : ""}`}
                              role="menuitemradio"
                              aria-checked={isSelected}
                              onClick={() => void selectLanguage(l.code)}
                            >
                              <span>{l.label}</span>
                              {isSelected && (
                                <svg
                                  className="pill-popover-check"
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
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
                        onClick={() => openLanguageList("menu")}
                      >
                        <span>Language</span>
                        <span className="pill-popover-value-group">
                          <span className="pill-popover-badge">{currentLangLabel}</span>
                          <svg
                            className="pill-popover-chevron"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                      </button>
                      <div className="pill-popover-divider" />
                      <div className="pill-popover-footer" role="group" aria-label="App actions">
                        <button
                          type="button"
                          className="pill-popover-action"
                          role="menuitem"
                          aria-label="Settings"
                          title="Settings"
                          onClick={() => {
                            setPanel(null);
                            void invoke("toggle_settings").catch((e) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="pill-popover-action"
                          role="menuitem"
                          aria-label="Minimize"
                          title="Minimize to tray"
                          onClick={() => {
                            setPanel(null);
                            void invoke("minimize_pill").catch((e) =>
                              setError(String(e)),
                            );
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="pill-popover-action pill-popover-action-quit"
                          role="menuitem"
                          aria-label="Quit"
                          title="Quit whisperlane"
                          onClick={() => {
                            setPanel(null);
                            void invoke("quit_app").catch((e) => setError(String(e)));
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}