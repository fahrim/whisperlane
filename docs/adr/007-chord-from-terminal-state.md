# ADR-007: The Chord From a Finished State

Status: approved. Extended by `008-pill-control.md`, which gave the
pill's control the same rule so the mouse no longer needs a reset step
the chord does not. The chord behavior decided here is unchanged.

## Context

The experience document requires that a terminal state — done, failed,
cancelled — returns to idle in one action, and the M0 skeleton
implemented that as a button. It never says what the chord itself does
once a take has finished. In the M1 build the chord did nothing there:
the user had to reach the window, press the button, and only then could
dictate again.

That matters more at M1 than it did at M0, because text is now inserted
at a real destination and back-to-back takes are the normal case.
People dictate a sentence, then a second one, without moving the mouse.
Refusing the chord in that moment does not read as a rule; it reads as
the application having stopped listening.

## Options considered

- The chord does nothing from a terminal state and the user must reset
  first, by button. Keeps every transition explicit and the pipeline
  strictly ordered, at the cost of an invisible-feeling step before
  every subsequent take.
- Terminal states fall back to idle on their own after a short pause.
  The chord then always works, but the transcript disappears on its own
  before the user has had a realistic chance to read it, losing the
  honesty the terminal state exists to provide.
- The chord starts a new take directly from a terminal state. One key
  from any state, with the previous transcript still readable until the
  new take replaces it.

## Decision

The chord starts a new take from any non-capturing state. A finished
state is a resting place, not a barrier.

## Consequences

- Back-to-back dictation needs no mouse and no intermediate action.
- Nothing is inserted twice. A new take begins from a phase that has
  already delivered, not from delivered text.
- Starting a take clears the previous transcript and its delivery note
  first, so the surface never shows or copies words that belong to a
  finished take while the next one records.
- The transition table permits the same move. Requiring a reset first
  would reject a legal action rather than an illegal one.
- The reset control remains, for reading a transcript and returning to a
  quiet idle. It is the seed of the pill's single start and stop
  control: one control that starts, stops, and cancels depending on the
  phase, rather than one control per state.
  Extended, not replaced: that control later started the next take
  directly from a finished state, exactly as the chord does here, so the
  two input paths agree. Settling a finished take back to quiet without
  beginning another one lost its click along with it and is parked in the
  idea bank. See `008-pill-control.md`.

## Related

- Proposal: `../08-decisions.md` item 9
- Extended by: `008-pill-control.md`
- Behavior: `../04-experience.md`
- Binding: `001-default-hotkey.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`