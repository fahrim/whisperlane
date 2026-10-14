# ADR-008: Pill Control and Chord Timing

Status: approved. Amended once during M2 polish: the main control now
starts a take from a finished state rather than settling back to idle,
and the cancel is a visible control during a live take rather than one
revealed on hover. Both changes move the mouse closer to the keyboard;
neither changes what stop, discard, or deliver mean.

## Context

The pill's second element had two incompatible descriptions. The
experience document called it "a single start and stop control for
mouse-driven use", which delivers when it stops. ADR-004 made the pill's
stop control perform the discard, so that the discard path would not
need a keyboard, and stated the rule flatly: stop delivers, Escape
throws away. A mouse-only user could therefore either never discard or
never deliver, and no document said which.

The chord carried the same kind of gap. One threshold separated a tap
from a hold, but its value was not the one the established Windows
dictation products use, and whether the threshold itself counted as a tap
or a hold was unstated.

## Options considered

- Hold to talk on the pill, release to deliver, click to discard.
  Rejected: holding a mouse button down while dictating is not
  comfortable on a desk, which is where this product lives.
- Press to start, click to stop and deliver, discard revealed on hover
  during a take. Keeps both documents true by giving the discard its own
  affordance instead of overloading stop.
- Press to start, click to stop and discard, delivery on the chord only.
  Leaves a mouse-only user with no way at all to deliver a take.

## Decision

Stop delivers, cancel discards, on every input path.

The pill's main control starts dictation from a resting state and
becomes stop while a take is live; clicking it ends the take,
transcribes it, and delivers the text. There is no pause state.

From a finished take the same click starts the next one, which is what
the chord has always done there. The control settles to idle in its
appearance, but its meaning is start, so the mouse never needs a
separate reset step that the keyboard does not.

The discard is a second action on the same surface, not a fourth
element. While a take is live a small cancel sits beside the elapsed
time, and right-clicking the main control does the same thing. Either
one throws the take away exactly as Escape does, so mouse-only
dictation loses nothing the keyboard path has.

The chord is a press, measured at 250 milliseconds. A press shorter than
that starts a take that a second press stops. A press held for at least
that long stops when it is released. Escape discards a live take while
it captures and while it transcribes.

The mouse and the keyboard are not two flows. Both express the same
three intents — start, stop, discard — and pass through the same
decision table in the core, so neither path can drift from the other.

## Consequences

- The pill keeps exactly three elements; the cancel is contextual and
  appears only while a take is live.
- Stop delivers now holds for the mouse exactly as it always held for
  the keyboard, and discarding no longer requires a keyboard.
- A cancel that only appears on hover is a cancel a user taking a take
  with their eyes on their text never meets. It is visible for the whole
  live take, so the discard is discoverable without hunting.
- Back-to-back dictation no longer costs a detour on either input path:
  the chord and the control agree that a finished take is a resting
  place, not a barrier. Settling back to quiet without starting another
  take moved to the pill's menu, which is where the rarely wanted
  choices belong.
- The tap threshold is one named constant with an exclusive upper bound,
  so a press of exactly 250 milliseconds counts as a hold.
- Every input path is the same decision table in the core: a new gesture
  is a new intent, never a new pipeline.
- ADR-004 is amended, not replaced. The discard gesture it chose is
  unchanged; the pill's part of it is now named instead of implied.
- ADR-007 is extended, not replaced. Its rule for the chord from a
  finished state is now also the control's rule, so neither path can
  offer a capability the other withholds.

## Related

- Proposal: `../08-decisions.md` item 10
- Amends: `004-cancel-gesture.md`, and `007-chord-from-terminal-state.md`
- Behavior: `../04-experience.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`