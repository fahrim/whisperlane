# Repository — Layout, Licensing, Contribution, and Shipping

## Layout

The repository separates concerns so the product structure is visible from
the top level: the desktop application holding the interface and the native
core, optional shared native libraries for audio, transcription, and
insertion concerns, project documentation with the plan folder as the
origin, and root-level project files including the readme and licensing
texts. The exact directory names are settled with the first milestone
scaffold; this document is updated then, and the documentation index points
to it.

## Version control status

The repository is not yet under version control. Initialization is deferred
until the documentation set is approved, at which point history begins with
the approved docs and the two canonical license texts. No history is
rewritten after that point without explicit agreement.

## Licensing

The project is dual-licensed under MIT or Apache version two, following the
common Rust-ecosystem convention. The two canonical license texts live at
the repository root. Each text is kept byte-for-byte canonical: no appended
notes, headers, or edits, since alterations can cause automated license
detection to fail. Manifests and package metadata record the dual-license
identifier in their license field; documentation never duplicates the legal
texts.

## Contribution guide

- Documentation first. The source plan remains the single source of truth;
  contradictions are resolved explicitly, never by silent drift.
- No document contains source code, configuration, or snippets. Architecture
  is narrated; conceptual diagrams are welcome.
- Documentation is written in English; discussion with the maintainer is in
  Turkish by agreement.
- Every document has one job and ends with a Related section. Adding a
  document means updating the index and the Related sections of affected
  documents in the same change.
- Open questions are never decided silently. They are proposed in the
  decisions document with options, trade-offs, and a recommendation, and
  closed by approval into an ADR.
- Scope discipline holds: keep each document free of filler and repetition,
  but keep the set wide enough to cover vision, audience, product,
  experience, architecture, integration, roadmap, decisions, and repository.

## Test strategy (narrated)

Testing follows the milestones: the skeleton proves the take end to end;
the Windows milestone proves insertion reliability and flow behavior across
representative targets; the polish milestone proves first run, indicator
legibility, and packaging; the wider milestone proves per-platform behavior
without regressing Windows. Emphasis throughout is on observable behavior —
capture, transcription, insertion, cancellation, and recovery — over
internal structure. Hardware-sensitive claims are verified by measurement
on representative machines, not by assumption.

## Release strategy (narrated)

Releases follow the same order as the roadmap: internal skeleton, useful
Windows builds, polished Windows packaging, then the phase-two agent work,
then wider platforms with signing and notarization where required. Each
release states plainly what is included and what remains out of scope.
Licensing texts travel with every distribution.

The repository starts private and turns public at the first release; that
switch is a one-time visibility change, not a code change.

Release automation plan (implemented after the project scaffold exists,
not before): semantic version tags as the single trigger, signed Windows
builds with updater signature verification following the reference
product, draft releases that are verified before publishing, and a
changelog drawn from milestone acceptance rather than reconstructed
memory. Once the scaffold lands, this plan becomes a release skill and a
release command that run the same loop every time: bump, changelog, tag,
build, sign, draft, verify, publish. The plan lives here; the machinery
arrives with the scaffold.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (licensing, proposed layout)
- Map: `README.md` in this folder — reading order and document purposes
- Scope and sequence: `03-product.md`, `07-roadmap.md`
- Structure: `05-architecture.md`
- Decision process: `08-decisions.md`, `adr/`
