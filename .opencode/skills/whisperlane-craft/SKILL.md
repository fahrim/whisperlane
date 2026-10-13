---
name: whisperlane-craft
description: Enforce SOLID, DRY, and pattern discipline in whisperlane code. Use when writing or reviewing production code.
---

# whisperlane-craft

Code quality bar for whisperlane. Applies to Rust and TypeScript alike.
Readable, small, and honest beats clever.

## SOLID, briefly and practically

- Single responsibility: one module, one job — mirroring the docs rule.
  A manager owns its concern (audio, model, transcription) and nothing else.
- Open/closed: extend through the target abstraction and new targets, not
  by forking the pipeline per case.
- Liskov: any destination behind the target boundary behaves like any
  other — same contract, no surprises.
- Interface segregation: narrow command-event boundaries. Neither side
  knows more than it needs.
- Dependency inversion: core logic depends on small abstractions (a
  recorder, an engine, a settings source), never on concrete globals.

## DRY without cleverness

- A rule or behavior lives in exactly one place. Second use: extract.
  Third use without extraction is a defect.
- Never copy a block and tweak two lines. Parameterize or compose.
- Shared constants (timeouts, sample rates, ports) are named once where
  both sides can see them.

## Patterns — only where they pay

- Prefer composition over inheritance; small functions over frameworks.
- Match the existing shapes first: manager separation, command-event flow,
  supervised lifecycle with explicit load/unload/reload. New patterns need
  a reason stated in one sentence.
- No speculative generality: no hook systems, plugin layers, or
  configuration for futures that have no milestone. YAGNI is a rule.

## No technical debt, concretely

- No dead code, no commented-out blocks, no untracked TODOs in merged work.
  An open question goes to docs/08-decisions.md, not into a code comment.
- Errors are explicit and handled at the boundary where they make sense;
  panics and silent fallbacks are never the happy path.
- New behavior arrives with its verification: typecheck clean, tests for
  the changed unit, build unbroken. Use /wl-verify.
- Formatting and lints clean before review. Naming says why, not what.

## Checklist before review

- One module, one job; no duplication introduced.
- No new pattern without a one-sentence reason.
- No debt markers left behind.
- /wl-verify green; /wl-review passes.
