# Agent Integration — Dictate Into the Agent (Phase Two)

This document specifies phase two, not v1. v1 has no agent destination;
it proves dictation into the focused application first. Everything below
is the design that phase two implements, kept cheap by building v1
against the target abstraction from the start.

## Why this is the wedge

Most dictation tools type into applications. whisperlane makes typing into
the AI agent a first-class, obvious path from the start. The initial and
only v1 agent is OpenCode; later agents enter in phase two through the same
abstraction. This is the product tagline carried by a narrow, well-bounded
mechanism — not a second product.

## Terminal-first constraint (phase two)

OpenCode runs as a terminal interface inside a terminal emulator, and that
fact will constrain phase-two infrastructure rather than follow it. Insertion must
succeed when the focused application is a terminal hosting the agent
prompt; focus reporting, caret placement, and fallback behavior are all
verified there first and in everyday applications second. The hotkey must
not collide with terminal or agent bindings. Hosting lifecycle must keep
dictation responsive while the agent itself is busy. No infrastructure
choice is accepted on convenience grounds if it weakens this path: when a
hosting, insertion, or shortcut decision trades simplicity against
terminal-agent reliability, reliability wins and the trade is recorded
explicitly.

## The target abstraction

There is a single documented destination concept with two kinds of value:
the focused application, and an explicitly chosen agent. Flows, settings,
and the indicator all speak in terms of this destination. The user always
knows where text will land before speaking, and switching destinations is
an explicit choice rather than a mode error.

Later agents — other coding assistants, chat tools, plain terminals — enter
in phase two through the same abstraction. Adding a destination then means
describing a new target, not redesigning dictation. Nothing in v1 may close
that door, and nothing in v1 builds those doors.

## Mode A — dictate into the agent prompt

The transcribed text is placed in the agent input, exactly as if typed,
leaving submission to the user. This is the low-risk, immediately useful
path and the direct descendant of the existing plugin behavior. The user
keeps full control: review, edit, then send.

## Mode B — voice-first

Transcription hands the text to the agent as a prompt in one step, reducing
the interaction to speak-and-go. This mode is narrower and more opinionated:
it must be explicit, cancellable, and honest about what was sent. It is not
the default until Mode A is solid.

## Design rules

- The agent path never complicates the default path. Dictation into the
  focused application stays simple whether or not an agent is configured.
- Placement is exact and predictable. The user can trust where the caret
  was and what was inserted.
- Meaning is never rewritten on the way in. Optional minimal cleanup is the
  only transformation, off unless requested.
- The integration stays thin and pluggable. Agent-specific behavior lives
  behind the target boundary so the core pipeline does not fork per agent.
- Provenance is clear. The user can always tell whether text went to an
  application or to an agent, and in which mode.

## Relationship to prior work

The capture behavior, the companion transcription approach, hotkey handling,
model management thinking, and the insert-into-OpenCode idea all descend
from the existing dictation plugin, which already drives the OpenCode
terminal interface in daily use: toggle and voice-first commands,
microphone and language selection, hotkey configuration, and placement of
transcribed text into the agent prompt for review before sending. That
proven terminal path is the baseline the desktop product must meet before
exceeding. The Vulkan Windows build for the speech engine descends from the
existing hardware-specific work. The roadmap records which milestone ports
and productizes each part.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (integration sketch, reuse notes)
- Before: `04-experience.md`, `05-architecture.md`
- Audiences served: `02-audience.md` — especially the agent-native developer
- Delivery: `07-roadmap.md` — when each mode lands
- Open target questions: `08-decisions.md`
