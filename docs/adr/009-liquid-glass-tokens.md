# ADR-009: Liquid Glass Token Set

Status: approved.

## Context

Item 8 of the decisions document recorded exact token values as a
proposal: the liquid-glass direction had been adopted, but its numbers
were not, so the pill was built on structure and state alone. The M2
polish milestone is where those numbers had to be locked.

Two constraints shaped the answer. The material has to survive being
run as a small always-on-top overlay rather than as a full-screen
surface, and it has to survive machines that refuse it: Windows lets
the user turn transparency effects off, and not every renderer
supports a backdrop filter at all.

## Options considered

- Approve the proposed values as they stand. Shortest path to a
  finished surface, and the risk is that a value chosen for a large
  canvas looks loud at pill size.
- Approve the direction with adjusted values, keeping the structure and
  re-deriving the numbers for the overlay's real size.
- Keep deferring the tokens and build the milestone on unstyled
  structure. This is what M0 and M1 did, and it is why the pill still
  looked like a placeholder at the start of M2.

## Decision

The token set is locked as one unit, recorded in the interface's token
file rather than as prose, and the material is built from four layers
rather than one blur.

Geometry: a 9999px radius, a 56px pill, 10px of horizontal padding and
a 14px gap between elements.

The surface is an angled wash rather than a flat fill, and the
backdrop filter refracts before it blurs, then saturates, contrasts and
lifts what is behind the glass. Saturating is what separates material
from a grey pane.

Volume comes from four shadows at once: an outer shadow that lifts the
pill off the page, a sharp inner highlight on the top edge where light
lands, a soft inner body highlight, and a dark inner lip along the
bottom where the glass is thickest.

The edge is a specular rim, not a border. A flat one-pixel rule is the
tell of cheap glass, so the rim is a gradient cut to a 1.25px edge by a
mask, running from a bright catch at the top left through the accent to
a dimmer throw at the bottom right. It changes with state, because the
edge is where the light lands.

Motion has two curves: a spring that settles rather than stops for
anything that changes size, and a plain fade for state changes that must
not pull the eye.

Two architecture rules make the material possible at all. The pill's
window is transparent and frameless, with its own shadow disabled,
because a window that paints its own background would slice the glow
and the shadow flat at its border. And the window carries empty room
around the pill, because the glow is painted outside the pill's own edge
and a window clips whatever reaches it.

The accent light lives inside the document rather than being taken from
the desktop. A CSS backdrop filter can only bend DOM content, never the
window behind it, so the thing it refracts has to be ours. The aura is
therefore drawn as layers under the glass and coloured by state.

Opaque fallback is not optional. A system with transparency effects
turned off, and a renderer with no backdrop filter support, both get a
readable solid pill rather than a broken one.

Reduced motion drops the refraction and the springs. Every state stays
legible through colour and the written line, never through movement
alone.

## Consequences

- The token values live in one file that both surfaces import, so the
  pill and the settings window cannot drift into two visual languages.
- The glow has to stay dimmer while idle than while recording. Glow is
  state feedback: the states the user waits on are the ones that earn
  it. Idle rests.
- The accent is one hue chosen by state, not a palette. The rim's
  spectral edge is a property of the material, not a second accent.
- Native desktop blur behind the pill is not part of this. It would
  come from the platform's own acrylic, which behaves differently
  across Windows versions and is worth its own decision rather than a
  line in this one.
- The refraction filter costs real work per frame. If it stutters on
  slower machines, lowering the displacement scale is the first lever,
  because the material survives a weaker bend far better than it
  survives a missing one.

## Related

- Proposal: `../08-decisions.md` item 8
- Direction it implements: `../04-experience.md` visual direction
- Structure behind it: `../05-architecture.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`