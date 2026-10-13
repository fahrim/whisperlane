# Backlog — Where We Left Off

Living file. Updated at every gate: session end, milestone end, and any
scope or decision change. Read this first when resuming work.

## Now

Pre-code. Documentation, loop kit, and repository are done and pushed to
the private remote. No application code exists yet. Next action: scaffold
the desktop shell, then run /wl-start M0.

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

## Next (in order)

1. Scaffold apps/desktop (Tauri v2 + Bun + React + TypeScript shell).
2. /wl-start M0 — skeleton that talks, Windows only.
3. M1 — useful on Windows with accelerated transcription.
4. M2 — polish, onboarding, packaging. Closes the MVP.
5. Release automation (skill + command + CI) after the scaffold proves out.
6. Phase 2 — OpenCode agent integration.
7. M3 — macOS, then Linux. Public release with first version.

## Open (decided nowhere yet)

- Hosting spike: companion service vs supervised worker — see
  docs/08-decisions.md item 1.
- Default hotkey, default model, cleanup scope, name check — see
  docs/08-decisions.md items 2 through 7.
- Nothing above blocks scaffolding.

## Related

- Order of work: docs/07-roadmap.md
- Open questions: docs/08-decisions.md
- Loop: LOOP.md
