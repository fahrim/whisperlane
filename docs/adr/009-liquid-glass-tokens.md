# ADR-009: Liquid Glass Token Set

Status: approved. Amended three times during M2 polish: the capsule is
now read as a droplet rather than a plate, its width follows its own
content instead of a fixed box, the window's room grows toward whichever
side a panel opens on while the pill stays on its own pixels, and the
material is now built as named optical layers behind a verification gate
for real refraction. The refraction-before-blur rule, the specular rim,
the single accent, and the opaque fallback are unchanged.

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

Geometry: a 9999px radius and a 56px pill. The capsule's width is not
fixed — it follows its own content, bounded at both ends, so a status
line is never cut mid-word. The horizontal padding and the gap between
elements are derived per surface rather than locked as one pair, since
they no longer have to absorb a fixed width. See the amendment below.

The surface is read as a droplet rather than a plate: a bright catch
where light lands on the top of a curved body, a thick inner wall, and
a lit lower edge where the glass bends light back up, over a vertical
body gradient. The backdrop filter refracts before it blurs, then
saturates, contrasts and lifts what is behind the glass. Saturating is
what separates material from a grey pane.

Volume comes from shadows at once: an outer shadow that lifts the
pill off the page, a sharp inner highlight on the top edge where light
lands, a soft inner body highlight, and a lit lower lip where the glass
is thickest.

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

## Amendment: the capsule became a droplet

Three findings from the built pill changed the set, and they are
recorded together because they are one correction rather than three
tunings.

The body is read as a droplet, not a plate. An angled wash over a fixed
box looked like a dark rectangle with a highlight on it. The surface is
now a bright catch where light lands on the top of a curved body, a
thick inner wall, and a lit lower edge where the glass bends light back
up, with the body gradient behind it. Volume stays carried by shadows;
what changed is that the surface itself now describes a form.

The capsule sizes to its content instead of holding a fixed width, and
that decision forced the geometry numbers. A fixed box with a flexible
middle column is what truncated a status line mid-word; letting the pill
grow removes the truncation by construction rather than by tuning a
maximum until the longest sentence happens to fit. The radius, the pill
height, and the single accent are unchanged; the horizontal padding and
the gap between elements are re-derived, and the capsule's width bounds
move with them.

The window's room is sized for the glow and the tallest panel the pill
may open above itself, because an upward panel is drawn inside the room
the window already carries: moving the window up to make space for it
would move the pill, and the pill's place on screen must not depend on
what is open beside it. A downward panel grows the window below the pill
instead. In neither direction does the window's own origin change, so
there is no moment in which the window has moved and the pill has not —
that moment is the flicker this replaced. Room is also spent on the
sides for the pointer and below for the shadow, unchanged.

The accent light follows the capsule rather than the window. Painted in
the fixed window room, the glow stayed put while the pill grew and
shrank inside it, and a pill that resizes with its content cannot be
painted against a fixed box. The light is now bound to the same element
the pill is drawn in, and moves and scales with it.

## Amendment: the surface became named optical layers

The droplet was still one fill, one shadow stack, and one rim; the stack
read as a flat glassmorphism plate. The material is now built by a
`LiquidGlassSurface` component as nine named layers, each its own element
with its own numbers, painted in order: shadow, body, tint, volume,
lens, bevel, specular, spill, contour. A layer is a gradient or a mask
cut to the geometry, not one more inset shadow, and any one of them can
be tuned or deleted without untangling the rest. The long capsule and
the orb are two geometries of the same component — the same layers at
different numbers, never different code — and the centre pools darker
than the edges, which is where the depth the rim alone could not give
now comes from.

The same amendment closes a claim the material had been making since it
was first built. The backdrop filter carried
`url(#liquid-refraction)` — a turbulence noise displacement — written
and never verified, and writing the reference is not the bend: a
renderer that parses the reference as valid can still refuse to render
it, and a filter chain with a reference it cannot apply drops the whole
chain, the blur included. The lens therefore ships behind a probe. A
normal launch runs the six painted layers and the body's plain blur;
`WHISPERLANE_GLASS_PROBE=1` loads the pill with `?glass-probe=1`, the
surface draws a high-contrast pattern of thin lines and solid shapes
behind itself, and the lens runs at triple strength over them. The bend
is judged by eye at the curved rim: only a confirmed bend turns the lens
on in the product, and a failed probe leaves the clean CSS surface that
already ships.

Two things the amendment also fixes in passing. The lens can only ever
bend light that is inside the document — the aura, never the desktop
behind the window — and that limit is now stated where the lens is
built, not implied. And the displacement map is one stretched sphere,
generated once as a static data URI and shared by the capsule's, the
orb's, and the probe's filters at three scales, so nothing expensive is
rebuilt per frame.

## Related

- Proposal: `../08-decisions.md` item 8
- Direction it implements: `../04-experience.md` visual direction
- Structure behind it: `../05-architecture.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`