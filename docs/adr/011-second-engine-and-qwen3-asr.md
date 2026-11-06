# ADR-011: A Second Speech Engine and the Qwen3-ASR Model

Status: approved, positioned after the MVP. The product's v1 boundary keeps
multi-engine choice out (`05-architecture.md`), so this record settles the
shape now and places the work after M2 rather than widening v1.

## Context

The reference project offers several speech-model families side by side:
Parakeet, Whisper, Qwen3-ASR and others. The maintainer asked whisperlane to
offer Qwen3-ASR 0.6B as an additional choice, not as a replacement for the
Whisper models it ships today.

The model cannot run on the current engine. Whisper models load from
whisper.cpp; Qwen3-ASR is a different architecture, and the file the reference
project pins is built for transcribe.cpp, a sibling inference library that
carries sixteen model families on the same ggml foundation. Whisper.cpp does
not know that architecture, so an engine decision sits inside the model
decision.

A spike settled the technical questions. It built a minimal companion server
from transcribe.cpp at the reference project's pinned revision, linked the
Vulkan and processor backends the same way, and drove it through the exact
request shape the supervisor already sends:

- The pinned model, a quantized Qwen3-ASR 0.6B file of 850,423,456 bytes with
  a published SHA-256, downloaded, verified, and loaded on this machine.
- The server answered the readiness ping and the multipart inference request
  with the same JSON shape the app already parses, on both backends, with a
  language hint or automatic detection.
- Warm transcription took about 0.12 to 0.20 seconds on clips of 4 to 11
  seconds on the accelerated backend, faster than the shipped Whisper model on
  the same clips; the processor backend ran about four to six times faster
  than real time.
- The accelerated process held about 114 MB of working set after loading the
  model; the processor process about 278 MB.
- The first inference after a launch paid a one-time pipeline cost of about
  3.8 seconds on the accelerated backend, against 2.4 seconds for the shipped
  Whisper engine.
- One contract gap: transcribe.cpp prints no device banner, so the supervisor's
  backend verification had nothing to read; the engine must state its backend
  itself.
- Both engines invent closing phrases on audio that is only silence or noise.
  Capture already ends a take that never rises above its silence floor,
  before an engine is asked; the engine-level test deliberately bypassed
  capture and measured only what the models do on their own.

Accuracy is not claimed from this spike. The reference project's per-language
measurements put the shipped Whisper model ahead on Turkish and on most
non-Chinese languages, and Qwen3-ASR ahead mainly on Chinese, Cantonese and a
few others. A small synthetic spot check on this machine agreed on suffixes
but is not a benchmark, and the plan measures a real-take comparison before
the option ships.

## Options considered

For where the engine runs:

- In-process binding of transcribe.cpp in the application core, as the
  reference project does. Closest integration and no second protocol, but it
  puts native inference inside the process the product must keep alive, which
  is the shape ADR-002 rejected on evidence, and it makes every product build
  carry a C++ toolchain and Vulkan headers — the reason ADR-010 fetches a
  prebuilt, pinned runtime at all.
- Teaching the whisper engine the new family. Not possible: whisper.cpp loads
  Whisper architectures only.
- A second companion engine built from transcribe.cpp, behind the same
  request contract and the same lifecycle rules. Keeps ADR-002 and ADR-010
  intact, reuses the supervisor, warm retention, idle unload, crash recovery,
  presence reporting, and the versioned runtime install, and makes the new
  family a model plus a runtime pin rather than a pipeline.
- Migrating every model to transcribe.cpp now, so one engine serves all
  families. Attractive long term, but it invalidates the shipped model's
  quality and packaging the product is measured on, and it turns this
  request into a re-validation of the default path. Deferred, and recorded as
  an open question rather than buried here.

For whether to do it at all:

- Keep the v1 boundary and ship no second engine. This is the option the
  product's own scope preferred: the reference informs sturdiness, not
  breadth. It is declined because the maintainer asked for the option,
  and because the spike showed the cost is a runtime pin rather than a
  pipeline; the record states the boundary and the position instead of
  pretending the boundary moved.

For how the engine reaches a machine:

- Fetch the second engine pair only when the user first chooses the model.
  This keeps every install that never wants the option smaller, at the cost
  of a network dependency at the moment of choosing — the one moment the
  product otherwise wants quiet.
- Carry both engine families in the installer. The engine is not user data,
  ADR-010 already installs the present engine with the application, and a
  model choice should not depend on a second transfer succeeding. The cost
  is roughly 16 MB on every install, paid once. Chosen.

## Decision

A second engine family ships as two single executables of its own, one per
backend, built from the pinned transcribe.cpp sources with the static MSVC
runtime. The pair is built and published by a companion build repository of
its own, in the same shape as the existing engine repository
(`fahrim/whisper-vulkan-win`), and fetched at build time as a pinned archive
with a reviewed digest: tag and digest are recorded in the fetch script, the
archive's staged files are verified, and a missing or unverified archive
fails the build. Each executable is smoke-launched before release. The new
repository is recorded in the repository document when it is created.

The import allowlist follows ADR-010 and the measured import tables: the
processor executable imports Windows components only, and the accelerated
one adds the Vulkan loader. The spike's build linked no OpenMP runtime, so
the pair ships with no companion DLL; ADR-010's shipped-file category stays
available for the Whisper pair's own runtime.

The engine families live side by side. ADR-010's versioned runtime layout
extends to one pointer per family: `runtime\current` stays as it is, and the
new family's pointer is `runtime\current-transcribe` beside it, written
through its own temporary file and renamed into place exactly as ADR-010
requires. Each pointer keeps its own pruning, so an upgrade of one family
cannot disturb the other. The supervisor chooses the family from the selected
model's runtime and keeps every existing behaviour for both: lazy launch on
the first take, warm retention, idle unload that never fires mid-take, crash
recovery, and one processor attempt when the accelerated launch fails.

The new engine states its backend on its startup line, because
transcribe.cpp prints no device banner. Verification accepts evidence from
either family, and the backend a launch served is recorded in the engine log;
it is not shown on a user surface, per the existing diagnostics decision.

The model catalog gains Qwen3-ASR 0.6B and, with it, a per-model source pin:
repository, revision, exact byte length, and digest. The single source
constant becomes per-model data, because the families come from different
repositories and the digest is stable where this model is pinned. Presence
stays a length question for every model; the pinned digest is checked when a
download is verified, so a transfer that completed with wrong bytes is
reported as incomplete rather than handed to the engine. The missing and
incomplete sentences do not change, and the model row keeps its shape: one
line of what it is doing.

The offered choice speaks honestly. The chooser entry names the model, says
it is a multilingual choice, and adds the download size the fetch already
reports; nothing claims better accuracy than the default, and the plan's
measurement is stated in the release notes rather than implied. The
language chooser keeps the product's existing list and automatic detection;
no per-model filtering is introduced, and the entry's label is what tells a
user the family is multilingual. The product sends no initial prompt or
vocabulary today, so the new family's prompt support stays unused and a
switch loses nothing.

The weights are downloaded, never bundled. Their licence and the conversion
notice join the project's third-party notices, beside the existing attribution
for the runtime.

Not in this decision: the in-process binding, replacing or retiring the
Whisper engines (recorded as an open question), vocabulary or prompt support
for the new family (the product has no such feature today), a speech detector
for silence and noise (a mid-clip noise report would be its own question, now
recorded as open), and any platform other than Windows.

## Consequences

- A user can pick a multilingual family without the pipeline, the pill, the
  tray, the delivery seam, or the model row changing shape. The choice is one
  catalog entry and one runtime family.
- The installed runtime grows by one engine pair: roughly 12 MB for the
  accelerated executable and 4 MB for the processor one, before compression,
  on top of the existing pair's roughly 49 MB. No model weights are bundled.
- The first take after a launch pays the new engine's pipeline warm, about a
  second and a half more than the shipped engine. The plan's hardening slice
  measures whether a short prewarm removes it; if the measurement says yes,
  that is its own small proposal, not a silent change to this record.
- Two engines mean two pins, two smoke launches, and two import allowlists to
  maintain. The pinned upstream revision is the reference project's own, so a
  shared fix can be adopted deliberately rather than chased.
- A model switch can change the engine family; the supervisor restarts the
  running engine under the same rules it already applies to a model reload.
- The whisper engine keeps its short-path workaround for model paths with
  spaces and non-ASCII characters; the new engine receives its arguments
  directly and needs none. The workaround stays because the first family still
  needs it.
- The model presence check stays cheap enough for the status poll; verifying
  the digest happens on a verified download, not on every status read.
- The product's tests gain a contract test for the second engine, a banner
  test for the new family, and an engine-selection test at the supervisor
  seam. Audio behavior itself remains the maintainer's manual verification,
  as the loop requires.
- Licensing obligations for the weights and the conversion are recorded in the
  project's notices, and the runtime's own licence is stated beside it.
- The MVP is not widened: this work lands after M2, and the plan states so.

## Related

- Source plan: `../plan/pre-start-intro-plan.md` (stack and architecture sketch)
- Engine hosting: `002-engine-hosting.md`
- Model default and download: `006-model-default-and-download.md`
- Runtime packaging and diagnostics: `010-runtime-packaging-and-diagnostics.md`
- Proposal and evidence: `../08-decisions.md` item 19
- Implementation plan: `../plan/qwen3-asr-option.md`
- Architecture: `../05-architecture.md`
- Experience: `../04-experience.md`
- Product scope: `../03-product.md`
- Delivery: `../07-roadmap.md`
- Repository and licensing: `../09-repository.md`
