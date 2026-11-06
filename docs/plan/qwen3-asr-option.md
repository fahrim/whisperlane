# Plan — The Qwen3-ASR Option and the Second Engine

This plan turns ADR-011 into slices. It is post-MVP work: the v1 boundary
keeps multi-engine choice out, and this plan does not widen it. Everything
here is Windows-only and keeps the terminal agent first.

The evidence is recorded in `../08-decisions.md` item 19 and
`../adr/011-second-engine-and-qwen3-asr.md`: the pinned model, the request
contract, both backends, load and warm timing, working set, the missing
device banner, the silence behaviour of both models, and the reference
project's accuracy research. This plan restates only what it must.

## Slices

### S1 — Publish the second engine pair

Build the accelerated and processor executables from the pinned transcribe.cpp
sources with the static runtime, an import allowlist that admits the Vulkan
loader and the Windows components only, and a smoke launch of each. Publish
them as a tagged archive with a reviewed digest, in the same shape as the
existing engine repository.

Acceptance: both executables start, load the model, and transcribe a sample
on their backend; the import check passes; the archive digest and tag are
recorded for the fetch step.

### S2 — Fetch and install two runtime families

The build-time fetch learns the second archive and stages it beside the first.
The installer carries both. The versioned runtime directory gains one pointer
and one pruning rule per family, the whisper pointer unchanged, so an upgrade
of one family leaves the other alone. A missing or unverified archive fails
the build rather than shipping an installer that cannot honour the choice.

Acceptance: a clean install with the new model selected starts the new engine
from the staged runtime; a failed fetch fails the build; an upgrade of one
family does not disturb the other.

### S3 — Choose the engine at the supervisor

The supervisor picks the family from the selected model's runtime and keeps
every existing rule: lazy launch on the first take, warm retention, idle
unload that never fires mid-take, crash recovery, and one processor attempt
after a failed accelerated launch. Backend verification reads the new engine's
own startup line, records what a launch served in the engine log, and still
shows nothing extra on a user surface.

Acceptance: unit tests cover family selection, the new banner, and the
unchanged unload rules; the maintainer confirms a model switch and a dictation
on each family, and the engine log names the backend that served.

### S4 — A catalog with per-model sources

The catalog stops assuming one source repository. Each entry carries its
repository, revision, exact byte length, and digest; presence stays a length
question for every model, while a verified download also checks the pinned
digest. Qwen3-ASR 0.6B joins as a multilingual choice. Missing and incomplete
sentences and the model row's one-line behavior do not change.

Acceptance: tests cover pin resolution, digest verification, and
incomplete-file detection; the maintainer downloads the new model end to end
and sees honest progress.

### S5 — Honest labels and languages

The chooser entry names the model, says it is a multilingual choice, and
adds the download size the fetch already reports. The language chooser
keeps the product's existing list and automatic detection; no per-model
filtering is introduced in this slice. Nothing claims better accuracy than
the default, and the measurement from S6 is what the release notes say.

Acceptance: copy review passes; the maintainer confirms the settings and
onboarding surfaces show the entry without changing the row's shape.

### S6 — Measurement and hardening

Compare real takes on both families in the maintainer's language and in
English, and record the result honestly; a small sample is not a benchmark
and says so. Measure the first take after a launch and a warm take on both
backends, a longer take than the spike covered, the too-little-graphics-memory
sentence, and behaviour on audio that contains quiet or noisy passages between
speech — the whole-silence case capture already ends before an engine is
asked. If the first-take cost needs removing, propose a prewarm as its own
small decision rather than slipping it in here.

Acceptance: the measurements and their limits are recorded in the release
notes; the failure sentences name what the evidence supports; no take crashes
the app.

### S7 — Notices, manifests, and release

Record the weights' licence and conversion notice beside the runtime's, refresh
the package manifests, and write release notes that say what the option is and
is not. Document updates produced by the slices travel with those slices; S7
closes the ones only a release can settle.

Acceptance: the build and a clean install pass, the notices are present, the
index and Related sections are current, and the release notes read honestly.

## Dependencies and risks

- The upstream revision is the reference project's pin. Adopting a newer one is
  a deliberate, tested change, not a chase.
- Two families mean two pins, two smoke launches, and two import allowlists.
  The cost is maintenance, paid deliberately because the alternatives are an
  in-process engine or a single-family product.
- The installer grows by the second engine pair; no weights are bundled.
- The default path must not change behavior or quality: this plan adds a
  choice and never moves the existing model's row, download, or sentences.
- A model switch may restart the engine; the supervisor's existing rules and
  the pill's states already describe that.
- This work lands after the MVP, so the M2 package does not depend on it and
  can ship without it.

## Related

- Decision: `../adr/011-second-engine-and-qwen3-asr.md`
- Engine hosting: `../adr/002-engine-hosting.md`
- Model default and download: `../adr/006-model-default-and-download.md`
- Runtime packaging: `../adr/010-runtime-packaging-and-diagnostics.md`
- Architecture: `../05-architecture.md`
- Experience: `../04-experience.md`
- Delivery and milestones: `../07-roadmap.md`
- Repository, licensing, shipping: `../09-repository.md`
- Source plan: `pre-start-intro-plan.md`
