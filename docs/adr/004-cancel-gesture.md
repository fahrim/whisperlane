# ADR-004: Cancel Gesture

Status: approved.

## Context

The experience document requires cancellation: the user discards the take
at any point before insertion, nothing is inserted, and the application
returns cleanly to idle in one action. It also requires toggle-to-talk,
where a tap starts a take and a tap stops it. Neither document names the
gesture for discarding, and the chord is already spoken for: it starts
and stops takes. Cancellation cannot be a third state of the same chord
without making its meaning depend on what just happened.

## Options considered

- Pressing the chord again discards instead of stopping. Reuses the one
  gesture already known, but overloads it: the same press means stop in
  one moment and discard in the next, and nothing distinguishes them
  before the press.
- A discard control on the pill only. Discoverable, but it excludes
  keyboard-only dictation, which is the primary gesture of the product.
- The Escape key discards a live take, with the same action on the pill
  so mouse-only use is not left out. One gesture with one meaning,
  available without leaving the destination application.

## Decision

The Escape key discards a live take, during capture and while
transcription runs. The same action is available from the pill's stop
control so mouse-only use is covered. Stop delivers; Escape always
throws away.

## Consequences

- The chord keeps exactly two meanings: start a take and stop it.
- Escape is swallowed only while a take is live. Everywhere else it
  reaches the focused application as ordinary typing, so it never
  silently breaks another application's own cancel.
- A transcription result that arrives after a discard is dropped, not
  delivered: a discarded take never reaches the clipboard or the
  destination, and a late failure never resurrects it.
- The discard path must be reachable without the keyboard, so the pill
  carries it too.

## Related

- Proposal: `../08-decisions.md` item 8
- Behavior: `../04-experience.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`