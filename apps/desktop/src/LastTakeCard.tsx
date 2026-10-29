// The card that shows what the last finished take said.
//
// The name is deliberate. v1 transcribes a whole take after capture ends
// and never streams words while the user is still speaking, so a card
// that called itself live and carried a blinking caret would be claiming
// a capability the core does not have. What it shows is real: the words
// the last take produced, and where they went.

import { LiquidGlassSurface } from "./LiquidGlassSurface";

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