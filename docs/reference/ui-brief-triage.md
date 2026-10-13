# UI Brief Triage — Where Every Rule Landed

Field-by-field record of merging docs/reference/external-ui-ux-brief.md
into the project. Verdicts: adopted (taken as written), adapted (idea
kept, project values win), rejected (conflicts with scope, recorded for
honesty), parked (future, lives in IDEAS.md).

## Adopted

- Product vision and principles (§1): quiet default, one clear action,
  state clarity, keyboard-first, premium restraint, mic visibility.
  Lives in docs/04-experience.md principles and screens.
- Visual direction and token table (§2): liquid glass, single accent,
  glow as state feedback only, opaque fallback. Lives in
  docs/04-experience.md visual direction; exact token values stay a
  proposal until approved (docs/08-decisions.md item 8).
- Floating pill behaviors (§3A): borderless, top-center default, movable
  with remembered position, compact and expanded states, multi-monitor
  and DPI handling, non-activating status display. Lives in
  docs/04-experience.md screens.
- State model and transitions (§4): five named states, the happy-path
  chain, error branches, no impossible transitions, stale-async
  protection. Lives in docs/04-experience.md states.
- Copy and paste semantics (§7): distinct actions, no silent auto-paste,
  focus preservation, failure leaves text accessible. Matches the honest
  fallback in docs/08-decisions.md item 3.
- Accessibility and resilience (§8): contrast, transparency and
  reduced-motion support, no color-only states, Windows scaling and
  device-failure matrix. Adopted as M2 acceptance input alongside
  docs/07-roadmap.md.
- Priorities P0/P1/P2 (§10): map onto M0/M1/M2 respectively. The history
  and live-transcription items inside P2 are parked, not adopted.
- Acceptance criteria (§11): adopted as the M2 review checklist, minus
  the parked items.
- Agent instructions (§12): inspect before editing, reuse the stack,
  incremental steps, real state only, verify, report. Already the law
  via LOOP.md and the whisperlane-craft skill; no conflict.
- Mockup status (§13): direction, not specification. Adopted as stated.
  The image is stored at docs/reference/Whisper_Dynamic_Pill_UI_Mockup.png.

## Adapted

- Transcript panel (§3B): routine review card rejected for v1; kept as
  the hybrid in docs/04-experience.md — closed by default, opens on
  insertion failure, openable on demand via setting or pill control.
- Settings sections (§3C): filtered to the v1 minimum (hotkey,
  microphone, language, model state). Appearance tuning, auto-paste,
  privacy dashboard, and about page are parked in IDEAS.md.
- Keyboard defaults (§6): the toggle default is rejected in favor of the
  project hotkey (docs/08-decisions.md item 7); Esc semantics, confirm
  semantics, and the configurable plus conflict-checked rule are
  adopted as proposals.
- Animation timings (§5): adopted as M2 implementation targets, not v1
  document detail. Sound cues stay off by default.
- Cross-platform split (§9): shared versus adapter separation adopted
  for the desktop line; mobile targets rejected (non-goal, IDEAS.md).

## Rejected

- Mobile targets (§9: iOS, Android). Non-goal. Parked in IDEAS.md.
- Routine transcript review as the happy path (§3B as written).
  Replaced by the hybrid above.
- Pause control and pill pinning from the mockup. Pause needs
  end-to-end support that v1 does not build; the tray is the at-rest
  home. Both parked in IDEAS.md.

## Related

- The brief itself: external-ui-ux-brief.md
- Adopting documents: docs/04-experience.md, docs/07-roadmap.md
- Rejected alternatives: docs/08-decisions.md
- Parked ideas: IDEAS.md at the repo root
