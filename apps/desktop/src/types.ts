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

export interface PipelineStatus {
  phase: Phase;
  /** Plain-language name for the phase, decided by the core. */
  label: string;
  target: string | { agent: string };
  detail: string | null;
  valid_next: Phase[];
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