# Product — Scope, Features, Boundaries, and Positioning

## What it is

whisperlane is a standalone desktop dictation application. The user presses a
hotkey, speaks, and the transcribed words appear at the chosen destination.
It is free and open source, and local-first and private by default: everyday
dictation runs on the machine, the words are never sent anywhere, and there
is no account and no required cloud step.

In one sentence: hold a key, talk, and it is typed — into the focused
application or into the agent.

The defining direction is dictation into an AI coding agent. Today that means
the focused window: an agent's terminal is a window, and the take is typed
into it like anywhere else, with no special mode. The next step in this
product's own scope is a **direct agent target** — dictating into an open
agent session without moving focus to its window first. It is the same
dictation delivered to a named destination instead of to whatever is
frontmost: no model in the middle, no rewriting, no autonomous work. The
architecture keeps that cheap through a target abstraction, and no
infrastructure choice in v1 may close the door. Convenience never overrides
this ordering.

## In scope for v1

- Hold-to-talk: hold the hotkey, speak, release. The take is transcribed and
  inserted.
- Toggle-to-talk: tap to start, tap to stop. For longer thoughts.
- Insertion into the focused application, including a coding agent's
  terminal session. The caret is the destination; which program owns it is
  the user's business.
- Minimal optional refinement: light local cleanup of punctuation and obvious
  filler, off unless requested, never rewriting meaning.
- Cancellation: discard a take so nothing is inserted.
- Model management that stays out of the way: the required speech model is
  fetched when the user asks for it, with honest progress.
- Application settings kept to the minimum that v1 flows require.
- A local transcript service: an optional, off-by-default socket that
  publishes each finished transcript to other programs on the same machine.
  It carries text only. It exists so that another local program — an agent,
  a script, an editor — can be fed the words the user just spoke without
  reading the screen or the clipboard.

## v1 boundaries

The following are explicitly out of scope until the milestones say
otherwise: accounts and cloud synchronization, team use, meeting recording
and transcription libraries, mobile platforms, model training and
fine-tuning, general file-transcription use, and autonomous task
orchestration across agents.

The agent destination in this product stops at delivery: naming an open agent
session and sending it the take. Turning a spoken sentence into a planned
task, choosing between agents, or approving work across several of them is
not dictation, and is not in scope here.

The product does not try to be a transcription workbench; it does one
dictation job well.

For the authoritative wording of goals and non-goals, the vision document
governs; this document governs how that scope maps to features.

## Positioning

The dictation space is crowded and mature, with strong free and offline
options and platform-specific standouts. whisperlane does not compete by
being another general transcriber. It competes on three axes, in priority
order:

1. Agent-native, in the two senses that belong to this product. Typing into
   an agent's terminal works today; a direct agent target — the same take
   delivered to a named session without moving focus — is the next step.
   Both are free.
2. Premium, uncluttered experience. Fewer surfaces, sensible defaults,
   restrained motion, and one calm pill instead of a settings wall.
3. Strong Windows graphics coverage. Fast local transcription on AMD and
   Intel hardware in addition to NVIDIA and CPU fallback, closing a gap
   that vendor-specific acceleration leaves open.

## What the product is not

- Not a meeting recorder.
- Not a file-transcription library or workbench.
- Not a cloud voice platform with accounts and sync.
- Not an agent orchestrator. Naming a destination and delivering a take is
  dictation; planning work and running it across agents is not.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (field read, goals, core flows, integration sketch)
- Before: `01-vision.md`, `02-audience.md`
- Next: `04-experience.md` — how the scoped features behave
- Structure: `05-architecture.md` — how the scope maps to components
- Wedge detail: `06-agent-integration.md` — the direct agent target and the
  destination abstraction
- Delivery: `07-roadmap.md` — when each scoped piece lands
