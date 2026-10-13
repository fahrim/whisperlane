# Architecture Decision Records

This folder holds approved decisions. Proposals live in
`../08-decisions.md`; only approved outcomes land here.

## Process

- Each record captures context, options considered, the decision, and
  consequences.
- Records are numbered sequentially and never rewritten to change meaning;
  a superseded record stays and points to its successor.
- When a record lands, the corresponding section of `08-decisions.md` and
  the Related sections of affected documents are updated together.

## Index

- `001-default-hotkey.md` — default hotkey (approved from `08-decisions.md` item 7).
- `002-engine-hosting.md` — speech-engine hosting (approved from `08-decisions.md` item 1).
- `003-device-event-filter.md` — device event filter for the global hotkey (approved from `08-decisions.md` item 7).
- `004-cancel-gesture.md` — how the user discards a take (approved from `08-decisions.md` item 8).
- `005-text-insertion-windows.md` — text insertion on Windows (approved from `08-decisions.md` item 3).
- `006-model-default-and-download.md` — default model and download (approved from `08-decisions.md` item 4).
- `007-chord-from-terminal-state.md` — the chord from a finished state (approved from `08-decisions.md` item 9).
- `008-pill-control.md` — the pill's control and the chord's tap threshold (approved from `08-decisions.md` item 10); amends `004-cancel-gesture.md`.

## Related

- Open questions: `../08-decisions.md`
- Index: `../README.md`
- Source plan: `../plan/pre-start-intro-plan.md`
