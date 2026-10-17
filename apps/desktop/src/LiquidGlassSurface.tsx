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
 * Geometry-specific displacement maps behind the lens, built once and shared.
 *
 * The capsule and the orb are distinct geometries and must not share one
 * stretched spherical displacement map: stretching a sphere across a long
 * capsule creates a distorted, bulged center. Instead:
 *
 * - Capsule map (320×56): uses a signed-distance capsule field (rounded ends
 *   matching the 28px radius, straight horizontal top/bottom runs). Refraction
 *   is strictly confined to the curved outer rim (meniscus) and local end-caps;
 *   the long interior holds completely flat (neutral 128, 128) so the center
 *   never bulges.
 * - Orb map (64×64): a 1:1 circular meniscus tailored to the 40×40 orb.
 *
 * Both maps are generated once on first use and cached as static data URIs for
 * the life of the document — never rebuilt per render or animation frame.
 */
const CAPSULE_MAP_W = 320;
const CAPSULE_MAP_H = 56;
const ORB_MAP_SIZE = 64;

let capsuleMapUrl: string | null = null;
let orbMapUrl: string | null = null;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildCapsuleLensMap(): string {
  if (capsuleMapUrl !== null) return capsuleMapUrl;
  const canvas = document.createElement("canvas");
  canvas.width = CAPSULE_MAP_W;
  canvas.height = CAPSULE_MAP_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (capsuleMapUrl = "");

  const image = ctx.createImageData(CAPSULE_MAP_W, CAPSULE_MAP_H);
  const data = image.data;
  const halfW = CAPSULE_MAP_W / 2;
  const halfH = CAPSULE_MAP_H / 2;
  const radius = halfH;
  const spineHalf = halfW - radius;

  for (let y = 0; y < CAPSULE_MAP_H; y++) {
    for (let x = 0; x < CAPSULE_MAP_W; x++) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      // Closest point on the capsule's central spine [-spineHalf, +spineHalf]
      const cx = Math.max(-spineHalf, Math.min(spineHalf, px));
      const dx = px - cx;
      const dy = py;
      const dist = Math.hypot(dx, dy);
      const normDist = dist / radius; // 0 on spine, 1 at capsule rim

      // Localise refraction strictly to the outer curved bevel (0.64..1.0).
      // The interior stays at 0 bend so the long capsule never bulges in the middle.
      const rim = smoothstep(0.64, 0.99, normDist) * (1 - smoothstep(0.99, 1.04, normDist));
      // Slight extra weight at the curved left/right end-caps where curvature is 2D
      const endWeight = 1 + 0.25 * (Math.abs(dx) / (dist || 1));
      const bend = 0.48 * rim * endWeight;

      const nx = dist > 1e-4 ? dx / dist : 0;
      const ny = dist > 1e-4 ? dy / dist : 0;

      const r = Math.round(255 * Math.min(1, Math.max(0, 0.5 - bend * nx)));
      const g = Math.round(255 * Math.min(1, Math.max(0, 0.5 - bend * ny)));
      const i = (y * CAPSULE_MAP_W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  capsuleMapUrl = canvas.toDataURL("image/png");
  return capsuleMapUrl;
}

function buildOrbLensMap(): string {
  if (orbMapUrl !== null) return orbMapUrl;
  const canvas = document.createElement("canvas");
  canvas.width = ORB_MAP_SIZE;
  canvas.height = ORB_MAP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return (orbMapUrl = "");

  const image = ctx.createImageData(ORB_MAP_SIZE, ORB_MAP_SIZE);
  const data = image.data;

  for (let y = 0; y < ORB_MAP_SIZE; y++) {
    for (let x = 0; x < ORB_MAP_SIZE; x++) {
      const u = ((x + 0.5) / ORB_MAP_SIZE) * 2 - 1;
      const v = ((y + 0.5) / ORB_MAP_SIZE) * 2 - 1;
      const d = Math.hypot(u, v) || 1e-6;
      const rim = smoothstep(0.56, 0.98, d) * (1 - smoothstep(0.98, 1.05, d));
      const bend = 0.45 * rim;
      const r = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (bend * u) / d)));
      const g = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (bend * v) / d)));
      const i = (y * ORB_MAP_SIZE + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  orbMapUrl = canvas.toDataURL("image/png");
  return orbMapUrl;
}

/**
 * The lens filters, mounted once per document.
 *
 * Separate displacement maps for capsule and orb geometries so neither
 * stretches the other's optical field. `sRGB` interpolation ensures the
 * displacement channels are read linearly around 0.5 (128).
 *
 * Important technical note: CSS `backdrop-filter` only samples DOM content
 * rendered behind the element inside the same WebView2 document (such as
 * `.pill-aura` or `.glass-probe`), never native OS desktop windows beneath
 * the transparent Tauri window. Furthermore, SVG `url(#...)` in
 * `backdrop-filter` is only supported in Chromium/WebView2 and is ignored or
 * drops the filter chain in WebKit/Safari and Firefox.
 */
export function LiquidLensDefs(): ReactElement {
  const capsuleHref = buildCapsuleLensMap();
  const orbHref = buildOrbLensMap();
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {(
          [
            ["lgs-lens-capsule", capsuleHref, 11],
            ["lgs-lens-orb", orbHref, 6],
            ["lgs-probe-lens", capsuleHref, 26],
            ["lgs-probe-orb-lens", orbHref, 14],
          ] as const
        ).map(([id, href, scale]) => (
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
              href={href}
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
