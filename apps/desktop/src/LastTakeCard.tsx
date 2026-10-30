// The card that shows what the last finished take said, and the companion
// status popup card that displays pill notifications outside the capsule.
//
// Both cards share the exact same LiquidGlassSurface(geometry="panel")
// material, header bar, and left-accented body typography so status notices
// and transcript cards belong to one optical family while keeping the pill
// capsule itself completely free of text.

import { useEffect, useRef, useState } from "react";
import { LiquidGlassSurface } from "./LiquidGlassSurface";
import type { Phase } from "./types";

const STATUS_AUTO_DISMISS_MS = 5000;
const SWIPE_DISMISS_DISTANCE_PX = 54;
const SWIPE_DISMISS_VELOCITY_PX_PER_MS = 0.42;
const EXIT_ANIMATION_MS = 210;

/** The document mark, at the size the header reads at. */
function TextIcon() {
  return (
    <svg
      className="card-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M9 13h6M9 17h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className="card-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      className="card-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="card-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m5 13 4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusPhaseIcon({ phase }: { phase: Phase }) {
  if (phase === "done") {
    return <CheckIcon />;
  }
  if (phase === "thinking") {
    return (
      <svg
        className="card-icon pill-orb-spinner"
        width="14"
        height="14"
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
      className="card-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 8v4.5M12 16h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function statusHeaderTitle(
  phase: Phase,
  isError: boolean,
  isDownloadingModel: boolean,
): string {
  if (isError || phase === "failed") return "Notice";
  if (isDownloadingModel) return "Model";
  switch (phase) {
    case "thinking":
      return "Processing";
    case "done":
      return "Delivered";
    case "cancelled":
      return "Discarded";
    default:
      return "Status";
  }
}

export interface StatusNoticeCardProps {
  phase: Phase;
  text: string;
  isError?: boolean;
  isDownloadingModel?: boolean;
  hasLastTake?: boolean;
  onOpenLastTake?: () => void;
  onClose: () => void;
}

export function StatusNoticeCard({
  phase,
  text,
  isError = false,
  isDownloadingModel = false,
  hasLastTake = false,
  onOpenLastTake,
  onClose,
}: StatusNoticeCardProps) {
  const effectivePhase: Phase = isError ? "failed" : phase;
  const title = statusHeaderTitle(effectivePhase, isError, isDownloadingModel);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [exitMode, setExitMode] = useState<"left" | "right" | "auto" | null>(
    null,
  );

  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startTime: number;
  } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset swipe & exit state whenever the status message or phase changes
  useEffect(() => {
    setDragX(0);
    setIsDragging(false);
    setExitMode(null);
    gestureRef.current = null;
  }, [effectivePhase, text]);

  // Auto-dismiss after 5 seconds (paused while actively dragging)
  useEffect(() => {
    if (isDragging || exitMode !== null) return;
    const timer = window.setTimeout(() => {
      setExitMode("auto");
    }, STATUS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [effectivePhase, text, isDragging, exitMode]);

  // Complete dismissal after exit animation finishes
  useEffect(() => {
    if (exitMode === null) return;
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, EXIT_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [exitMode]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || exitMode !== null) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startTime: performance.now(),
    };
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture errors
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const g = gestureRef.current;
    if (!g || event.pointerId !== g.pointerId || exitMode !== null) return;
    const dx = event.clientX - g.startX;
    setDragX(dx);
  }

  function finishSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const g = gestureRef.current;
    if (!g || event.pointerId !== g.pointerId) return;
    gestureRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    const dx = event.clientX - g.startX;
    const dt = Math.max(16, performance.now() - g.startTime);
    const vx = dx / dt;

    setIsDragging(false);
    if (
      Math.abs(dx) >= SWIPE_DISMISS_DISTANCE_PX ||
      Math.abs(vx) >= SWIPE_DISMISS_VELOCITY_PX_PER_MS
    ) {
      setExitMode(dx >= 0 ? "right" : "left");
    } else {
      setDragX(0);
    }
  }

  const swipeStyle: React.CSSProperties | undefined =
    exitMode === "left"
      ? {
          transform: "translate3d(-310px, 0, 0)",
          opacity: 0,
        }
      : exitMode === "right"
        ? {
            transform: "translate3d(310px, 0, 0)",
            opacity: 0,
          }
        : exitMode === "auto"
          ? {
              transform: "translate3d(0, -6px, 0) scale(0.96)",
              opacity: 0,
            }
          : isDragging || dragX !== 0
            ? {
                transform: `translate3d(${dragX}px, 0, 0)`,
                opacity: Math.max(0.15, 1 - Math.abs(dragX) / 210),
                transition: isDragging ? "none" : undefined,
              }
            : undefined;

  return (
    <div
      className={`last-take-card pill-status-card${
        isDragging ? " is-swiping" : ""
      }${exitMode ? " is-exiting" : ""}`}
      data-status-phase={effectivePhase}
      data-exiting={exitMode ? "true" : undefined}
      role={effectivePhase === "failed" ? "alert" : "status"}
      aria-live="polite"
      style={swipeStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
    >
      <LiquidGlassSurface geometry="panel" />
      <div className="card-header">
        <div className="card-header-left">
          <StatusPhaseIcon phase={effectivePhase} />
          <span className="card-title">{title}</span>
        </div>
        <div className="card-header-right">
          {effectivePhase === "done" && hasLastTake && onOpenLastTake && (
            <button
              type="button"
              className="card-language"
              onClick={onOpenLastTake}
              title="Open Last Take"
            >
              Last Take
            </button>
          )}
          <button
            type="button"
            className="card-icon-button"
            aria-label="Close notification"
            title="Close"
            onClick={onClose}
          >
            <span className="pill-glyph pill-close" />
          </button>
        </div>
      </div>

      <div className="card-body">
        <p className="card-text">{text}</p>
      </div>
    </div>
  );
}

interface LastTakeCardProps {
  /** The last finished take's words, or nothing yet. */
  text: string | null;
  /** The language the next take will use, as the settings surface names it. */
  languageLabel: string;
  onChooseLanguage: () => void;
  onCopy: () => void;
  onClose: () => void;
  /** Clears what the card shows, without touching the stored take. */
  onClear: () => void;
  /** Whether the last copy actually copied something. */
  copied: boolean;
  /** Whether the user has cleared what is shown. */
  cleared: boolean;
}

export function LastTakeCard({
  text,
  languageLabel,
  onChooseLanguage,
  onCopy,
  onClose,
  onClear,
  copied,
  cleared,
}: LastTakeCardProps) {
  const shown = cleared || !text ? "" : text;
  return (
    <div className="last-take-card" role="region" aria-label="Last take">
      <LiquidGlassSurface geometry="panel" />
      {/* Header: what this is, and the doors out of it. */}
      <div className="card-header">
        <div className="card-header-left">
          <TextIcon />
          <span className="card-title">Last Take</span>
        </div>
        <div className="card-header-right">
          <button
            type="button"
            className="card-language"
            onClick={onChooseLanguage}
            title="Choose the language the next take uses"
          >
            {languageLabel}
          </button>
          <button
            type="button"
            className="card-icon-button"
            aria-label="Copy the last take"
            title="Copy"
            onClick={onCopy}
            disabled={!shown}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className="card-icon-button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <span className="pill-glyph pill-close" />
          </button>
        </div>
      </div>

      {/* Body: the words, behind the same accent rule the settings
          window uses for a transcript so the two read as one thing. */}
      <div className="card-body">
        {shown ? (
          <p className="card-text">{shown}</p>
        ) : (
          <p className="card-text card-empty">
            Your last take&rsquo;s words appear here once it has been
            delivered.
          </p>
        )}
      </div>

      {/* Footer: the two things worth doing with the words. No pause,
          because there is nothing to pause. */}
      <div className="card-footer">
        <button
          type="button"
          className="card-chip"
          onClick={onClear}
          disabled={!shown}
          title="Clear what is shown here"
        >
          <ClearIcon />
          <span>Clear</span>
        </button>
        <button
          type="button"
          className="card-chip card-chip-primary"
          onClick={onCopy}
          disabled={!shown}
          title="Copy to the clipboard"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}
