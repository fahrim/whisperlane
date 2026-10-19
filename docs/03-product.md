# Product — Scope, Features, Boundaries, and Positioning

## What it is

whisperlane is a standalone desktop dictation application. The user presses a
hotkey, speaks, and the transcribed words appear at the chosen destination.
It is local-first and private by default: everyday dictation runs on the
machine, with no account and no required cloud step.

In one sentence: hold a key, talk, and it is typed — into the focused
application or into the agent.

The defining direction is dictation into an AI coding agent running in a
terminal interface, starting with OpenCode — but that direction belongs to
phase two, not v1. v1 dictates into the focused application only. The
architecture keeps the agent destination cheap to add later through a
target abstraction, and no infrastructure choice in v1 may close that
door. Convenience never overrides this ordering.

## In scope for v1

- Hold-to-talk: hold the hotkey, speak, release. The take is transcribed and
  inserted.
- Toggle-to-talk: tap to start, tap to stop. For longer thoughts.
- Insertion into the focused application. This is the only destination in
  v1; agent destinations arrive in phase two.
- Minimal optional refinement: light local cleanup of punctuation and obvious
  filler, off unless requested, never rewriting meaning.
- Cancellation: discard a take so nothing is inserted.
- Model management that stays out of the way: the required speech model is
  fetched when the user asks for it, with honest progress.
- Application settings kept to the minimum that v1 flows require.

## v1 boundaries

The following are explicitly out of v1 scope: accounts and cloud
synchronization, team use, meeting recording and transcription libraries,
mobile platforms, model training and fine-tuning, general
file-transcription use, and every agent integration including OpenCode.
Agent integration is phase two: kept cheap by the target abstraction but
not built now. The product does not try to be a transcription workbench;
it does one dictation job well.

For the authoritative wording of goals and non-goals, the vision document
governs; this document governs how that scope maps to features.

## Positioning

The dictation space is crowded and mature, with strong free and offline
options and platform-specific standouts. whisperlane does not compete by
being another general transcriber. It competes on three axes, in priority
order:

1. AI-agent native — phase-two direction, not v1 scope. Typing into the
   agent becomes a first-class, obvious path after v1, starting with
   OpenCode; the design keeps later agents as configuration rather than a
   rewrite.
2. Premium, uncluttered experience. Fewer surfaces, sensible defaults,
   restrained motion, and one calm pill instead of a settings wall.
3. Strong Windows graphics coverage. Fast local transcription on AMD and
   Intel hardware in addition to NVIDIA and CPU fallback, closing a gap
   that vendor-specific acceleration leaves open.

## What the product is not

- Not a meeting recorder.
- Not a file-transcription library or workbench.
- Not a cloud voice platform with accounts and sync.
- Not an agent integration in v1. The agent destination is a documented
  phase-two extension behind the target boundary, not a v1 feature.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (field read, goals, core flows, integration sketch)
- Before: `01-vision.md`, `02-audience.md`
- Next: `04-experience.md` — how the scoped features behave
- Structure: `05-architecture.md` — how the scope maps to components
- Wedge detail: `06-agent-integration.md` — the agent-native claim
- Delivery: `07-roadmap.md` — when each scoped piece lands
