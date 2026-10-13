# ADR-002: Speech Engine Hosting

Status: approved.

## Context

The local speech engine must either bind directly into the core or run as
a companion local service that the core talks to. Two proven references
inform the choice from opposite sides. The existing plugin runs a local
transcription service that starts on demand, stays warm while in use,
unloads after a ten-minute idle period, and never stops a server instance
it did not start. The reference open-source product on the same desktop
stack keeps inference inside the application but isolates the crash-prone
native speech path in a supervised worker. Both ship the same lesson:
never let a native speech failure take the application down with it.

## Options considered

- In-process binding. Closest integration and simplest packaging, but no
  isolation when native inference misbehaves on unusual hardware.
- Supervised in-process worker, following the reference product. Native
  inference stays in the application family behind a supervisor with load,
  unload, reload, idle-unload, and crash-recovery behavior.
- Companion local service, following the existing plugin. Proven on-demand
  lifecycle and verified backend walk, model hot-swap and process isolation
  most natural, at the cost of managing a second process and its lifecycle.

## Decision

Companion local service for the early milestones, reusing the proven
on-demand lifecycle and verified backend walk. The reference supervision
requirements — idle unload that never fires mid-recording, explicit reload
on accelerator change, graceful CPU fallback, and a diagnostics path —
hold as acceptance behavior regardless of hosting. Revisit supervised
in-process once packaging demands it, with a spike.

## Consequences

- The core owns a supervisor: on-demand start, warm retention, idle
  unload, crash recovery, model-presence reporting.
- The M0 skeleton serves CPU transcription through the sidecar; the
  accelerated backend walk lands with the M1 work, not here.
- Packaging the sidecar inside the installer is M2 scope.

## Related

- Proposal: `../08-decisions.md` item 1
- Structure: `../05-architecture.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`
