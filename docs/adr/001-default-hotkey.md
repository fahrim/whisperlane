# ADR-001: Default Hotkey

Status: approved.

## Context

The whole product hinges on one key interaction, but the default must not
collide with platform, terminal-emulator, or common application shortcuts.
Agent and terminal-agent bindings join the collision check in phase two.
Per direction, the default follows the most established competitors rather
than inventing a new gesture. The shared market pattern is a Space-based
hold-to-dictate with tap-to-toggle on the same binding.

## Options considered

- Control plus platform key held to dictate, with Control plus platform key
  plus Space for hands-free. Follows the commercial Windows convention and
  avoids the autocomplete and input-method collisions of Control plus Space.
- Control plus Space held to dictate. Follows the open-source benchmark but
  collides with autocomplete and input-method switching in editors.
- Keep the plugin legacy default. Avoids all collisions but teaches nothing
  from the market.

## Decision

Default to hold Control plus platform key for push-to-talk with tap on the
same binding acting as toggle, plus the hands-free combination above as the
explicit alternate. The binding stays user-configurable from the first
useful milestone, with the legacy plugin choices retained as alternates.
Microphone selection stays ask-on-first-press so no setup stands between
install and first dictation.

## Consequences

- The M0 skeleton watches the Control plus Super chord through a low-level
  keyboard hook, since bare-modifier chords cannot go through the
  register-a-shortcut path.
- Toggle behavior and the hands-free alternate land with the M1 flow and
  settings work, not in the skeleton.
- A bare Windows-key press may wake the Start menu on some machines; if it
  does, suppression is M1 scope and must not change this default silently.

## Related

- Proposal: `../08-decisions.md` item 7
- Scope: `../03-product.md`, `../07-roadmap.md`
- Behavior: `../04-experience.md`
- Source plan: `../plan/pre-start-intro-plan.md`
