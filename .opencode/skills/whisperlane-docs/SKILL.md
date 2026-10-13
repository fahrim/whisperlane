---
name: whisperlane-docs
description: Write or edit whisperlane project docs per repo conventions. Use for any docs change under docs/.
---

# whisperlane-docs

Conventions for the whisperlane documentation set. The maintainer speaks
Turkish; all project artifacts (docs, README, commit messages) are English.

## Read first

- `docs/README.md` — index, reading order, document map.
- `docs/plan/pre-start-intro-plan.md` — single source of truth. Never
  silently diverge; either update it or ask.
- `docs/09-repository.md` — contribution rules for docs.
- `docs/08-decisions.md` — open questions and ADR process.

## Hard rules

1. Docs are English. Chat with the maintainer stays Turkish.
2. No document contains source code, configuration, or snippets.
   Architecture is narrated; conceptual diagrams are allowed.
3. Every document has one job; no filler, no cross-document duplication.
   Scope stays wide: vision, audience, product, experience, architecture,
   integration, roadmap, decisions, repository.
4. Every document ends with a Related section linking to the documents it
   depends on and to the source plan where relevant.
5. Adding a document means updating `docs/README.md` and the Related
   sections of affected documents in the same change.
6. Open questions are never decided silently. Write options, trade-offs,
   and a recommendation in `docs/08-decisions.md`; the decision lands via
   approval into `docs/adr/`. Until approved, status stays open.
7. Do not guess what you should ask: default hotkey, target platform,
   model choice, audience assumptions. Ask, or record as an open proposal.

## Checklist before finishing

- Index updated with one-sentence purpose and relationships.
- Related sections updated on every touched and affected doc.
- No code, config, or snippet introduced.
- No contradiction with the source plan, or the contradiction is flagged.
- New open points recorded in `docs/08-decisions.md`, not buried in prose.
