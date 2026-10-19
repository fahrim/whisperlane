# ADR-006: Model Default and Download

Status: approved.

Amended by `../08-decisions.md` item 15: choosing a model only says
which model — fetching is its own act behind its own control — and the
take's missing-model message says where to fetch rather than naming the
file, which the settings row does.

## Context

The pipeline needs a speech model present before a take can be
transcribed, and the milestone requires that download and readiness are
honest and non-blocking: the user is never stranded without knowing what
is missing. The existing dictation plugin ships a turbo-class quantized
model of roughly half a gigabyte, treats unknown settings as ignorable
rather than fatal, and captures at speech-grade mono with a per-take cap.

The default model was the open half of decision item 4. Language was
settled separately by maintainer direction: the default is auto-detect,
against the recommendation's pinned-language default, because mixed
language dictation is the common case here at a known time cost.

## Options considered

- Small model default with larger models as opt-ins. Fastest and
  smallest download, weakest accuracy, which is the wrong trade for a
  tool whose whole job is getting words right.
- No default, download on demand only. Smallest installer, but the first
  run becomes a wait, which then has to be honest and non-blocking.
- Turbo-class quantized default, larger models as explicit opt-ins, and
  download on demand with honest progress.

## Decision

The turbo-class quantized large model is the default: fast enough for
hold-to-talk, small enough to fetch once, and accurate enough to be the
product's reason to exist. Models are offered as a choice in settings
rather than fixed, and choosing a model that is not on disk downloads it
on demand with honest progress while dictation stays usable throughout.

The language default remains auto-detect per maintainer direction, with
pinned languages available as an explicit choice.

## Consequences

- Readiness is reported, never assumed: the settings surface shows which
  model is chosen, whether it is on disk, and what a download is doing.
- A download never blocks dictation. A missing model fails the take with
  a plain message naming the model, not a silent wait.
- Progress is honest: bytes received over bytes total, and a download
  that fails says so instead of retrying invisibly.
- The default model is the one the skeleton already runs against, so no
  re-verification of transcription quality is needed.
- Smaller models stay available as opt-ins for slower hardware, which
  keeps the left-behind path open without making it the default.

## Related

- Proposal: `../08-decisions.md` item 4
- Engine hosting: `002-engine-hosting.md`
- Behavior: `../04-experience.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`