# Vision — Mission, Goals, and Success Measures

## Mission

Give people a free, private, local-first way to speak and have their words
appear where they need them — starting with their AI coding agent.

## Vision

Dictation disappears into the workflow. No accounts, no cloud round-trip, no
settings wall. A quiet tool that is mostly invisible, feels finished, and
respects the machine it runs on.

The long-term picture is simple: hold a key, talk, and it is typed — into an
editor, a chat, or an agent. The product stays small while the set of
destinations grows.

## Goals for v1

- Reliable hold-to-talk and toggle-to-talk dictation that inserts text into
  the focused application on Windows.
- Fast local transcription across common Windows hardware, including AMD and
  Intel graphics alongside NVIDIA and CPU fallback.
- A dead-simple first run: one screen, one key, with the speech model
  arriving quietly in the background.
- A user experience that feels calm, sparse, and confident from day one.

## Success measures (proposal, v1)

These are observable outcomes, not implementation details. Thresholds are
intentionally left open until real usage sets them.

- A spoken take reliably ends up as inserted text in the focused
  application, or is cleanly cancelled with nothing inserted.
- Transcription on typical supported hardware feels fast enough to keep
  speaking naturally, without forcing the user to wait or repeat.
- A new user completes first run without help: understands the key, speaks,
  and sees text land in the right place.
- The application runs fully offline after setup, with no account and no
  required network dependency for everyday dictation.
- Everyday use is quiet: states are always legible from a single small
  indicator, and failures are honest and recoverable.

## Non-goals for v1

- Accounts, cloud synchronization, or team features.
- Meeting recording or a transcription library.
- Mobile platforms.
- Model training or fine-tuning.
- A general file-transcription utility.
- Any agent integration, including OpenCode. The agent direction is phase
  two; v1 proves dictation into the focused application first.

Non-goals are scope protection, not a lack of ambition. They keep v1 to the
dictation job and leave wider uses for later.

## Positioning in one line

Not another general dictation app: a premium-feeling, local-first
dictation tool whose technical wedge is strong Windows graphics support
beyond a single vendor, with an AI-agent-native direction held for phase
two.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (sections on what it is, goals and non-goals)
- Next: `02-audience.md` — who this vision serves
- Scope detail: `03-product.md` — what is included and excluded
- Delivery sequence: `07-roadmap.md` — how v1 is reached
- Open thresholds: `08-decisions.md` — choices that affect how success is measured
