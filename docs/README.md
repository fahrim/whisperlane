# whisperlane — Documentation Index

This index is the map for all project documentation. It defines the reading
order, the one-sentence purpose of each document, and how the documents
relate to each other.

The single source of truth for the project idea is the pre-start plan.
Everything here expands that plan; nothing here silently diverges from it.

Start with the source plan, then read documents 01 through 09 in order.

## Source of truth

- `plan/pre-start-intro-plan.md` — The shared picture of what we are building
  and why. Pre-start, expected to change once real use pushes back.

## Reading order

1. `01-vision.md` — Why this project exists and what success looks like for v1.
2. `02-audience.md` — Who it serves and how they use it in practice.
3. `03-product.md` — What it does, what it excludes, and where it stands.
4. `04-experience.md` — How it feels and how the core flows behave.
5. `05-architecture.md` — How it is structured and why those technologies.
6. `06-agent-integration.md` — How dictation will land in the agent in phase two.
7. `07-roadmap.md` — How we get there in milestones and how we know each step is done.
8. `08-decisions.md` — What is still open, with options, trade-offs, and a recommendation.
9. `09-repository.md` — How the repo is organized, licensed, and shipped.

## Document map

| Document | Purpose in one sentence | Builds on | Needed by |
| --- | --- | --- | --- |
| 01 Vision | States the mission, vision, v1 goals, success measures, and non-goals. | Source plan | Product, Roadmap |
| 02 Audience | Describes the target users, personas, and core usage scenarios. | Vision | Product, Experience |
| 03 Product | Defines the product scope, features, v1 boundaries, and positioning. | Vision, Audience | Experience, Architecture, Roadmap |
| 04 Experience | Describes UX principles, flows, screens, states, and the premium feel. | Product, Audience | Architecture, Agent Integration |
| 05 Architecture | Explains components, data flow, technology choices, and platform strategy. | Product, Experience | Agent Integration, Roadmap, Repository |
| 06 Agent Integration | Defines the phase-two agent path, the two modes, and the target abstraction. | Experience, Architecture | Roadmap, Decisions |
| 07 Roadmap | Sequences milestones M0 through M3 with acceptance criteria, holding agents for phase two. | Product, Architecture, Agent Integration | Decisions, Repository |
| 08 Decisions | Lists open questions with options, trade-offs, recommendations, and ADR status. | All of the above | Architecture, Roadmap |
| 09 Repository | Defines repo layout, licensing, contribution rules, and test and release strategy. | Architecture, Roadmap | All contributors |

Architecture is narrated, not coded. Diagrams in the set are conceptual
illustrations; no document contains source code, configuration, or snippets.

## Conventions

- Every document ends with a Related section linking to the documents it
  depends on and to the source plan where relevant.
- When a new document is added, this index and the Related sections of the
  affected documents are updated together.
- Open questions are never decided silently. They are recorded in
  `08-decisions.md`, with options, trade-offs, and a recommendation, and
  resolved into Architecture Decision Records under `adr/` once approved.
- If any document appears to contradict the source plan, the contradiction is
  resolved explicitly: either the source plan is updated or the document is
  corrected.

## Related

- Source plan: `plan/pre-start-intro-plan.md`
- First document to read: `01-vision.md`
- Open questions and ADR process: `08-decisions.md`, `adr/`
- Repo and contribution rules: `09-repository.md`
