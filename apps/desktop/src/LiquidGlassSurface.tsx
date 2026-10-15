// LiquidGlassSurface: the pill's optical material, as named layers
// (docs/adr/009, amendment three).
//
// The surface is not one fill and a stack of inset shadows — it is nine
// layers, each its own element with its own numbers, in paint order:
//
//   shadow   — the wide soft dark that lifts the surface off the ground
//   body     — the translucent navy-indigo body; blur and saturation over
//              what is behind it inside the window (the aura's light)
//   tint     — the orb's state colour; empty on the capsule
//   volume   — asymmetric inner gradients: the dark centre, the lifted
//              top, the lit curve along the lower edge
//   lens     — the one true refraction; OFF until the probe proves the
//              bend in this webview, because writing
//              `backdrop-filter: url(#...)` is not the same as the bend
//              happening (see LiquidLensDefs)
//   bevel    — the thin sharp rim line, with the bottom edge's
//              controlled violet-blue density in its gradient
//   specular — curved, variable-width highlights: bright at the top
//              left where the light lands, a faint glint bottom right
//   spill    — the violet-blue ambient wash hugging the inner edge,
//              blurred so it also bleeds into the outer shadow
//   contour  — the thin white-lilac outer contour, tinted by state
//
// Every layer is cut to the geometry by a mask or a gradient, so both
// geometries — the long capsule and the orb — come from the same component
// with different numbers, never different code.

import type { ReactElement } from "react";

/** The two geometries the surface is built for. */
export type GlassGeometry = "capsule" | "orb";

/**
 * The displacement map behind the lens, built once and shared.
 *
 * A stretched sphere: the outer band bends the backdrop inward (the
 * meniscus of a thick lens), the middle holds still, and the very centre
 * lifts a touch the other way so the capsule reads as bulged rather than
 * as flat. The red channel says how far to sample horizontally, the green
 * one vertically; `feDisplacementMap`'s scale turns those into pixels.
 *
 * It is generated once on first use and reused as a static data URI for
 * the life of the document — never rebuilt per frame, which is the
 * performance budget the lens has to fit.
 */
const LENS_MAP_WIDTH = 256;
const LENS_MAP_HEIGHT = 96;
let lensMapUrl: string | null = null;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lensMapDataUrl(): string {
  if (lensMapUrl !== null) return lensMapUrl;
  const canvas = document.createElement("canvas");
  canvas.width = LENS_MAP_WIDTH;
  canvas.height = LENS_MAP_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // No canvas, no map: the lens silently stays off rather than
    // rendering a broken filter. Everything else is unaffected.
    return (lensMapUrl = "");
  }
  const image = ctx.createImageData(LENS_MAP_WIDTH, LENS_MAP_HEIGHT);
  const data = image.data;
  for (let y = 0; y < LENS_MAP_HEIGHT; y++) {
    for (let x = 0; x < LENS_MAP_WIDTH; x++) {
      const u = ((x + 0.5) / LENS_MAP_WIDTH) * 2 - 1;
      const v = ((y + 0.5) / LENS_MAP_HEIGHT) * 2 - 1;
      const d = Math.hypot(u, v) || 1e-6;
      // The rim bends, the middle holds, the centre lifts slightly.
      const rim = smoothstep(0.55, 1.05, d);
      const bulge = 0.06 * (1 - smoothstep(0.0, 0.42, d));
      const bend = 0.5 * rim - bulge;
      // Sampling inward at the rim: the left edge reads from the right,
      // the top from below, which is what compresses the backdrop into
      // the lens and makes the rim read as thick glass.
      const r = Math.round(
        255 * Math.min(1, Math.max(0, 0.5 - (bend * u) / d)),
      );
      const g = Math.round(
        255 * Math.min(1, Math.max(0, 0.5 - (bend * v) / d)),
      );
      const i = (y * LENS_MAP_WIDTH + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  lensMapUrl = canvas.toDataURL("image/png");
  return lensMapUrl;
}

/**
 * The lens filters, mounted once per document.
 *
 * One map, three scales: the capsule bends harder than the orb, and the
 * probe bends hardest of all so the bend is unmistakable when it is
 * judged by eye. `sRGB` interpolation matters — the displacement channels
 * are read as plain numbers, and the default linear space would bend by
 * the wrong amounts.
 *
 * These are referenced from CSS by id and stay invisible themselves.
 */
export function LiquidLensDefs(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {(
          [
            ["lgs-lens-capsule", 12],
            ["lgs-lens-orb", 6],
            ["lgs-probe-lens", 30],
          ] as const
        ).map(([id, scale]) => (
          <filter
            key={id}
            id={id}
            x="-5%"
            y="-5%"
            width="110%"
            height="110%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href={lensMapDataUrl()}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

/**
 * The surface itself: the geometry's silhouette carrying the layers.
 *
 * Rendered inside the element that owns the geometry (the capsule's box,
 * the orb's button) and cut to its radius. It paints nothing that takes
 * a pointer: the content above it keeps every interaction it had.
 */
export function LiquidGlassSurface({
  geometry,
}: {
  geometry: GlassGeometry;
}): ReactElement {
  return (
    <div className={`lgs lgs-${geometry}`} aria-hidden="true">
      <div className="lgs-shadow" />
      <div className="lgs-body" />
      <div className="lgs-tint" />
      <div className="lgs-volume" />
      <div className="lgs-lens" />
      <div className="lgs-bevel" />
      <div className="lgs-specular" />
      <div className="lgs-spill" />
      <div className="lgs-contour" />
    </div>
  );
}

/**
 * The refraction probe's backdrop: high-contrast thin lines and solid
 * coloured shapes across the window, under the pill.
 *
 * If the lens works, the lines bend visibly at the pill's curved rim and
 * the shapes smear along it. If they do not bend, the technique does not
 * work in this webview and the lens stays out of the product. This is a
 * judgement made by eye, on demand, never assumed.
 */
export function GlassProbeBackdrop(): ReactElement {
  return (
    <div className="glass-probe" aria-hidden="true">
      <div className="glass-probe-lines" />
      <div className="glass-probe-diagonal" />
      <span className="glass-probe-dot glass-probe-dot-left" />
      <span className="glass-probe-dot glass-probe-dot-right" />
      <span className="glass-probe-dot glass-probe-dot-top" />
      <svg className="glass-probe-tri" width="26" height="24" viewBox="0 0 26 24">
        <polygon points="13,2 24,22 2,22" fill="rgba(250, 204, 21, 0.92)" />
      </svg>
    </div>
  );
}
