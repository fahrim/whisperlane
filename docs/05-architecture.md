# Architecture — Components, Data Flow, and Platform Strategy

This document narrates how whisperlane is structured and why. It contains no
implementation; diagrams here are conceptual.

## Conceptual shape

The application has two layers with a narrow boundary between them.

- The interface layer presents onboarding, settings, the tray popover, and
  model state. It holds no audio logic and no transcription logic.
- The core layer owns everything native: the global hotkey, audio capture
  with voice activity handling, transcription through the speech engine,
  text insertion toward the chosen destination, the tray behavior, the model
  manager, preferences, and logs.

The interface layer requests work and observes state; the core layer
performs work and reports state. All crossing happens over a small,
documented command and event boundary.

## Data flow

A dictation take moves through the same pipeline regardless of destination:

Hotkey intent leads to audio capture with voice activity handling, which
leads to transcription by the local speech engine, which leads to text,
which leads to delivery toward the insertion target.

Preferences and model state sit beside this pipeline: they decide which key
starts capture, which destination receives text, and which speech model
performs transcription. Logs sit beneath it for diagnosis without
surveillance.

Delivery has one destination in v1: the focused application. The target
abstraction reserves an explicit agent destination for phase two, so adding
it later means describing a new target, not redesigning dictation. The
phase-two agent design lives in the agent integration document.

## Technology choices and why

- A native desktop shell with a system web view keeps binaries small and
  earns platform integration: tray behavior, global hotkey handling, and
  native-feeling windows.
- A modern package manager and script runner serves the interface side for
  dependency management, scripts, and testing workflow.
- A component interface framework with static typing serves the visible
  surfaces, which are few but must feel finished.
- A mature local speech engine serves transcription, with hardware paths
  chosen per machine: vendor acceleration where present and CPU as the
  floor. On Windows this includes a Vulkan path that covers AMD and Intel
  hardware — the technical wedge.
- A systems language serves the parts that must be native: audio capture,
  global hotkey handling, text injection, tray integration, model
  management, and the binding to the speech engine.

Each choice follows the same rule: prefer the smallest mechanism that earns
native behavior, offline operation, and small, shippable binaries.

## Platform strategy

Windows only for the entire first phase: every milestone through the
polished Windows release is built and tested on Windows, with no macOS or
Linux work inside the MVP. Windows first because the wedge lives there:
reliable insertion into the focused application and into the terminal agent
alike, plus fast local transcription across AMD, Intel, NVIDIA, and CPU.
Later platforms reuse the pipeline and the target abstraction; only
capture, insertion, permissions, and packaging behavior change per
operating system. The wider platform work belongs to the post-MVP
milestone.

Text insertion and permission stories differ per platform and carry real
reliability risk. They are treated as open decisions with per-platform
evaluation, not as assumed solved details.

## Repository shape (narrated)

The repository separates the desktop application (interface plus native
core), optional shared native libraries for audio, transcription, and
injection concerns, project documentation with the plan folder as the
origin, and root-level project files including the readme and the two
license texts. The exact directory names are settled alongside the first
milestone scaffold and recorded in the repository document.

## What is deliberately undecided here

Whether the speech engine runs in-process or as a companion local service
is open. The companion-service path is proven by prior work — on-demand
start, warm retention while in use, idle unload, verified accelerated
backend walk — and lets the existing Vulkan build ship as-is; the
in-process path may simplify packaging. The trade-off is recorded with
options and a recommendation in the decisions document, to be resolved by a
small spike — not assumed here.

## Reuse from prior work

The pipeline reuses proven behavior from the existing dictation plugin:
verified accelerated backend selection, companion service lifecycle,
speech-grade mono capture with quiet-input gain handling, pinned-by-default
language with auto available as an explicit choice, tolerant settings that
ignore unknown values instead of failing, ask-on-first-press microphone
choice, a low-cost live loudness signal derived from the captured stream,
and honest fallback when the destination cannot be reached. The plugin's
insert-into-OpenCode behavior stands as the phase-two baseline. The
decisions document records each reuse with its trade-off.

## Reference: Handy and what to take from it

Handy is the primary architectural reference: same desktop stack, same
offline promise, same hold-to-dictate shape, an order of magnitude more
field exposure. What transfers, in priority order:

- Supervision behavior as the bar. Load with progress and failure events,
  unload on a configurable idle timeout that never fires mid-recording,
  explicit reload on accelerator change, graceful fallback when the
  accelerated path fails, and honest diagnostics. This holds whichever
  hosting option is chosen.
- Manager separation. Distinct audio, model, and transcription
  responsibilities behind a narrow command and event boundary, with
  transcription history kept as its own concern rather than leaking into
  capture or insertion.
- Model management that respects constrained machines. First-run download
  with honest progress, a models folder that auto-discovers manually added
  models without renaming rituals, and a CPU-optimized model family
  alongside the Whisper family for machines where accelerated inference
  misbehaves.
- Overlay discipline that matches the pill vision. A borderless,
  non-focusable, always-on-top pill in two sizes — compact for recording
  states and larger for live transcription — with throttled loudness
  updates, stale-hide protection so a delayed hide never kills a new
  session, and a documented fallback to no overlay where the overlay would
  steal focus from the destination.
- Insertion honesty. Clipboard-assisted delivery with delayed restoration
  of the previous clipboard, configurable timing for fragile targets, and
  per-display-server tooling where native synthesis is weak — plus remote
  control of a running instance so window managers can own the shortcut
  where global shortcuts are restricted.
- Candidate features for later, not v1: transcription history, a custom
  words dictionary with fuzzy correction, a post-processing toggle with its
  own shortcut, translate-to-English as an explicit option, and audio
  feedback sounds as an overlay substitute.

What explicitly not to copy is scope: history, dictionary, translation,
and multi-engine choice stay out of v1. The reference informs sturdiness,
not breadth.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (stack, architecture sketch, repo layout, open questions)
- Before: `03-product.md`, `04-experience.md`
- Agent target (phase two): `06-agent-integration.md` — the destination abstraction
- Delivery: `07-roadmap.md` — how the structure is built up across milestones
- Open hosting and streaming choices: `08-decisions.md`
- Layout and licensing: `09-repository.md`
