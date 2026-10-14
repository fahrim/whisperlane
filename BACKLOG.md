# Backlog — Where We Left Off

Living file. Updated at every gate: session end, milestone end, and any
scope or decision change. Read this first when resuming work.

## Now

M0 and M1 are complete. The application takes a real take on Windows and
inserts the transcript into the focused application: press the chord,
speak, release, and the words appear where the caret was. M2 is under
way: first run is now one screen, and the milestone continues through
polish and packaging.

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
| 4 | Premium pass: tokens, motion, spacing, wording | blocked on decision item 8 |
| 5 | Windows packaging: install, offline, clean uninstall | blocked on decision item 6 |
| 6 | Delivery routed through the target abstraction | next |

## Open (decided nowhere yet)

- Optional cleanup scope — item 5. Recommended rules-only or none,
  default off.
- Name, packaging identity, and collision check — item 6. Recommended
  before M2 packaging.
- Visual tokens (accent, surfaces, glow budget) — item 8. Recommended:
  lock the values at M2 kickoff. Blocks slice 4.
- Phase-two agent target details — 06-agent-integration.md.

Closed during M2:

- ADR-008 pill control and chord timing (item 10): stop delivers, cancel
  discards, on mouse and keyboard alike; amends ADR-004. Maintainer
  rejected hold-to-talk on the pill as uncomfortable on a desk.
- Bundle identifier moved off `com.whisperlane.app`, which Tauri warns
  collides with the macOS bundle extension. Resolved ahead of item 6.
  The app data folder moved with it: `%APPDATA%\com.whisperlane.desktop`
  now holds the model, the runtime and the stored takes.

## Next (in order)

1. M2 — polish, onboarding, packaging. Closes the MVP. Under way.
2. Release automation (skill + command + CI) after the scaffold proves out.
3. Phase 2 — OpenCode agent integration.
4. M3 — macOS, then Linux. Public release with first version.

## Related

- Order of work: docs/07-roadmap.md
- Open questions: docs/08-decisions.md
- Loop: LOOP.md