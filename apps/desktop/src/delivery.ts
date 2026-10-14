// What a finished take actually did, in as many words as it takes.
//
// The core decides how a take reached the user and carries the reason;
// this turns that into the one sentence every surface shows. Two files
// needing it is the second use, so it lives here rather than in either.

import type { DeliveryKind } from "./types";

/**
 * The plain-language outcome of the last take. Insertion honesty is the
 * point: the user must never be left wondering whether their words
 * landed, so a clean type-in says so and every other case says what
 * happened and where the text is instead.
 */
export function deliveryNote(
  delivery: DeliveryKind,
  detail: string | null,
): string {
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

/**
 * Whether the transcript is worth showing at all.
 *
 * Closed by default: when the words were typed into the focused
 * application the user already has them, and repeating them back is
 * noise. It opens by itself only when insertion failed or landed only
 * partly, which is exactly when the text would otherwise be lost.
 */
export function transcriptMatters(
  text: string | null,
  delivery: DeliveryKind,
): boolean {
  return text !== null && text.trim() !== "" && (delivery === "clipboard" || delivery === "partial");
}