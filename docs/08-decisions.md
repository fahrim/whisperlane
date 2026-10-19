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

Outcome: the check was run on 14 October 2026 and the name stands.

Package registries are unclaimed: the name is free on npm, on crates.io
and on PyPI. No desktop dictation or transcription product uses it —
the neighbouring products all sit under different names, and the crowded
part of the space is the whisper-prefixed names rather than this one.

The domains are held, by unrelated businesses, and all of them write the
name as two words rather than one: a wellness studio, a wellness shop and
an investment firm. None is in software.

Two things are noted rather than resolved, because neither is a barrier
to packaging. The first word is part of a well-known model family name,
so a trademark filing would have to be argued in that neighbourhood
rather than assumed. And the name arrives spelled with an extra letter in
the brand kit as supplied; the maintainer confirmed that was a slip, and
the kit now spells it as the product does.

A professional trademark search is still outstanding and is not something
a registry lookup can stand in for. It matters before a public launch,
not before a milestone build.

Decision: the name stays. Packaging identity follows it.

Status: resolved — no ADR; a name that changes nothing about how the
product behaves does not need one.

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

## 9. What the chord does from a finished state

Context: the experience document requires that a terminal state — done,
failed, cancelled — returns to idle in one action, and the M0 skeleton
implemented that as a button. It never says what the chord itself does
once a take has finished. In the M1 build the chord does nothing there:
the user must reach the window, press the button, and only then can they
dictate again. The transition table also makes the path strict, so a
finished take cannot start the next one directly.

That matters more at M1 than it did at M0, because dictation is now
inserted at a real destination and back-to-back takes are the normal
case: people dictate a sentence, then a second one, without moving the
mouse.

Options:

- The chord does nothing from a terminal state and the user must reset
  first, by button. Keeps every state transition explicit and the
  pipeline strictly ordered, at the cost of an extra, invisible-feeling
  step before the next take.
- Terminal states fall back to idle on their own after a short pause.
  The chord then always works, but the transcript disappears on its own
  before the user has had a realistic chance to read it, which loses the
  honesty the terminal state exists to provide.
- The chord starts a new take directly from a terminal state. One key,
  from any state, with the previous transcript still visible until the
  new take replaces it.

Trade-offs: the first two make the state machine strict at the cost of
momentum; the third trades a strict order for a flow that matches how
dictation is actually used. Nothing is inserted twice either way, since
a new take begins from a finished phase rather than from delivered text.

Recommendation: the chord starts a new take from any non-capturing
state, and a terminal state's button remains for reading the transcript
and returning to a quiet idle. Back-to-back dictation should not need
the mouse, and the transcript stays available until the next take
replaces it rather than disappearing on a timer.

Direction: maintainer approved the recommendation, and noted that the
reset control is the seed of the pill's single start and stop control.

Status: approved — see `adr/007-chord-from-terminal-state.md`.

## 8. Visual tokens (accent, surfaces, glow budget)

Context: the external UI brief proposes exact token values for the
liquid-glass direction adopted in the experience document. Values are
proposals until approved; the direction (glass, single accent, glow as
state feedback only, opaque fallback) is already adopted.

Options:

- Approve the proposed values as the v1 token set.
- Approve the direction with adjusted values.
- Defer tokens to the M2 polish milestone and build M0/M1 on unstyled
  structure.

Trade-offs: approving now gives the polish milestone a fixed target;
deferring keeps early milestones free of aesthetic churn at the cost of a
later decision.

Recommendation: approve direction now, lock values at M2 kickoff; record
the locked set in an ADR.

Direction: maintainer supplied the token values and the technique as a
set rather than as loose numbers, and directed the material explicitly:
standard blur glassmorphism is out. The glass refracts before it blurs,
its edge is a specular rim rather than a border, its volume comes from
layered shadows, and its accent light is drawn inside the document
because a CSS backdrop filter can only bend DOM content. The window
itself becomes transparent and frameless and carries empty room around
the pill, so the glow is not clipped at the window border.

Decision: the token set is locked as one unit, held in the interface's
token file rather than as prose, and the pill is built as an accent
layer under a glass layer. Glow stays dimmer at idle than while
recording: the states the user waits on are the ones that earn it.
Opaque fallback and reduced-motion handling are part of the set rather
than afterthoughts. Native desktop blur behind the pill is not included
and belongs to its own decision, because the platform's acrylic differs
across Windows versions.

Status: approved — see `adr/009-liquid-glass-tokens.md`.

## 10. What the pill's single control does

Context: the experience document gives the pill exactly three elements —
a live signal, "a single start and stop control for mouse-driven use",
and a three-dot options control. ADR-004 closes the discard gesture as
Escape, "with the same action available from the pill's stop control so
mouse-only use is covered", and states plainly that stop delivers while
Escape always throws away.

Read together, the two leave one case undefined. If the pill's stop
control delivers, ADR-004's requirement that the discard path be
reachable without the keyboard is unmet. If it discards, a mouse-only
user can start a take and throw it away but has no way to deliver one at
all, which is a worse exclusion than the one the ADR set out to remove.

Options:

- Press and hold to talk, release to deliver, and a click on the control
  during a live take discards. Both documents hold: the control starts
  and stops as the experience document says, and the click is the
  mouse's Escape, so the discard path needs no keyboard. The gesture is a
  mouse analog of the chord rather than a new idea, but no document
  states it.
- The pill's stop control discards, and delivery stays on the chord.
  The plainest reading of ADR-004 and the fewest gestures, at the cost of
  leaving a mouse-only user unable to deliver a take.
- The pill's stop control delivers and Escape remains the only discard.
  Satisfies the experience document's wording, but withdraws the
  keyboard-free discard ADR-004 approved, so that ADR would need
  amending.
- Two controls on the pill, stop and discard. Leaves the discard
  reachable with no ambiguity, but spends the one thing the pill's design
  refuses: surface area.

Trade-offs: the first keeps both documents true and costs one learned
gesture, hold versus click, on a control the user touches once. The
second and third each satisfy one document by overriding the other, and
the second leaves a real capability gap. The fourth buys certainty with
exactly the chrome the pill's restraint exists to avoid.

Evidence from the M2 build: this is the only part of the pill the written
documents do not already fix. Everything else — borderless, never
focusable, always above the destination, three elements, every state
legible from the pill alone — is stated and needs no ruling. Choosing a
gesture here would be deciding silently, which is what this list exists
to prevent, so the pill slice stops until it is settled.

Direction: maintainer rejected hold-to-talk on the pill as
uncomfortable on a desk, and directed the established Windows dictation
standard instead. Stop delivers and cancel discards on every input
path: the pill's main control starts a take and becomes stop, clicking
it ends the take and delivers it, and discarding is a contextual cancel
action present during a live take or reached by right-clicking the main
control. The chord is a press measured at 250 milliseconds: under it
starts a take a second press stops, at or over it stops on release, and
Escape always discards.

Direction, during M2 polish: the control was given the chord's rule from
a finished state and the cancel was made visible for the whole live take.
The reasoning for both is in `adr/008-pill-control.md`; neither changes
what stop, discard, or deliver mean.

Decision: the pill keeps its three elements and gains no permanent
fourth; the cancel is contextual and only present while a take is live.
The mouse and the keyboard express the same three intents through the
same decision table in the core, so neither can drift from the other.

Status: approved — see `adr/008-pill-control.md`, which amends
`adr/004-cancel-gesture.md` and extends `adr/007-chord-from-terminal-state.md`.

## 11. Where the transcription runtime comes from, and what pins it

Context: the packaging slice found that the engine was never shipped. The
installer carried the application and nothing else; the transcription
runtime existed only on the machine that had built it. A fresh install
opened its window, recorded a take, and had nothing to transcribe it with.

Options: commit the engine binaries; build the engine as part of every
product build; or fetch a published build at build time.

Trade-offs: committing the bytes makes the build hermetic and the
repository heavy, and puts a third-party binary under this project's
version history. Building the engine on every product build makes the
build slow and fragile — it needs the Vulkan SDK and a toolchain most
contributors do not have. Fetching keeps the repository light and the
provenance honest, and makes the pin a single thing to change.

A fourth option existed and was rejected on fact: upstream publishes
Windows builds for CPU and CUDA, and nothing for Vulkan. The Vulkan
backend was written for this project and is published as its own
repository, built in CI from unmodified upstream sources.

Decision: the runtime is fetched at build time from that repository,
pinned by tag, and checked against a published digest before anything
uses it. The build fails rather than continuing without it, because a
build with no engine produces an installer that cannot work.

Changing the pin is a deliberate act rather than a version bump: the
engine is the one component where a surprise is a wrong answer rather
than a crash.

Status: approved — recorded here rather than in an ADR because it
constrains the build, not the product's behaviour.

## 12. How the name is written, and where

Context: the packaging slice found the application listed in Windows in
lower case, among entries like Steam and Notepad that Windows sorts
together and reads at a glance. A lower-case entry among them looks like
something that arrived by accident rather than something a person chose.

Options: write the name in one case everywhere; capitalise only where the
operating system displays it; or capitalise everywhere and change the
brand to match.

Trade-offs: one case everywhere is the simplest rule and the one most
software follows, but it puts the product's own spelling at the mercy of
a convention aimed at installers. Capitalising everywhere cannot actually
reach one case, because the data directory is keyed on an identifier that
stays as it is; changing that would move several hundred megabytes of
already-downloaded models on a user's machine to fix a letter.

Direction: the reference project's installers declare a capitalised
product name while their downloads are published in lower case. That is
the split adopted here — the name the operating system shows is
capitalised, the name the brand uses is not.

Decision: the packaging manifest declares the name in the capitalised
form, and every place the product speaks for itself keeps its own
lower-case spelling — the window title, the tray, the settings file, the
documentation. The identifier is untouched and remains the stable,
machine-facing name.

Known constraint, carried forward: this is safe on Windows only because
the filesystem and the registry are both case-insensitive there, so the
change of case moved nothing. On a case-sensitive filesystem the same
edit would leave the old install directory behind and quietly break
upgrades. Every platform added from the wider milestone onward must be
checked against this before inheriting the convention, rather than
assuming it travelled.

Status: approved — recorded here rather than in an ADR because it
constrains the packaging, not the product's behaviour. Extends item six,
which settled the name itself.

## 13. The window's own surface, and what stays locked to the pill

Context: item eight locked the liquid-glass token set and placed it in the
pill. The settings window is a different kind of object from the pill, and
the set does not transfer to it. Glass is a material for a small floating
surface and its values are chosen against a dark backdrop; a large calm
plane has to stay readable in a light room, which a palette built to read
as glass on darkness cannot do. The window also needs things the pill has
no use for at all — a light theme, a warning colour, and one filled action
— and a warning colour is exactly what the pill's recording accent would
supply if the boundary were not drawn: the same red would then mean both
"something went wrong" and "it is listening".

Options: extend the glass set to cover the window; merge everything into
one token file; or give the window its own surface and palette and keep
glass where it was locked.

Trade-offs: extending the set would put a dark glass palette on a window
that has to survive daylight, and merging would make every later colour a
negotiation between two surfaces that want opposite things. A separate
palette costs the discipline of keeping rhythm, radii, and motion easing
in step, and that is a real cost; it is paid for by the shared file
remaining the single home of everything genuinely shared.

Decision: the window carries its own surface and its own palette, and the
pill's glass stays locked to the pill. Anything about colour or material
is defined once, for the surface that owns it. What is genuinely shared —
spacing rhythm, radii, motion easing — still comes from the token file, so
the two read as one product rather than as two stylesheets.

The window follows the system theme live, with the user's own choice as an
override. Following the system is expressed as having no opinion at all
rather than as a third dark variant, which is what lets switching to it
take effect without a reload.

Status: approved — recorded here rather than in an ADR because it extends
item eight's lock rather than replacing it.

## 14. Starting with Windows is asked, not assumed

Context: the chord is the product, and a dictation tool that is not running
cannot be dictated to. Without a way to have it start, every session began
with finding and launching it first — a step that has to happen at exactly
the moment the user wants to speak.

The preference cannot simply be assumed either. Registering an application
to start with the machine is an act on the user's computer that they did
not ask for, and the failure it prevents is invisible rather than loud:
nothing happens at all, which is indistinguishable from the product being
broken.

Options: register by default and let the user turn it off; never register
and leave it to be found; or ask once, on first run, as an answer the user
has to give.

Trade-offs: defaulting on gets the product working from the first login
and silently edits the user's machine to do it. Never registering keeps the
machine untouched and leaves the product failing quietly at the worst
possible moment. Asking costs one question on a screen the user is already
reading, and is the only option that neither edits their computer nor
leaves them to find the switch themselves.

Direction: the maintainer directed that the question is required on first
run, that it says the answer can be changed later, and that the answer
remains reachable afterwards.

Decision: asked once, as a required answer on the first-run screen, with a
setting in the window that opens it. It is asked as two answers rather than
as a toggle, because a toggle resting at a default is an answer nobody
gave, and the screen is not finished until one of the two has been chosen.
Someone who already has it registered from a previous install is not asked
again.

The setting reads its own state back from the operating system rather than
from the stored answer. A registration that was refused, or removed by
hand, is shown as what it is, and a refused change leaves the setting saying
what is true rather than what was asked for.

Status: approved — recorded here rather than in an ADR because it
constrains a preference, not the product's behaviour.

## 15. The model download is asked for, never started on its own

Context: the first-run screen fetched the model by itself. Opening the
window began the transfer, before the user had answered anything or had
time to read the row describing it. Item four and ADR-006 had settled
that the model is fetched on demand rather than shipped in the
installer, and the earlier documents described first run with the model
"arriving quietly in the background"; the build read both as licence to
start the transfer at the first opportunity. That spends half a
gigabyte of the user's bandwidth without asking, at the moment they have
only just met the product. The same path failed honest transfers in the
other direction: its deadline measured the whole request rather than the
progress being made, so a slow connection was reported as a broken one
instead of being allowed to finish.

A follow-up report asked what happens when the user leaves the first run
without the model. The answer was honest but late: the first take failed
with a message saying the model was not downloaded, after a screen that
had every chance to ask for the fetch and never did — its one action
finished the introduction over an install that could not dictate, and
left the user to find the model on a settings row they had never been
shown.

Options: start the fetch as soon as the first-run window opens, so the
model is ready soonest; state what is missing and fetch it only when the
user asks, through one control on the row; finish the first run only
once the model is on disk, with the fetch carried by the screen's own
action; offer a way past the screen without the model; or ship the model
in the installer so no fetch is needed at all.

Trade-offs: fetching on open reaches the first take soonest and spends
the user's bandwidth without asking. Fetching on request keeps that
decision with the user and costs one deliberate click before the first
take. Fetching on request through the screen's own action costs the same
click and adds no other decision, but it withholds the finish until the
model exists — offline, the fetch can only be retried or the window
closed, since without the model the application cannot take a word
anyway. A way past the screen without the model would keep settings
reachable offline, but it finishes the introduction over an install that
fails its first take, which is exactly the report that prompted this
question. Bundling removes the fetch entirely at the size of the
installer, which item four already declined.

Direction: the maintainer, reporting the first-run experience, directed
that nothing is downloaded unasked: the row says what is missing and
offers the one control that fetches it, and the same control lives on in
settings for every later fetch. On the follow-up report the maintainer
directed that the first run cannot be finished without the model — there
is no "continue without it" path — and that the model is offered there
with the same chooser settings uses.

Decision: no transfer begins without a user action. Opening a window
never starts a download, and a model that is not on disk is shown as
missing; a take that needs it fails with a plain message saying the
model is not downloaded and where to fetch it, rather than the
application quietly starting a transfer, as ADR-006 already requires.
The message says where to fetch rather than naming the file: it has to
survive the pill's width, and the settings row already shows the chosen
model by name. Choosing a model says which model rather than
starting a transfer: fetching is its own act behind its own control.
Once a fetch is asked for, it stays honest in the other direction too:
progress is bytes over total, a transfer that stops making progress
fails with a plain message instead of hanging, and one that is merely
slow is allowed the time it needs.

On the first run that one control is the screen's own action, because
the first run has nothing else to finish with: while the model is
missing the action is the fetch, while the fetch runs the action's own
place carries its progress, and the action becomes starting to talk only
once the model is on disk. In settings the control stays on the row that
says what is missing, as directed; only the first run moves it onto its
own action. The model is chosen there with the same chooser settings
offers, and the screen is not finished without it: a dictation tool with
no model cannot take a word, so the one way past the screen without
fetching is closing its window, which does not finish the first run and
shows it again on the next launch. A failed fetch is named beside the
model it belongs to and retried from the same action.

The resting surfaces follow the same rule as the screen. The pill's
resting line and the tray's status line say ready only once the model is
on disk: a missing model is named rather than passed off as readiness,
and a model on its way is shown as the working state. A take that finds
no model says the same sentence on the pill, so whichever way the user
learns it the install never claims a readiness it cannot keep. The tray
says it in its own shorter words, and its mark follows its line, because
a line read at a glance and a mark read sooner than that must not
disagree.

Status: approved — recorded here rather than in an ADR because it
tightens item four's on-demand fetch rather than replacing it. Direction
from the maintainer on a first-run report, extended on a later report
that the pill and the tray claimed readiness over an install with no
model.

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
`adr/005-text-insertion-windows.md` (item 3), `adr/006-model-default-and-download.md` (item 4),
`adr/007-chord-from-terminal-state.md` (item 9), `adr/008-pill-control.md` (item 10),
`adr/009-liquid-glass-tokens.md` (item 8).

## Related

- Source plan: `plan/pre-start-intro-plan.md` (open questions, architecture sketch)
- Architecture: `05-architecture.md`
- Roadmap spikes: `07-roadmap.md`
- Agent scope: `06-agent-integration.md`
- Repo rules for recording decisions: `09-repository.md`
