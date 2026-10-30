# ADR-010: Transcription Runtime Packaging and Startup Diagnostics

Status: approved.

## Context

A clean Windows machine installed the application, recorded a take, and was
told only `transcription service did not become ready`. The engine was there.
It could not start.

The package at the time was a Vulkan `whisper-server.exe` beside `whisper.dll`,
`ggml*.dll`, and the Visual C++ runtime the build happened to link against.
The machine had no Visual C++ redistributable, so Windows refused to load the
process before the engine could print a line. The supervisor waited, then
collapsed every possible cause into one sentence. The engine's own stderr was
discarded, so the evidence that would have named the missing DLL never reached
the log.

Three structural problems sat under that symptom. The runtime depended on a
machine-wide component the installer did not carry. The engine ran from a flat
directory with no version, so an upgrade could overwrite the engine a live take
was using and a failed install could leave a half-replaced one. And the app
launched a separate engine at startup just to read its banner, which cost a
model load and could still record an answer about a machine nothing had been
measured on when a missing model made the probe skip the launch.

## Options considered

For the engine package:

- Keep the DLL layout and make the Visual C++ redistributable an installer
  prerequisite. This preserves the existing build but makes a clean machine
  depend on a second installer succeeding, and a missing redistributable is
  exactly the failure that produced the report.
- Ship the redistributable app-local beside the DLLs. This removes the
  prerequisite but keeps a pile of engine DLLs whose relative loading order is
  part of the product's behaviour.
- Link the C runtime statically and build one executable per backend. This
  removes the redistributable and the DLL boundary together. OpenMP remains a
  separate runtime, but it can be shipped app-local because it imports only
  `KERNEL32.dll`.

For the installed runtime:

- Run the engine from the application's resource directory. This is simplest
  and fails on a per-machine install under `Program Files`, where the user
  cannot write and the engine may need to write beside itself.
- Copy it to the data directory as a flat set of files. This is writable and
  simple, but has no version identity, so two builds cannot coexist and a
  partial copy is indistinguishable from a complete one.
- Copy it to a versioned directory under the data directory and name the
  current version in a pointer. This lets an install finish before it becomes
  current, keeps the previous version while the new one is verified, and makes
  an upgrade a rename rather than a rewrite.

For the pointer:

- A directory symlink. This is the obvious Unix answer and the wrong Windows
  one: creating symlinks needs Developer Mode or elevation, and the product
  must not ask for either to install an engine.
- A plain text file naming the version, written through a temporary file and
  renamed into place. A reader sees the old name or the new one, never a
  half-written one, and no privilege is involved.

For startup:

- Probe the engine eagerly at launch, then start it again for the first take.
  This answers the backend question before it is needed and pays a full model
  load for the answer, while still being able to lie when the probe does not
  actually launch.
- Let the first real launch be the verification. This costs nothing extra and
  makes the reported backend the one that served the take.
- Keep raw stderr in the interface. This is honest in the narrow sense and
  useless in the product's: a loader message is not a sentence a person can act
  on, and it leaks implementation detail into a surface with five controls.
- Keep stderr in a log and show one mapped sentence. This keeps the evidence
  for diagnosis and gives the user a cause they can act on.

## Decision

The engine is published as two single executables, one per backend:

- `whisper-server.exe` carries the Vulkan backend.
- `whisper-server-cpu.exe` carries the processor backend.

Both are built with `BUILD_SHARED_LIBS=OFF` and the static MSVC runtime
(`/MT`). `vcomp140.dll` travels beside them because OpenMP is still the faster
processor path; it imports only `KERNEL32.dll`, so no CRT boundary crosses the
package. The build verifies the staged executables' import tables, not just a
successful compile: a build that reintroduces `vcruntime140`, `msvcp140`, the
UCRT API set, or a `whisper`/`ggml` DLL fails before it can be released. A
smoke launch of each executable is part of the same gate.

The application copies the bundled runtime into
`%APPDATA%\com.whisperlane.desktop\runtime\<pin>\`. The directory is staged
first and renamed into place only when complete. `runtime\current` is a plain
text file containing the pin, written through `current.tmp` and renamed. The
current and previous versions are kept; older ones are pruned after the pointer
moves. The flat files older installs used are removed, but only engine-shaped
files: anything else a person placed there survives.

The pin lives in `scripts/fetch-runtime.ps1`, which fetches the archive by tag,
checks the release's digest and the reviewed digest, and verifies every
required file before it records the pin. `build.rs` always runs that script
rather than deciding for itself that a marker and one executable are enough,
so a moved tag cannot publish a stale runtime. The bundle fails to build if
either server executable is absent.

Startup is lazy. There is no eager probe: the first take launches the engine,
and the banner of that launch is the backend verification. A child that exits
before it answers fails immediately rather than waiting out the timeout. The
timeout is 90 seconds. If the accelerated launch exits or times out, the
processor build gets one attempt in the same run. The engine's stderr is
written to `%APPDATA%\com.whisperlane.desktop\logs\engine.log`, with one launch
header per attempt; the interface shows a sentence mapped from the evidence —
missing DLL, damaged engine files, no compatible graphics device, not enough
graphics memory, model that cannot be loaded, or a timeout — and never the raw
log.

Model presence is checked by exact length, not by the path existing. A
successful download records the verified length in a `.size` sidecar beside the
model; a file that no longer matches that record is reported as incomplete
rather than handed to the engine. A model placed by hand has no sidecar and
falls back to the catalog's published length. Missing and damaged are separate
answers on the pill, the tray, and the model row, because only one of them
means a previous transfer went wrong.

## Consequences

- A clean Windows machine no longer needs the Visual C++ redistributable to
  start transcription. The installer carries both backends and the one runtime
  DLL they import.
- The runtime is larger than the old DLL package in exchange for being
  self-contained: roughly 49 MB staged, before compression.
- Two engine versions can coexist during an upgrade, so a failed install leaves
  the previous engine working. The cost is disk space for one previous version
  until the next install prunes it.
- A Vulkan failure is no longer the end of the take. The processor build is the
  honest floor, and the interface reports which path actually served.
- The settings screen still does not show the backend or its verification
  state. That remains item 17, which is open; this record settles the failure
  sentence, not the diagnostics row.
- Engine stderr is kept on disk for support without being shown to the user.
  The log is rewritten at the start of each start attempt and holds the
  attempts from that cycle.
- The build is pinned to a release tag and a reviewed digest. A runtime upgrade
  is a deliberate change to the fetch script, not a floating download.
- The model row and the resting surfaces can distinguish a missing model from
  an incomplete one, and a redownload repairs an incomplete file instead of
  skipping it because the path exists.

## Related

- Runtime source and pin: `../08-decisions.md` item 11
- Packaging and startup proposal: `../08-decisions.md` item 18
- Backend diagnostics row (still open): `../08-decisions.md` item 17
- Engine hosting: `002-engine-hosting.md`
- Model default and download: `006-model-default-and-download.md`
- Experience: `../04-experience.md`
- Architecture: `../05-architecture.md`
- Delivery: `../07-roadmap.md`
- Engine repository: `https://github.com/fahrim/whisper-vulkan-win`
