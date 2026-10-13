# Loop Engineering

How whisperlane is built with the coding agent: small slices, verify
until green, review, repeat. This file describes the loop; the loop
itself runs through the commands below in OpenCode.

## The loop

One milestone slice at a time: implement the smallest change that meets
the slice, verify with typecheck plus tests plus build, fix until green,
review, report, continue. Scope never widens to close a gap; gaps go to
docs/08-decisions.md.

## Commands

- /wl-start — Runs whole milestone slices in roadmap order. Reads the
  docs and skills first, works one slice at a time with the verify loop,
  stops at gates: three failed fix attempts, a needed decision, or
  milestone end. Never starts the next milestone without approval.
- /wl-slice — Implements a single named slice with the same loop and a
  Turkish summary at the end.
- /wl-verify — Verifies the current slice: typecheck, then tests, then
  build. Stops at the first failure and reports without fixing.
- /wl-review — Reviews changes in a background session with the
  read-only reviewer: correctness first, then MVP scope slips, then docs
  drift. Ends with pass or needs-fixes.

## Agents and skills in the loop

- whisperlane-reviewer — Read-only review subagent. Cannot edit or run
  commands; lists findings with file and line references.
- whisperlane-docs — Docs discipline applied to any documentation change.
- whisperlane-mvp — Windows-only, agent-free MVP guardrails applied to
  every build decision.
- whisperlane-craft — SOLID, DRY, and no-debt bar applied while writing
  code. Loaded by /wl-start and /wl-slice.

## Related

- Scope and order: docs/07-roadmap.md
- Open questions: docs/08-decisions.md
- Docs conventions: docs/09-repository.md
- Release plan: docs/09-repository.md release strategy
