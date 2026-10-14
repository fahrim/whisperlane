# Loop Engineering

How whisperlane is built with the coding agent: small slices, verify
until green, review, repeat. This file describes the loop; the loop
itself runs through the commands below in OpenCode.

## The loop

One milestone slice at a time: implement the smallest change that meets
the slice, verify with typecheck plus tests plus build, fix until green,
review, report, continue. Scope never widens to close a gap; gaps go to
docs/08-decisions.md.

## What the agent verifies, and what it does not

The agent verifies by reading and by running the build: typecheck, unit
tests, and a compile. That is the whole of its verification.

The agent does not run the application, drive its interface, send it
synthetic input, or take screenshots. An overlay that floats over the
desktop, follows a moving cursor, and answers to a global keyboard hook
cannot be judged from an automated driver without spending the session on
harness code, and what comes back is a picture of a window rather than an
answer about the product. Manual verification is therefore the
maintainer's, permanently, and it is requested rather than assumed: when a
change cannot be settled by typecheck, tests, and a compile, the agent
says what to try and waits for the result.

Stating the check is part of the work. "It should work" is not a report,
and neither is passing tests standing in for a behavior nobody exercised.
The agent says what it changed, what it could not confirm, and exactly
what to do to confirm it.

## Commands

- /wl-start — Runs whole milestone slices in roadmap order. Reads the
  docs and skills first, works one slice at a time with the verify loop,
  stops at gates: three failed fix attempts, a needed decision, or
  milestone end. Never starts the next milestone without approval.
- /wl-slice — Implements a single named slice with the same loop and a
  Turkish summary at the end.
- /wl-verify — Verifies the current slice: typecheck, then tests, then
  build. Stops at the first failure and reports without fixing. This is
  the agent's entire verification; running the application is the
  maintainer's job, not the agent's (see above).
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
