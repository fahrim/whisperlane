# Experience — Principles, Flows, Screens, and Feel

## Design principles

- The application is mostly invisible. Its home is a tray affordance and a
  hotkey; its face during dictation is a single borderless pill. The main
  window exists for onboarding and the occasional setting.
- One pill, three elements. Signal, main control, three-dot menu.
  No dashboard, no feature grid. Sensible defaults; everything advanced is
  folded into settings behind the three-dot menu.
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
  three elements: a live signal that shows what the pipeline is doing, a
  single control for mouse-driven dictation, and a three-dot control that
  opens a compact menu of quick choices plus the door to settings. No other
  chrome lives here. It never takes keyboard focus, stays above the
  destination without stealing it, and offers a no-overlay fallback with
  audio feedback where overlays would break insertion. The compact pill
  serves recording states; a larger card serves live transcription when
  present.
- Pill control. One control, one meaning per state. At rest it shows a
  microphone, and clicking it starts dictation. While a take is live it
  becomes stop, and clicking it ends the take, transcribes it, and
  delivers the text: stop delivers, always. There is no pause. Once a take
  has finished, the same click starts the next one, so the mouse behaves
  exactly as the chord behaves rather than needing a separate reset.
  Discarding is a second action on the same surface, not a fourth element:
  while a take is live a small cancel sits beside the elapsed time, and
  right-clicking the main control does the same thing. It throws the take
  away exactly as Escape does.
- Pill menu. The three-dot control opens a small menu above the pill
  rather than jumping straight to the settings window, so the common
  choices are one click away and the rarely needed door is one more. It
  carries the quick per-session choices, the language, the door to
  settings, and the way out of the application.
- The chord is a press, measured at 250 milliseconds. A shorter press
  starts a take that a second press stops; a press held at least that long
  stops when it is released. Escape discards a live take while it captures
  and while it transcribes. The mouse and the keyboard express the same
  three actions, so neither path can behave differently from the other.
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
  are carried by the pill itself — the signal animates while listening,
  settles into a calm waiting presence while thinking, confirms briefly on
  done, and states failure plainly — rather than by text walls. The signal
  is state-aware rather than decorative: each non-listening state draws the
  same quiet dotted row with its emphasis placed differently, so the pill
  can be read without parsing a word, and the written line beside it still
  says what happened in plain language.
- Transcript panel (hybrid). Closed by default: on success the text goes
  straight to the focused application and the pill settles. The panel
  opens by itself only when insertion fails, keeping the text accessible
  with copy and retry. It can also be opened on demand from the pill's
  menu, which reveals a compact preview of the last take above it. The
  full review — copy and manual insert — lives in the settings window
  until the panel control unfolds on the pill itself. It never opens
  unprompted on the happy path.

## States and feedback

- Idle: the tool is ready; the pill rests hidden and the tray rests quiet.
- Listening: capture is active; the pill's signal animates immediately so
  the user sees speech being heard.
- Thinking: transcription is in progress; the pill shows a calm waiting
  presence so the user knows to wait briefly.
- Done: text has landed or is ready; the pill confirms briefly and settles.
- Failed or cancelled: the cause is stated plainly in place, nothing
  half-inserted remains, and the path back to quiet is one action from
  the pill's menu.
- Settled: whatever came next from a finished take — a new one, or
  settling back to quiet — is the same action the keyboard takes, so
  neither path can hold a capability the other withholds.

Every state is legible from the pill alone without opening settings.
Errors never leave the user guessing whether text was inserted.

## The feel

Calm, sparse, and confident. Generous spacing, restrained motion, and a
single accent. The product should read as finished even when the feature
set is small — closer to a platform utility than to a feature showcase.

## Visual direction

Liquid glass: a translucent surface, a restrained blur, a specular edge
rather than a border, and layered shadow for volume. The glass bends
what is behind it rather than only blurring it, and it saturates and
lifts that light on the way through, which is what separates a
material from a grey pane. The body of the pill is read as a droplet
rather than a plate: a bright catch where light lands on the top
surface, a thick curved inner wall, and a lit lower edge where the glass
bends light back up.

The capsule takes its width from what it is showing rather than from a
fixed box, and it widens to fit a status line whole instead of cutting
a word in half. Everything painted outside the pill's own edge — the
glow, the shadow, and the menu above it — is bound to the capsule
itself, so it travels with the pill as the pill resizes.

The single accent carries state: during recording, processing and
success it radiates a soft glow that diffuses across the glass, and it
rests everywhere else. Glow is state feedback, never decoration. The
states the user waits on are the ones that earn it, so the resting
accent is the quietest thing on screen.

Two rules make the material possible at all. The overlay's window is
transparent and frameless and carries empty room around the pill,
because the glow is painted outside the pill's own edge and a window
clips whatever reaches it. That room is sized for the tallest thing the
pill ever shows above itself, and the pill stays anchored to the bottom
of it, so opening the menu never costs the pill its resting place. And
the accent light is drawn inside the window rather than taken from the
desktop behind it, because a backdrop filter can only bend what is
inside the document.

An opaque high-readability fallback covers transparency-off and any
renderer without a backdrop filter, and reduced motion is respected
throughout: every state stays legible through colour and the written
line, never through movement alone. The exact token values are locked
and recorded in the decision record.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (experience and core flows)
- Before: `02-audience.md`, `03-product.md`
- Structure behind the flows: `05-architecture.md`
- Agent destination behavior (phase two): `06-agent-integration.md`
- When polish lands: `07-roadmap.md`
- Decisions behind these flows: `08-decisions.md` items 8 and 10,
  `adr/004-cancel-gesture.md`, `adr/007-chord-from-terminal-state.md`,
  `adr/008-pill-control.md`, `adr/009-liquid-glass-tokens.md`
- External input merged here: `reference/external-ui-ux-brief.md`, triage in `reference/ui-brief-triage.md`
