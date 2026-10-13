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
- The hook observes the chord and never hides a keystroke. Swallowing the
  trigger key while leaving the modifiers visible left the focused
  application with a modifier it never saw released, which latched as a
  stuck modifier in everyday targets and made later keystrokes arrive as
  accidental shortcuts. Letting the chord through costs one visible space
  character in a text field; a latched Control costs a keystroke. The
  press-and-release that ends a take additionally sends a modifier
  release, so a key still held when the take ended cannot stay latched.
- Control plus Space therefore carries two known collisions rather than
  one: the editor autocomplete conflict recorded above, and the stray
  space it types into a text field. Both are stated in the binding's own
  label rather than discovered in use.
- Toggle behavior and the hands-free alternate land with the M1 flow and
  settings work, not in the skeleton.
- The chord must not collide with the terminal hosting an agent prompt, which
  is why the hands-free binding joins the phase-two collision check.

## Related

- Proposal: `../08-decisions.md` item 7
- Scope: `../03-product.md`, `../07-roadmap.md`
- Behavior: `../04-experience.md`
- Source plan: `../plan/pre-start-intro-plan.md`