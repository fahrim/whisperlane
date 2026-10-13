# Roadmap — Milestones M0 to M3

Milestones build the product from an ugly end-to-end skeleton to a polished,
wider release. Each milestone has acceptance criteria: observable outcomes
that must hold before moving on. Polish never precedes a working take.
Milestones M0 through M2 are Windows-only and form the MVP; M3 is
post-MVP platform expansion, and non-OpenCode agents are phase two beyond
that.

## M0 — Skeleton that talks

Goal: prove the pipeline end to end, ugly but real.

Scope: desktop shell with interface and core layers, tray presence, global
hotkey, audio capture to a stored take, local transcription on CPU, and
delivery of the resulting text through the simplest reliable path. Built
and tested on Windows only.

Acceptance criteria:

- Pressing the hotkey captures speech and produces transcribed text visible
  to the user without manual file handling.
- The application survives the unhappy paths: silence, very short takes,
  and denied microphone access each end in a clear, recoverable state.
- The pipeline runs fully on the local machine with the expected model
  present.
- No polish bar applies yet; reliability of the take matters, appearance does not.

## M1 — Useful on Windows

Goal: become a daily-usable dictation tool on Windows.

Scope: insertion into the focused application, essential settings, quiet
model management, the accelerated transcription path for AMD and Intel
hardware alongside existing paths, and the hold, toggle, and cancel flows.
Built and tested on Windows only.

Acceptance criteria:

- Dictated text lands in the focused application across common everyday
  targets, or the failure is stated plainly with nothing half-inserted.
- Hold-to-talk, toggle-to-talk, and cancellation all behave as described in
  the experience document.
- Model download and readiness are honest and non-blocking; the user is
  never stranded without knowing what is missing.
- Accelerated local transcription on covered Windows hardware is
  meaningfully faster than CPU fallback while preserving the same flows.

## M2 — Polish and packaging (completes the MVP)

Goal: ship v1 in a body that feels finished.

Scope: first-run onboarding, the premium experience pass over the pill,
motion, spacing, and wording, and Windows packaging. Still Windows-only;
no agent destination in this milestone. This milestone completes the MVP.

Acceptance criteria:

- First run is a single screen: the user understands the key, speaks, and
  sees text land correctly in the focused application.
- The application reads as calm and finished: every state is legible from
  the pill, and advanced concerns are folded away.
- A packaged Windows build installs, runs offline after setup, and
  uninstalls cleanly.
- Nothing in the shipped product closes the phase-two agent door: the
  target abstraction is in place even though only one destination exists.

## Phase 2 — Agent integration (not v1)

Goal: make dictation into the AI agent a first-class path, starting with
OpenCode, verified terminal-first as specified in the agent integration
document. Other agents follow through the same abstraction. Scoped and
scheduled only after the MVP ships.

## M3 — Wider (post-MVP)

## M3 — Wider (post-MVP)

Goal: reach beyond the first platform without regressing it.

Scope: macOS support, then Linux support, platform signing and
notarization where required, and public release.

Acceptance criteria:

- Each added platform supports the core flows with platform-appropriate
  insertion, capture, and permission behavior.
- Signed and notarized builds where the platform requires them.
- Public release artifacts are published with licensing intact and a clear
  statement of what v1 does and does not do.

## Reuse across milestones

Much of M0 ports proven behavior from the existing dictation plugin:
capture approach, transcription service thinking, hotkey handling, and
model management. The agent portion of phase two ports the
insert-into-agent idea. The M1 acceleration work builds on the existing
Vulkan Windows speech build. Reuse accelerates milestones; it does not
skip their acceptance criteria.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (milestones, reuse notes)
- Scope: `03-product.md`, `01-vision.md`
- Behavior: `04-experience.md`, `06-agent-integration.md`
- Structure: `05-architecture.md`
- Gates: `08-decisions.md` — spikes that must resolve before building on them
- Shipping: `09-repository.md` — how milestones become releases
