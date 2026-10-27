// Shared shapes for the command boundary. They live in one place so the
// screens agree on the pipeline state without restating it.

export type Phase =
  | "idle"
  | "listening"
  | "thinking"
  | "done"
  | "failed"
  | "cancelled";

export type DeliveryKind = "none" | "typed" | "partial" | "clipboard";

export type MainAction = "start" | "stop" | "dismiss" | "unavailable";

export interface PipelineStatus {
  phase: Phase;
  /** Plain-language name for the phase, decided by the core. */
  label: string;
  /** What the main control does right now, decided by the core. */
  main_action: MainAction;
  target: string | { agent: string };
  detail: string | null;
  last_text: string | null;
  delivery: DeliveryKind;
}

export interface Microphone {
  kind: "system_default" | "device";
  id?: string;
}

export interface Settings {
  language: string;
  hotkey: string;
  microphone: Microphone;
  model: string;
  /** Whether the one-screen introduction has been seen. */
  onboarded: boolean;
  start_with_windows: boolean;
  theme: "system" | "light" | "dark";
  /** Live desktop-refracting glass, or the static performance material. */
  glass: "live" | "performance";
  /** Whether a finished transcript is published on the local socket. */
  transcript_service: boolean;
}

export interface TranscriptServiceStatus {
  running: boolean;
  port: number;
  subscribers: number;
  error: string | null;
}

export interface ThemeChoice {
  code: "system" | "light" | "dark";
  label: string;
}

export interface ModelOption {
  id: string;
  label: string;
  size_mb: number;
  present: boolean;
  is_default: boolean;
}

export interface Download {
  running: boolean;
  model: string | null;
  received_mb: number;
  total_mb: number;
  percent: number | null;
  error: string | null;
}

/**
 * Whether the chosen model can take a word yet, and whether it is on its
 * way. The resting surfaces say ready only when this allows it, so the
 * pill and the tray cannot promise a take the install cannot deliver.
 */
export interface ModelReadiness {
  present: boolean;
  downloading: boolean;
  /**
   * The core's own sentence for a missing model, or null when there is
   * nothing to say. Carried rather than restated, so the pill and the
   * take that finds no model say the same words.
   */
  hint: string | null;
}

export interface InputDevice {
  id: string;
  label: string;
}

export interface LanguageChoice {
  code: string;
  label: string;
}

export interface HotkeyChoice {
  code: string;
  label: string;
}