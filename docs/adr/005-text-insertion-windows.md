# ADR-005: Text Insertion on Windows

Status: approved.

## Context

In v1 the destination is always the focused application, and the
milestone requires that dictated text actually lands there across common
everyday targets — or that the failure is stated plainly with nothing
half-inserted. The decision document names the shape of the answer but
leaves the Windows mechanism open, and requires the chosen primary and
fallback to be recorded here.

Two reference products inform the choice. The existing dictation plugin
inserts into the focused composer when it can reach it and otherwise
falls back to the clipboard with an honest notice rather than dropping
text silently. The leading commercial tool relies on platform input
synthesis, which is invisible when it works.

Trade-off shape: native synthesis is invisible when it works and fragile
across targets when it does not, because the target application decides
where its own input lands. Clipboard-assisted insertion is more reliable
in narrow cases but not general, and it clobbers whatever the user had
copied.

## Options considered

- Clipboard only. Simplest and reliable, but it does not satisfy the
  insertion criterion, and it silently destroys the user's clipboard.
- Native input synthesis as the primary path, with a clipboard fallback
  that tells the user what happened. General and invisible on success.
- Target-specific insertion per application. Most reliable per target,
  but unbounded work and a permanently growing maintenance surface.

## Decision

On Windows, native input synthesis is the primary path, with the
clipboard as the fallback. Synthesis carries the keystrokes of the
transcribed text into whatever currently holds focus. When synthesis
cannot complete, the text goes to the clipboard and the user is told
plainly that it did, rather than being left to guess whether anything
was inserted.

## Consequences

- Success is silent and invisible: the text appears at the caret exactly
  as if typed, and the pipeline reports done without ceremony.
- The fallback is never silent. A user whose text only reached the
  clipboard is told, because errors never leave the user guessing
  whether text was inserted.
- Nothing is ever half-inserted: a failed synthesis attempt falls back
  whole rather than emitting a partial string.
- The destination abstraction stays intact. Insertion happens behind the
  focused-application target, so the phase-two agent destination enters
  as another target rather than a new delivery mechanism.
- Known constraint, recorded after approval: the integrity rule that
  refuses our synthesized input also keeps the low-level keyboard hook
  from seeing keys aimed at a window above us. Pressing the chord while an
  elevated window has focus can therefore start no take at all, which is
  outside this decision's fallback because there is no take to deliver and
  no keystroke to react to. Naming the reason where the case is observable
  — an insertion refused, or a take started from the pill — is queued in
  `../../BACKLOG.md`; starting the application elevated remains the user's
  deliberate choice, not something the product does for them.
- Everyday Windows targets are verified in v1. The terminal hosting an
  agent prompt joins the acceptance matrix in phase two.

## Related

- Proposal: `../08-decisions.md` item 3
- Behavior: `../04-experience.md`
- Target boundary: `../06-agent-integration.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`