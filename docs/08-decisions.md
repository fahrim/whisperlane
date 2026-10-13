# Decisions — Open Questions, Options, and ADR Process

Open questions are recorded here with options, trade-offs, and a
recommendation. Nothing here is decided until explicitly approved. Approved
outcomes become Architecture Decision Records under `adr/`.

Evidence from the existing dictation plugin and from competitor defaults now
informs every recommendation below. Status of every item remains open until
approved.

## 1. Speech engine hosting: in-process versus companion service

Context: the architecture needs the local speech engine either bound
directly into the core or running as a companion local service that the
core talks to. Two proven references now inform this choice from opposite
sides. The existing plugin runs a local transcription service that starts
on demand, stays warm while in use, unloads after a ten-minute idle
period, and never stops a server instance it did not start. Handy, the
reference open-source product on the same desktop stack, keeps inference
inside the application but isolates the crash-prone native speech path in
a supervised worker: accelerated Whisper-family inference lives behind a
supervisor with crash and hang recovery, while smaller CPU-optimized
models run directly in process. Both ship the same lesson: never let a
native speech failure take the application down with it.

Options:

- In-process binding. Closer integration, potentially simpler packaging and
  distribution as a single unit.
- Supervised in-process worker, following Handy. Native inference stays in
  the application family but behind a supervisor with load, unload, reload,
  idle-unload, and crash-recovery behavior, plus per-device backend
  selection.
- Companion local service, following the existing plugin. Proven
  on-demand lifecycle and verified backend walk from accelerated NVIDIA to
  Vulkan for AMD and Intel to CPU, verifying each candidate by actually
  launching it rather than trusting file presence. Lets the existing
  accelerated Windows build ship largely as-is; keeps model hot-swap and
  process isolation most natural.

Trade-offs: the service path reuses what works today at the cost of
managing a second process and its lifecycle. The supervised-worker path
matches the reference product most closely at the cost of building the
supervision behavior the plugin already has in simpler form. Plain
in-process is simplest but offers no isolation when native inference
misbehaves on unusual hardware, a failure mode the reference product
documents extensively around graphics device enumeration.

Recommendation: companion local service for the early milestones, reusing
the proven on-demand lifecycle and verified backend walk; carry the Handy
supervision requirements — idle unload that never fires mid-recording,
explicit reload on accelerator change, graceful CPU fallback, and a
diagnostics path — as acceptance behavior regardless of hosting.
Responsiveness while an agent runs alongside is a phase-two acceptance
item. Revisit supervised in-process once packaging demands it, with a
spike.

Status: approved — see `adr/002-engine-hosting.md`.

## 2. Streaming versus record-then-transcribe

Context: takes can be transcribed incrementally as speech arrives or as a
whole once capture ends. The existing plugin uses record-then-transcribe:
capture as mono speech-grade audio, normalize quiet input toward a healthy
level without amplifying silence into noise, wrap the take for handoff,
and transcribe once capture ends.

Options:

- Record then transcribe. Simpler, more accurate per take, easier to reason
  about cancellation and insertion. Matches proven behavior.
- Incremental streaming. Lower perceived latency, higher complexity in
  partial results, correction, and insertion timing.

Trade-offs: streaming feels faster but complicates every downstream step.
Record-then-transcribe is honest and predictable but may feel slow on long
takes.

Recommendation: record-then-transcribe for the early milestones, reusing
the proven capture, gain, and handoff shape. Revisit streaming only with
measured latency pain and a prototype.

## 3. Text insertion per operating system

Context: each platform inserts text differently and asks for permissions
differently, with real reliability and trust consequences. The v1
acceptance target is everyday focused applications on Windows; the
terminal hosting an agent prompt becomes an acceptance target in phase
two. The existing
plugin inserts into the focused composer when reachable and otherwise falls
back to the clipboard with an honest notice rather than dropping text
silently. The desktop product generalizes this pattern to any application.

Options (per platform evaluation):

- Windows: system-level input synthesis as the primary path, with
  clipboard-assisted fallback that tells the user what happened.
- macOS: platform event synthesis with explicit accessibility permission.
- Linux: the available synthesis mechanism per display server, with
  fallbacks where required.

Trade-offs: native synthesis is invisible when it works and fragile across
targets when it does not. Clipboard-assisted or target-specific paths may
be more reliable in narrow cases but less general.

Recommendation: adopt native synthesis as primary with the proven honest
fallback everywhere; verify everyday Windows targets in v1 and add the
terminal-agent destination to the matrix in phase two; evaluate per
platform with a reliability matrix across representative targets before
committing; record the chosen primary and fallback per platform in an ADR.

Status: approved — see `adr/005-text-insertion-windows.md` (Windows; the
other platforms arrive with M3).

## 4. Which models ship and which is the default

Context: model size trades accuracy against download size, memory, and
speed, especially on left-behind hardware. The existing plugin ships a
turbo-class large model in a quantized form at roughly half a gigabyte,
passes the spoken language explicitly by default, captures at speech-grade
mono sample rate with a hard per-take cap, and treats unknown settings as
ignorable rather than fatal.

Options:

- Turbo-class default with optional larger downloads, language pinned by
  default with auto available as an explicit choice, download-on-demand
  with honest progress.
- Small default with optional larger downloads.
- Download-on-demand only, with no bundled model.

Language selection: the chooser offers the common pinned languages plus an
explicit auto-detect entry. Pinned is the default because auto-detection on
the Whisper family costs roughly double the time and misreads some
languages; auto stays available for mixed-language use and for engine
options whose auto-detection is stronger. The choice is never written over
silently when switching models.

Trade-offs: bundling simplifies first run at the cost of installer size.
Download-on-demand keeps the installer small at the cost of first-run
waiting, which must then be honest and non-blocking.

Evidence from the existing plugin: turbo-class quantized model at roughly
half a gigabyte, pinned language default, speech-grade mono capture with
a hard per-take cap, and tolerant settings handling. The M0 skeleton
follows this shape provisionally.

Direction: maintainer set the skeleton language default to `auto`
despite the ~2x cost; revisit with measured latency pain.

Recommendation: turbo-class quantized default with larger models as
explicit opt-ins, tolerant settings handling, and the proven capture
shape; confirm against early milestone hardware measurements.

Decision: the turbo-class quantized large model is the default and
models become a choice in settings, downloaded on demand with honest
non-blocking progress. The language default stays `auto` per maintainer
direction, with pinned languages as an explicit choice.

Status: approved — see `adr/006-model-default-and-download.md`.

## 5. Optional cleanup: rules, small local model, or none

Context: the product allows light local cleanup of punctuation and filler,
never rewriting meaning. The existing plugin performs no meaning
rewriting at all: its only signal work is input-level gain toward a usable
level with honest user feedback, plus a live loudness meter that costs
nothing extra because it reads the stream already being captured.

Options:

- Rule-based cleanup only.
- Small local model assistance.
- No cleanup at all in v1.

Trade-offs: rules are predictable and cheap but limited. A small model may
read better but risks meaning drift and new failure modes. None is the
simplest and most honest, at the cost of rougher raw transcripts.

Recommendation: ship v1 with rules-only or none, default off, keeping the
proven input-level gain and meter behavior; treat any
model-assisted cleanup as a later, explicitly approved option.

## 6. Name, packaging identity, and collision check

Context: the project name must survive domains, package registries, and
trademark scrutiny.

Options: keep the current working name and verify availability across
domains, package names, and marks; or rename early if any collision is material.

Trade-offs: renaming now is cheap; renaming after release is expensive.

Recommendation: run the availability and collision check before M2
packaging; record the outcome here.

## 7. Default hotkey

Context: the whole product hinges on one key interaction, but the default
must not collide with platform, terminal-emulator, or common application
shortcuts. Agent and terminal-agent bindings join the collision check in
phase two.
Per direction, the default follows the most established competitors rather
than inventing a new gesture.

Competitor picture on Windows:

- The open-source benchmark holds its key to dictate and releases to
  insert, defaulting to Control plus Space, with toggle as a setting.
- The leading commercial flow holds Control plus the platform key to
  dictate and uses Control plus platform key plus Space for hands-free,
  with double-tap as an alternate hands-free path.
- The premium Mac-first tool uses Option plus Space for toggle and lets one
  shared key serve both behaviors: hold to dictate, tap to toggle.

The shared pattern is a Space-based hold-to-dictate with tap-to-toggle on
the same binding. The existing plugin differs with a Control plus Y
default and a small list of alternates; that history is kept as
configurable choices, not as the new default.

Options:

- Control plus platform key held to dictate, with Control plus platform
  key plus Space for hands-free. Follows the commercial Windows
  convention; avoids the autocomplete and input-method collisions of
  Control plus Space.
- Control plus Space held to dictate. Follows the open-source benchmark;
  familiar, but collides with autocomplete and input-method switching in
  editors on Windows.
- Keep the plugin legacy default. Avoids all collisions but teaches
  nothing from the market.

Trade-offs: familiarity aids adoption; collision-avoidance decides whether
that familiarity survives contact with editors and input methods.

Recommendation: default to hold Control plus Shift plus Space for
push-to-talk with tap on the same binding acting as toggle, plus the
hands-free combination above as the explicit alternate — the shared
competitor behavior in Windows form, with Shift avoiding the Control plus
Space collisions. Keep the binding user-configurable from the first useful
milestone, with the legacy plugin choices retained as alternates.
Microphone selection stays ask-on-first-press so no setup stands between
install and first dictation.

Evidence from the M0 skeleton: the bare Control plus platform key proved
undeliverable in practice — the chord is expressible, but the machine
underneath it did not produce the two modifiers together. The chord also
has to survive the desktop shell: its own window being focused starved the
global hook entirely, which the device event filter setting fixes.

Status: approved — see `adr/001-default-hotkey.md`, amended by
`adr/003-device-event-filter.md`.

## 8. How the user discards a take

Context: the experience document requires cancellation — the user
discards the take at any point before insertion, nothing is inserted,
and the application returns cleanly to idle in one action — and
toggle-to-talk, where a tap starts and a tap stops. Neither document
names the gesture for discarding. The chord is already taken by
starting and stopping, so cancellation cannot be a third state of it
without making the chord's meaning ambiguous.

Options:

- The Escape key discards a live take, during capture and while
  transcription runs, and the pill offers the same as its stop control.
  Universal on Windows, available without leaving the destination
  application, and reachable from the mouse through the pill.
- Pressing the chord again discards instead of stopping. Reuses the one
  gesture the user already knows, but overloads it: the same press means
  stop in one moment and discard in the next, with no way to tell which
  before pressing.
- A discard control on the pill only. Works for mouse users, and fails
  entirely for keyboard-only dictation, which is the primary gesture.

Trade-offs: Escape adds one gesture to learn but keeps every meaning
single and reversible-looking: stop still delivers, Escape always
throws away. Reusing the chord keeps the gesture count minimal and
makes a mispress indistinguishable from an intended stop. A pill-only
control is discoverable but excludes the main input path.

Evidence from the M1 build: with the chord reserved for start and
stop, the discard action needs a signal of its own. Escape is
swallowed only while a take is live, so it remains ordinary typing
everywhere else, and a cancelled take is never delivered: a
transcription result that arrives after a discard is dropped rather
than pasted.

Recommendation: the Escape key discards a live take, with the same
action available from the pill's stop control so mouse-only use is not
left out. Stop delivers and Escape discards, always.

Status: approved — see `adr/004-cancel-gesture.md`.

## ADR process

- A decision becomes an ADR only after explicit approval of the
  recommendation or an alternative.
- ADRs live under `adr/`, are numbered sequentially, and record context,
  options considered, the decision, and consequences.
- This document keeps the open list; ADRs keep the closed record. When an
  ADR lands, the corresponding section here points to it and related
  documents update their Related sections.

ADR index: `adr/001-default-hotkey.md` (item 7), `adr/002-engine-hosting.md` (item 1),
`adr/003-device-event-filter.md` (item 7), `adr/004-cancel-gesture.md` (item 8),
`adr/005-text-insertion-windows.md` (item 3), `adr/006-model-default-and-download.md` (item 4).

## Related

- Source plan: `plan/pre-start-intro-plan.md` (open questions, architecture sketch)
- Architecture: `05-architecture.md`
- Roadmap spikes: `07-roadmap.md`
- Agent scope: `06-agent-integration.md`
- Repo rules for recording decisions: `09-repository.md`
