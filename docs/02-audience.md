# Audience — Target Users, Personas, and Scenarios

This document describes who whisperlane serves first and how they use it.
Personas below are initial proposals to be validated against real use; they
are not claims about measured behavior.

## Target audience

The first audience is anyone who wants calm, private, offline dictation
into everyday applications on Windows without ceremony — including users
on AMD and Intel hardware that mainstream accelerated transcription
leaves behind. A second audience, served in phase two rather than v1, is
developers who want to dictate into an AI coding agent.

What unites them: they speak in short to medium takes, they care where the
text lands, and they dislike setup friction and visual clutter.

## Personas (initial proposals)

### The pragmatic professional

Writes messages, notes, and documents across many applications. Does not
live in one editor. Wants one hotkey that works everywhere, with a clear
signal for listening, thinking, and done. Values privacy and offline
operation over cloud accuracy gains. Served in v1.

### The left-behind hardware owner

Has a capable AMD or Intel machine on Windows but gets only slow CPU
transcription from tools optimized for a single vendor. Wants fast local
transcription with zero setup. Values the feeling that the tool was built
for their machine, not tolerated on it. Served in v1.

### The agent-native developer (phase two)

Works in OpenCode daily. Thinks faster than they type when prompting.
Wants to hold a key, speak a prompt, and see it land in the agent input
exactly as intended. Values reliability of insertion over extra features.
Runs Windows; may be on AMD or Intel graphics. Not served in v1; shapes
the target abstraction so phase two stays cheap.

## Core scenarios (v1)

- Dictate a short text into whatever application currently has focus: a
  message box, a document, a chat input — without choosing a destination
  first.
- Dictate a longer thought hands-free: start once, speak at natural pace,
  stop once, review, and keep or discard the result.
- Recover gracefully: cancel a take that went wrong so nothing is inserted,
  and always know which state the application is in.
- Start from zero: install, understand the single instruction on first run,
  speak, and succeed while the speech model completes downloading in the
  background.

## Phase-two scenarios (not v1)

- Dictate a short prompt into the agent while staying in flow: hold, speak,
  release, and continue working once the text has landed in the agent
  input.

## What this implies

- Insertion reliability matters more than feature breadth.
- v1 has exactly one destination: the focused application.
- First run, the state signal, and cancellation are not edge details;
  they are the product for these users.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (experience and integration sections)
- Before: `01-vision.md` — the goals these users help achieve
- Next: `03-product.md` — how scope serves these scenarios
- Flows and states: `04-experience.md` — behavior in each scenario
- Agent flow detail: `06-agent-integration.md` — the phase-two agent path
