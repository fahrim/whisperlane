# Backlog — Where We Left Off

Living file. Updated at every gate: session end, milestone end, and any
scope or decision change. Read this first when resuming work.

## Now

M0 and M1 are complete. The application takes a real take on Windows and
inserts the transcript into the focused application: press the chord,
speak, release, and the words appear where the caret was. M2 is under
way: first run is one screen, the pill carries every state, and the
packaging slice has replaced the engine package that failed on a clean
machine. A review of that slice closed its remaining code gaps; what
stays is clean-VM acceptance.

The published runtime is pinned and verified:
`engine-vulkan-b5454-static` (commit `f984095`) publishes
`whisper-vulkan-win-x64-v1.9.5.zip`, whose reviewed SHA-256 is now the
constant in `scripts/fetch-runtime.ps1`. Both released executables were
smoke-tested with real models and served HTTP 200; the Vulkan one reported
the AMD device. A local NSIS installer built from the final source carries
`runtime\whisper-server.exe`, `runtime\whisper-server-cpu.exe`, and
`runtime\vcomp140.dll`.

The upgrade path is verified against real app data: a flat runtime left by
the previous version was replaced by the versioned directory, the pointer
moved, the locked legacy files were removed once the stale engine exited,
and unrelated files and directories survived. A failed cleanup removal is
now written to the engine log rather than swallowed.

The review of the slice closed what the first pass left open. The app now
stops its own engine on quit instead of leaving it running with the model
loaded — the stale process that held the old flat runtime came from a quit
that never did this. A launch whose banner never reached the log is no
longer recorded as a measured processor. The engine import guard is an
allowlist rather than a denylist, and it reads imports correctly under
Windows PowerShell 5.1 with a Turkish locale, where the old case-insensitive
match silently dropped `ADVAPI32.dll` and `VCOMP140.DLL`. A model download
that declares no length is checked against the catalog instead of the bytes
it happened to receive.

v0.8.4 is published:
https://github.com/fahrim/whisperlane/releases/tag/v0.8.4
The hotfix stops the 0.8.3 upgrade from carrying the old DLL set into the
versioned runtime. The release note lives in `docs/releases/0.8.4.md` and
feeds both the GitHub release and the updater manifest. The NSIS installer
and MSI match `SHA256SUMS.txt`, and the updater artifact is signed. Three
hardening items are tracked as issues: #3 job object, #4 runtime log,
#2 model unload.

The Scoop bucket manifest was updated to 0.8.4. A `scoop.yml` workflow now
updates `fahrim/scoop-whisperlane` on every published release once the
one-time `SCOOP_BUCKET_TOKEN` secret is configured; until then the run
annotates the missing token and leaves the manifest alone. The 0.8.4 tag
predates the workflow, so its bucket update was made by hand.

Still open: clean-VM acceptance against the published installer (no Visual C++
redistributable, first take, offline use, uninstall). The local unsigned
installer remains for offline checks; the published release artifacts are the
ones to distribute.

## Done

- v1 documentation set (docs/01 through 09), index (docs/README.md),
  ADR process (docs/adr/), source plan untouched as truth.
- Scope locked: Windows-only MVP, no agent integration in v1, agents are
  phase two, M3 platform expansion is post-MVP.
- Loop kit: /wl-start, /wl-slice, /wl-verify, /wl-review commands;
  whisperlane-reviewer subagent; whisperlane-docs, whisperlane-mvp,
  whisperlane-craft skills; LOOP.md.
- Repository: git init, canonical MIT + Apache-2.0 texts, .gitignore,
  private GitHub remote with master pushed.
- External UI/UX brief merged with triage: stored under docs/reference/
  with mockup image; survivors in docs/04-experience.md, alternatives in
  docs/08-decisions.md, parked ideas in IDEAS.md.

### M0 — skeleton that talks

Desktop shell, tray presence, global hotkey, capture to a stored take,
local GPU transcription through the companion service, clipboard
delivery, and the unhappy paths all recoverable.

### M1 — useful on Windows

| Slice | Scope | Commit |
| --- | --- | --- |
| 1 | Settings foundation and language choice | `9d00be4` |
| 2 | Dictation chord as a user setting | `95a8bf9` |
| 3 | Microphone choice, asked without blocking the first take | `49d53d1` |
| 4 | Hold-to-talk, toggle-to-talk, and cancellation | `61b13a0` |
| 5 | Focused-application insertion | `0aaf5e4`, fixes `e2a54d8`, `f282a76`, `f4bf250` |
| 6 | Model selector and honest non-blocking download | `8b691e9` |
| 7 | Verified accelerated transcription on AMD and Intel | `aef981f` |

Acceptance criteria status:

- Dictated text lands in the focused application, or fails plainly with
  nothing half-inserted. Verified live in Notepad.
- Hold-to-talk, toggle-to-talk, and cancellation behave as the
  experience document describes. Verified live.
- Model download and readiness are honest and non-blocking; progress is
  reported as bytes over bytes and a download never interrupts dictation.
- Accelerated transcription is meaningfully faster than the CPU
  fallback: 16718 ms against 221 ms median on an eleven-second take,
  with identical transcript text. The backend is verified by launching
  the service, not by looking for a library.

Closed decisions this milestone:

- ADR-004 cancel gesture (Escape, plus the pill's stop control)
- ADR-005 Windows text insertion (synthesis first, clipboard fallback)
- ADR-006 model default and download
- ADR-007 the chord from a finished state
- ADR-001 amended: the chord is not swallowed, and Control plus Space
  carries two known costs rather than one

### M2 — polish and packaging (in progress)

| Slice | Scope | Status |
| --- | --- | --- |
| 1 | First run is one screen | done |
| 2 | The pill carries every state | done |
| 3 | Advanced concerns folded away | done |
| 4 | Premium pass: tokens, motion, spacing, wording | done |
| 5 | Windows packaging: install, offline, clean uninstall | in progress — runtime and installer contents verified; clean-VM acceptance pending |
| 6 | Delivery routed through the target abstraction | next |

## Queued — outside review of insertion and setup (2026-10-29)

A Reddit comment on insertion and setup raised four things. Two are queued
work, one does not apply because the product types rather than pastes, and
one is right about the symptom but wrong about the mechanism: insertion
does not fail silently, the hook does. It is queued rather than started, and
M2 slice 6 stays next. What is already true is stated with each item so
none of it is re-litigated, and the two facts it surfaced are recorded in
ADR-001 and ADR-005.

- **Name the elevated window.** Insertion already refuses quietly rather
  than silently: when the platform accepts nothing, the transcript goes to
  the clipboard and the pill says so. What the notice never says is why,
  and the genuinely silent case is one step earlier — the low-level hook
  does not see keys aimed at a window above us in integrity, so the chord
  may start no take at all, and nothing can detect a key that never
  arrived. Scope: compare the foreground window's token elevation with our
  own, pass that fact into the insertion decision as a pure input, and say
  plainly that the window runs as administrator and that dictating into it
  needs whisperlane started the same way. Not in scope: elevating
  automatically — that is a privilege increase the product should not make
  on its own, and a startup entry registered at logon does not inherit it.
  Verification is manual: an elevated terminal focused, once for insertion
  and once for whether the chord reaches the hook at all. The second
  answer is the one the code cannot observe.
- **Capture an arbitrary chord on first run.** The default is the approved
  one, but a remap that offers three presets is a remap in name only, and
  two of the three are worse than the default. Scope: a press-your-keys
  control on the first-run screen and in settings, persisted like every
  other setting, with the hook's matcher extended to whatever is captured
  and the presets kept as alternates. The VS Code collision goes into the
  binding's label as part of this, not before. Verification is manual, in
  an editor and in a terminal.
- **Say when the machine is on the processor.** Download size is already
  on the model row and on the first-run action — the default is 547 MB —
  and fetch progress is bytes over bytes. The backend is established by
  launching the engine on the first real take and reading its banner, and
  `docs/04-experience.md` deliberately keeps it off the settings surface.
  That rule needs a narrow exception, which is proposed as item 17 of
  `docs/08-decisions.md` and must be approved before any surface shows it.
  The probe defect that belonged to this slice is fixed: there is no
  eager probe any more, so `backend_verified` cannot be true about a
  machine nothing was measured on. The first launch that serves a take is
  the verification, and a failed Vulkan launch falls back to the processor
  build once.
- **Not queued: clipboard restoration.** The product types; it never
  pastes, so there is no clipboard to put back. The fallback leaves the
  transcript on the clipboard on purpose, because that copy is what the
  user is about to paste. If auto-paste ever leaves `IDEAS.md`, restoration
  belongs to that slice, after the paste has landed and only if the
  clipboard has not changed in between.

## Open (decided nowhere yet)

- What the settings screen says about a machine on the processor — item
  17. Recommended: one line, only after a real launch verified it.
- Optional cleanup scope — item 5. Recommended rules-only or none,
  default off.
- Phase-two agent target details — 06-agent-integration.md.

Closed during M2:

- ADR-008 pill control and chord timing (item 10): stop delivers, cancel
  discards, on mouse and keyboard alike; amends ADR-004. Maintainer
  rejected hold-to-talk on the pill as uncomfortable on a desk.
- ADR-009 liquid glass token set (item 8): refraction before blur, a
  specular rim instead of a border, layered shadows for volume, and the
  accent drawn inside the window because a backdrop filter can only bend
  DOM content. The window is transparent and carries room for the glow,
  and that room passes the pointer through so it swallows no clicks.
- ADR-008 amended in polish: the pill's control starts the next take
  from a finished state instead of settling back to idle, extending
  ADR-007 to the mouse, and the cancel is visible for the whole live
  take instead of revealed on hover. Quitting moved into the three-dot
  menu. Both corrections and their reasoning are recorded in
  `docs/adr/008-pill-control.md`.
- ADR-009 amended in polish: the capsule is read as a droplet rather
  than a plate, and it takes its width from its own content so a status
  line is never cut mid-word.
- Panels open toward the room, and the pill never moves. An upward
  panel is drawn inside the room the window already carries above the
  pill, a downward one grows the window below it, and in neither case
  does the window's origin change — so the pill's place on screen is a
  constant of the window's origin, and no state, reflow, or direction can
  move it. A panel hangs off the side of the pill with more room, so a
  pill parked at a screen edge opens its menu away from the edge.
  Measuring the room against the union of every monitor's work area,
  rather than one monitor, is why the pill can rest spanning two screens
  and be carried back.
- The top-of-screen report and the flicker report were one disease. Both
  rounds of chasing them by shrinking the window's top room were hiding
  the symptom lower down; the room is what the material and the tallest
  panel need, and the pill reaches the screen's top because the drag
  clamps the pill rather than the frame.
- The last take has a card: header, words, and the two things worth
  doing with words. It is named for what it holds rather than for live
  transcription, which v1 does not do — streaming is still the open
  question in the decisions document.
- Dragging the pill needs its own capability. Tauri v2 keeps
  `window.start_dragging` behind `core:window:allow-start-dragging`,
  which `core:default` does not include, so the pill's drag region was
  rejected and the pill could not be moved at all. The capability file
  now grants it. A `dev` that fails with the script exiting non-zero is
  worth one look at the port first: Vite holds 1420 with `strictPort`,
  so a leftover instance fails every later run the same way.
- The pill's panel work is verified live by the maintainer on a
  three-monitor setup: panels open toward the room with no flicker from
  any position, the pill rests at every edge of the screen and spans two
  monitors and comes back, dragging carries the pointer the way any
  window does, and the pill's own controls behave through all of it.
  This is the first feature closed by the verification split in
  LOOP.md — the agent built and tested the logic, the maintainer judged
  the product.
- The pill's material was rebuilt as named optical layers
  (`LiquidGlassSurface`: shadow, body, tint, volume, lens, bevel,
  specular, spill, contour — each its own element, capsule and orb the
  same component at different numbers) because the previous material
  read as a flat plate. The lens — real refraction behind the glass —
  ships behind a probe, not a claim: `WHISPERLANE_GLASS_PROBE=1` loads
  the pill with a high-contrast pattern behind itself and the lens at
  triple strength, and only a confirmed bend by the maintainer turns the
  lens on in the product. What the lens can bend is the light inside the
  document (the aura), never the desktop behind the window; that limit
  is the material's condition, not an implementation gap.
- Bundle identifier moved off `com.whisperlane.app`, which Tauri warns
  collides with the macOS bundle extension. Resolved ahead of item 6.
  The app data folder moved with it: `%APPDATA%\com.whisperlane.desktop`
  now holds the model, the runtime and the stored takes.
- ADR-010 runtime packaging and diagnostics (item 18): the engine ships as
  two static single executables — Vulkan and processor — plus the
  `vcomp140.dll` OpenMP imports, installs by version under the app data
  directory with an atomic `current` pointer, logs engine stderr, maps a
  failed start to a plain sentence, falls back to the processor build once,
  and verifies the backend on the first real take. The eager probe and the
  single `did not become ready` sentence are gone. Model presence is
  exact-length with a `.size` sidecar, so an incomplete file is named
  instead of handed to the engine. Cleanup after an upgrade touches only
  engine-shaped files and directories that actually contain an engine, so
  a person's file or folder in the runtime root survives; a removal the OS
  refuses (a stale engine still holding its executable) is logged instead
  of silently skipped. The staged marker records the tag and the archive
  digest, so the fetch fast path cannot accept bytes from an archive other
  than the pinned one, and the fetch script is held to ASCII because
  Windows PowerShell 5.1 misreads BOM-less UTF-8.
- v0.8.3 released with the self-contained Vulkan and processor runtimes,
  versioned upgrades, engine shutdown on quit, and the release note in
  `docs/releases/0.8.3.md`.
- v0.8.4 hotfix released: runtime staging copies only the three files the
  package ships, existing version directories are cleaned of the old DLL
  set, and the NSIS post-install hook removes it from the install tree.

## Next (in order)

1. M2 — polish, onboarding, packaging. Closes the MVP. Under way.
2. Release automation (skill + command + CI) after the scaffold proves out.
3. Phase 2 — OpenCode agent integration.
4. M3 — macOS, then Linux. Public release with first version.

## Related

- Order of work: docs/07-roadmap.md
- Open questions: docs/08-decisions.md
- Loop: LOOP.md