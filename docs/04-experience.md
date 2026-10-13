# Experience — Principles, Flows, Screens, and Feel

## Design principles

- The application is mostly invisible. Its home is a tray affordance and a
  hotkey; its face during dictation is a single borderless pill. The main
  window exists for onboarding and the occasional setting.
- One pill, three elements. Signal bar, start and stop, three-dot options.
  No dashboard, no feature grid. Sensible defaults; everything advanced is
  folded into settings behind the three-dot control.
- A quiet signal for every state. Idle, listening, thinking, and done are
  shown with one small, tasteful indicator, never a wall of chrome.
- Native feel. Real platform behavior, restrained motion, generous space,
  and a single accent color. Nothing that reads as a web page in a box.
- First run is one screen. One big, clear instruction — hold the key and
  speak — with the model download running honestly in the background.

## Core flows

- Hold-to-talk. The user holds the hotkey, speaks, and releases. The take is
  transcribed and inserted at the destination. The expected case is short
  prompts and quick insertions.
- Toggle-to-talk. The user taps to start and taps to stop. For longer
  thoughts where holding is uncomfortable. Stopping ends capture and begins
  transcription.
- Insertion target. In v1 the destination is always the focused
  application; there is nothing to choose and no mode to get wrong. The
  target abstraction reserves an explicit agent choice for phase two.
- Refinement, optional and minimal. When enabled, light local cleanup of
  punctuation and obvious filler. Off unless asked for; meaning is never
  rewritten.
- Cancellation. The user discards the take at any point before insertion.
  Nothing is inserted, and the application returns cleanly to idle.

## Screens and surfaces

- Pill overlay (primary surface). A borderless, floating pill, visible
  during dictation and dismissible to the tray when idle. It holds exactly
  three elements: a live signal bar that animates while listening, a single
  start and stop control for mouse-driven use, and a three-dot options
  control that opens settings. No other chrome lives here. It never takes
  keyboard focus, stays above the destination without stealing it, and
  offers a no-overlay fallback with audio feedback where overlays would
  break insertion. The compact pill serves recording states; a larger card
  serves live transcription when present.
- Tray affordance and popover. The quiet home when the pill is hidden:
  status at a glance, quick access to start dictation, and a path to
  settings.
- Onboarding window. A single screen with one instruction and honest model
  download progress. No account step, no multi-page wizard.
- Settings window. Opened from the pill three-dot control or the tray. The
  minimum v1 requires: hotkey choice, microphone and language choice, and
  model state. Destination choice arrives with phase two. Everything else
  stays hidden or at defaults.
- Model manager. A quiet surface showing download and readiness state with
  honest progress. It never blocks dictation language with jargon.
- State presence in the pill. Idle, listening, thinking, done, and failure
  are carried by the pill itself — the signal bar animates while listening,
  settles into a calm waiting presence while thinking, confirms briefly on
  done, and states failure plainly — rather than by text walls.
- Transcript panel (hybrid). Closed by default: on success the text goes
  straight to the focused application and the pill settles. The panel
  opens by itself only when insertion fails, keeping the text accessible
  with copy and retry. It can also be opened on demand: a setting enables
  it, and a panel control on the pill unfolds it downward for review,
  copy, and manual insert. It never opens unprompted on the happy path.

## States and feedback

- Idle: the tool is ready; the pill rests hidden and the tray rests quiet.
- Listening: capture is active; the pill signal bar animates immediately so
  the user sees speech being heard.
- Thinking: transcription is in progress; the pill shows a calm waiting
  presence so the user knows to wait briefly.
- Done: text has landed or is ready; the pill confirms briefly and settles.
- Failed or cancelled: the cause is stated plainly in place, nothing
  half-inserted remains, and the path back to idle is one action.

Every state is legible from the pill alone without opening settings.
Errors never leave the user guessing whether text was inserted.

## The feel

Calm, sparse, and confident. Generous spacing, restrained motion, and a
single accent. The product should read as finished even when the feature
set is small — closer to a platform utility than to a feature showcase.

## Visual direction

Liquid glass: translucent dark surfaces, restrained blur, a subtle edge
light, and a soft shadow. The single accent carries state — during
recording, processing, and success it radiates a soft neon glow that
diffuses across the glass, and it rests everywhere else. Glow is state
feedback, never decoration: idle chrome stays quiet, and no control
glows just for looking premium. An opaque high-readability fallback
covers transparency-off, and reduced motion is respected throughout.
Exact token values remain a proposal until approved.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (experience and core flows)
- Before: `02-audience.md`, `03-product.md`
- Structure behind the flows: `05-architecture.md`
- Agent destination behavior (phase two): `06-agent-integration.md`
- When polish lands: `07-roadmap.md`
