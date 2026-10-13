---
name: whisperlane-mvp
description: Guard whisperlane build and infra decisions for the Windows MVP with terminal-agent-first constraint. Use for architecture, hosting, insertion, hotkey, or milestone scope decisions.
---

# whisperlane-mvp

Guardrails for the whisperlane minimum viable product. Apply before
proposing any architecture, hosting, insertion, hotkey, or scope call.

## MVP scope (closed)

- Platform: Windows only, M0 through M2. No macOS or Linux work in the MVP.
  M3 (macOS, then Linux, signing, publish) is post-MVP.
- Agent: none in v1. v1 dictates into the focused application only. All
  agent integration (OpenCode first, others later) is phase two; v1 must
  keep it cheap via the target abstraction without building any of it.
- Product: hold-to-talk, toggle-to-talk, focused-app insertion, minimal
  optional refinement off by default, cancellation.

## Hard constraint: keep the phase-two door open

The long-term wedge is dictation into an AI agent running in a terminal
interface, but v1 does not serve it. The v1 rule is therefore negative:
no architecture, hosting, insertion, or shortcut call may close the agent
door. Concretely:

1. Build v1 against the target abstraction even though only one
   destination exists.
2. The hotkey must not collide with terminal-emulator or common
   application shortcuts; agent bindings join the collision check in
   phase two.
3. Insertion is verified in everyday Windows applications in v1; the
   terminal-agent destination joins the acceptance matrix in phase two.
4. When a call trades simplicity against keeping phase two cheap, keeping
   it cheap wins and the trade is recorded.

## Proven behavior to reuse

- From the paired plugin project: on-demand transcription lifecycle with
  idle unload that never fires mid-recording, verified accelerated backend
  walk (accelerated NVIDIA, then Vulkan for AMD/Intel, then CPU fallback),
  speech-grade mono capture with quiet-input gain, pinned-by-default
  language with auto as an explicit choice, tolerant settings,
  ask-on-first-press microphone, honest clipboard fallback.
- From Handy (reference product, same stack): supervision behavior as the
  bar (load/unload/reload/fallback/diagnostics), manager separation behind
  a narrow command-event boundary, model auto-discovery, overlay
  discipline (borderless, non-focusable, compact pill plus larger live
  card, no-overlay fallback). Take sturdiness, not scope: history,
  dictionary, translation, and multi-engine choice stay out of v1.

## Where to record

- Options, trade-offs, recommendation: `docs/08-decisions.md`.
- Approval closes into `docs/adr/`.
- Scope or sequence effects: `docs/03-product.md`, `docs/07-roadmap.md`.
- Structural effects: `docs/05-architecture.md`, `docs/06-agent-integration.md`.

## Checklist before proposing

- Windows-only MVP violated? Any agent work slipped into v1?
- Phase-two agent door kept open (target abstraction, no closing calls)?
- Handy supervision bar met regardless of hosting option?
- Decision recorded with options and trade-offs, status open until approved?
