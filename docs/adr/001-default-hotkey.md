# ADR-001: Default Hotkey

Status: approved, amended by ADR-003.

## Context

The whole product hinges on one key interaction, but the default must not
collide with platform, terminal-emulator, or common application shortcuts.
Agent and terminal-agent bindings join the collision check in phase two.
Per direction, the default follows the most established competitors rather
than inventing a new gesture.

## Options considered

- Control plus platform key held to dictate, with Control plus platform key
  plus Space for hands-free. Follows the commercial Windows convention and
  avoids the autocomplete and input-method collisions of Control plus Space.
- Control plus Space held to dictate. Follows the open-source benchmark but
  collides with autocomplete and input-method switching in editors.
- Keep the plugin legacy default. Avoids all collisions but teaches nothing
  from the market.

## Decision

Hold Control plus Shift plus Space to dictate, with tap on the same binding
acting as toggle. Control plus Space stays rejected: its autocomplete and
input-method collisions are real, and the move to Shift avoids them without
inventing a gesture.

The binding stays user-configurable from the first useful milestone, with the
legacy plugin choices retained as alternates. Microphone selection stays
ask-on-first-press so no setup stands between install and first dictation.

## Consequences

- The M0 skeleton watches the chord through a low-level keyboard hook,
  because bare-modifier chords cannot go through the register-a-shortcut
  path.
- Toggle behavior and the hands-free alternate land with the M1 flow and
  settings work, not in the skeleton.
- The chord must not collide with the terminal hosting an agent prompt, which
  is why the hands-free binding joins the phase-two collision check.

## Related

- Proposal: `../08-decisions.md` item 7
- Scope: `../03-product.md`, `../07-roadmap.md`
- Behavior: `../04-experience.md`
- Source plan: `../plan/pre-start-intro-plan.md`