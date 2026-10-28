# Repository — Layout, Licensing, Contribution, and Shipping

## Layout

The repository separates concerns so the product structure is visible from
the top level: the desktop application holding the interface and the native
core, optional shared native libraries for audio, transcription, and
insertion concerns, project documentation with the plan folder as the
origin, root-level project files including the readme and licensing texts,
the workflow definitions that check and publish the application, and the
manifests that carry a release into package managers. The
exact directory names are settled with the first milestone scaffold; this
document is updated then, and the documentation index points to it.

## Version control status

The repository is under version control. History begins with the approved
documentation and the two canonical license texts, and no history is
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
- The name is written in two places on purpose. What the operating system
  shows the user — the installed application, its shortcut, its entry in
  the installed-programs list — carries a leading capital. What the product
  says for itself — its window, its tray, its settings file, these
  documents — keeps the lower-case spelling the brand uses. Neither form
  is a typo of the other, and a change that moves one toward the other is
  a change to the decision rather than an edit. The rule and the reason
  are recorded in the decisions document; the constraint that makes it
  safe only on Windows is recorded with it.
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

Release automation plan: semantic version tags as the single trigger,
signed Windows builds with updater signature verification following the
reference product, draft releases that are verified before publishing, and
a changelog drawn from milestone acceptance rather than reconstructed
memory. The machinery now exists as two workflow definitions under the
repository's workflow directory, and the loop they close is: bump,
changelog, tag, build, draft, verify, publish. The publishing one takes a
version tag as its only trigger, reads the version back out of the
manifests, refuses to build when the tag and the manifests disagree, runs
the checks again, signs the installer with the updater key held as a
repository secret, writes the update manifest the application reads before
it decides to download anything, and leaves the result as a draft that a
person opens and checks before it is announced. One piece of the plan is
still open: the release notes are the platform's generated notes rather
than a changelog drawn from milestone acceptance.

The update itself is asked for rather than pushed; the decision and its
open end are recorded in `08-decisions.md` item 16.

Releases reach users two ways: the installer on the release page, and
package-manager manifests kept under `packaging/`. The winget manifests are
submitted upstream; the scoop manifest is published from its own bucket.
Both pin the installer's checksum, so a package manager cannot install a
different file from the one the release published.

## Continuous integration

Every push and every pull request is checked on Windows, because the
product is Windows: a green run on another operating system would say
nothing about it. The checks are the ones that hold without a microphone
and a machine: the manifests are read to confirm they agree on the
version, the readme is read to confirm it points at assets that exist, the
interface is typechecked and built, and the native core is linted and
tested. The publishing workflow runs the same checks before it builds, so
a tag that cannot pass CI cannot become an installer.

Releasing therefore needs one secret that is not in the repository: the
matching private key for the updater's public key, which lives in the
repository's secrets. Losing it does not break the release being cut; it
breaks the next one, because an installed application will not accept an
update signed by a key it was not built to trust. The public key is in the
application configuration and is safe to publish; rotating it is a
one-time break with every install that shipped before the change.

## Related

- Source plan: `plan/pre-start-intro-plan.md` (licensing, proposed layout)
- Map: `README.md` in this folder — reading order and document purposes
- Scope and sequence: `03-product.md`, `07-roadmap.md`
- Structure: `05-architecture.md`
- Decision process: `08-decisions.md`, `adr/`
