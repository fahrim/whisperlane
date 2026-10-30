// Volumetric Brand Ribbon Renderer (Section 5 & 8).
//
// Renders the three closed ribbon surfaces of the Whisperline brandmark in
// back-to-front depth order with five distinct optical layers per ribbon:
//   A. Ribbon Body (closed filled geometry + longitudinal & transverse gradients
//      + translucent intersecting chromatic film sub-ribbons)
//   B. Volumetric Glow (1:1 duplicate of the deformed closed ribbon geometry)
//   C. Internal Specular Highlight (parametric centerline ridge strip clipped
//      strictly inside each ribbon boundary)
//   D. Edge Highlight (true upper v=+1 and lower v=-1 rim highlights)
//   E. Layer Overlap (under-fold occlusion shadows and over-fold caustic lift)
//
// Technical rationale for High-DPI 2D Canvas with Path2D clipping:
// Real-time parametric deformation R(u, v, t) updates ~240 vertices across multiple
// overlapping volumetric layers at display refresh rate (60-144Hz). Rendering via
// supersampled 2D Canvas with analytical Path2D clipping avoids per-frame React
// state updates and DOM SVG string serialization while preserving crisp sub-pixel
// vector edges and hardware-accelerated composite blending ("screen", "source-over").

import { useEffect, useRef } from "react";

import {
  BRAND_RIBBON_SURFACES,
  BRAND_VIEWBOX,
  type LongitudinalZone,
  type RibbonId,
  type Vec2,
} from "./brandmarkGeometry";
import {
  buildInternalWaveStrip,
  buildSpecularCoreStrip,
  deformRibbonSurface,
  DONE_SETTLE_DURATION,
  evaluateSheenProgress,
  getStateProfile,
  isMutedState,
  pointOnDeformedSlice,
  type BrandWaveState,
  type DeformedRibbonSurface,
  type DeformedSlice,
  type RibbonMotion,
} from "./RibbonDeformer";

export interface BrandRibbonRendererProps {
  state: BrandWaveState;
  width?: number;
}

// Brand chromatic family (Section 5.A)
const COLOR_CYAN = "#22DDEB";
const COLOR_ELECTRIC_BLUE = "#328CFF";
const COLOR_VIOLET = "#9560FF";
const COLOR_MAGENTA = "#E34AE7";
const COLOR_PINK = "#FF719F";

/** Builds a closed Path2D from an upper curve (left-to-right) and lower curve (right-to-left). */
function buildClosedStripPath(
  upperPts: readonly Vec2[],
  lowerPts: readonly Vec2[],
): Path2D {
  const path = new Path2D();
  if (upperPts.length === 0 || lowerPts.length === 0) return path;

  path.moveTo(upperPts[0][0], upperPts[0][1]);
  for (let i = 1; i < upperPts.length; i++) {
    path.lineTo(upperPts[i][0], upperPts[i][1]);
  }
  for (let i = lowerPts.length - 1; i >= 0; i--) {
    path.lineTo(lowerPts[i][0], lowerPts[i][1]);
  }
  path.closePath();
  return path;
}

/** Builds a closed Path2D for a deformed ribbon surface (v = +1 and v = -1). */
function buildRibbonBodyPath(deformed: DeformedRibbonSurface): Path2D {
  const slices = deformed.slices;
  const path = new Path2D();
  if (slices.length === 0) return path;

  path.moveTo(slices[0].upper[0], slices[0].upper[1]);
  for (let i = 1; i < slices.length; i++) {
    path.lineTo(slices[i].upper[0], slices[i].upper[1]);
  }
  for (let i = slices.length - 1; i >= 0; i--) {
    path.lineTo(slices[i].lower[0], slices[i].lower[1]);
  }
  path.closePath();
  return path;
}

/** Builds a closed Path2D between two transverse coordinates vA and vB in [-1, 1]. */
function buildTransverseBandPath(
  slices: readonly DeformedSlice[],
  vTop: number,
  vBottom: number,
): Path2D {
  const path = new Path2D();
  if (slices.length === 0) return path;

  const firstTop = pointOnDeformedSlice(slices[0], vTop);
  path.moveTo(firstTop[0], firstTop[1]);
  for (let i = 1; i < slices.length; i++) {
    const p = pointOnDeformedSlice(slices[i], vTop);
    path.lineTo(p[0], p[1]);
  }
  for (let i = slices.length - 1; i >= 0; i--) {
    const p = pointOnDeformedSlice(slices[i], vBottom);
    path.lineTo(p[0], p[1]);
  }
  path.closePath();
  return path;
}

/** Builds an open Path2D along either the upper (v=+1) or lower (v=-1) boundary within [uStart, uEnd]. */
function buildRimSubPath(
  slices: readonly DeformedSlice[],
  boundary: "upper" | "lower",
  uRange: readonly [number, number],
): Path2D {
  const path = new Path2D();
  const [uMin, uMax] = uRange;
  let started = false;

  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    if (s.u < uMin || s.u > uMax) continue;
    const pt = boundary === "upper" ? s.upper : s.lower;
    if (!started) {
      path.moveTo(pt[0], pt[1]);
      started = true;
    } else {
      path.lineTo(pt[0], pt[1]);
    }
  }
  return path;
}

/**
 * Creates a tailored 2D diagonal gradient per ribbon so each fold carries both
 * longitudinal (left-to-right) and transverse (top-to-bottom) chromatic flow.
 */
function createRibbonBodyGradient(
  ctx: CanvasRenderingContext2D,
  id: RibbonId,
  muted: boolean,
  time: number,
): CanvasGradient {
  if (muted) {
    const grad = ctx.createLinearGradient(0, 60, BRAND_VIEWBOX.width, 540);
    grad.addColorStop(0, "#9CA6BE");
    grad.addColorStop(0.35, "#7E88A4");
    grad.addColorStop(0.7, "#6C7590");
    grad.addColorStop(1, "#586079");
    return grad;
  }

  // Subtle slow phase drift so the gradient film feels optically alive
  const shift = Math.sin(time * 0.7) * 0.04;

  if (id === "ribbon-left") {
    // Left wave lobe & tall spike: bright Cyan on upper-left crest, Electric Blue
    // through the center, Violet & Magenta in the lower lobe and descending fold.
    const grad = ctx.createLinearGradient(0, 80, 455, 390);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(Math.min(0.9, Math.max(0.1, 0.34 + shift)), COLOR_ELECTRIC_BLUE);
    grad.addColorStop(Math.min(0.95, Math.max(0.2, 0.72 + shift)), COLOR_VIOLET);
    grad.addColorStop(1, COLOR_MAGENTA);
    return grad;
  }

  if (id === "ribbon-center") {
    // Center foreground ribbon: sweeps from Cyan/Electric Blue at the bottom-left
    // trough up through Violet into vibrant Magenta on the upper-right crest.
    const grad = ctx.createLinearGradient(270, 560, 705, 180);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(Math.min(0.9, Math.max(0.1, 0.28 + shift)), COLOR_ELECTRIC_BLUE);
    grad.addColorStop(Math.min(0.92, Math.max(0.2, 0.64 + shift)), COLOR_VIOLET);
    grad.addColorStop(1, COLOR_MAGENTA);
    return grad;
  }

  // ribbon-right: emerges in deep Violet under the arch, curves through Magenta
  // in the second trough, and rises to luminous Pink/Coral at the top-right tail.
  const grad = ctx.createLinearGradient(606, 490, 1160, 30);
  grad.addColorStop(0, "#6E48F5");
  grad.addColorStop(Math.min(0.9, Math.max(0.1, 0.28 + shift)), COLOR_VIOLET);
  grad.addColorStop(Math.min(0.92, Math.max(0.2, 0.62 + shift)), COLOR_MAGENTA);
  grad.addColorStop(1, COLOR_PINK);
  return grad;
}

/**
 * Renders soft occlusion shadows where an under-passing ribbon tucks beneath
 * the foreground arch, or luminous caustic lift where the foreground arch crosses over.
 */
function renderOverlapZones(
  ctx: CanvasRenderingContext2D,
  surfaceXMin: number,
  surfaceXMax: number,
  zones: readonly LongitudinalZone[],
  mode: "occlusion" | "overpass",
  muted: boolean,
) {
  if (zones.length === 0) return;
  const span = surfaceXMax - surfaceXMin;

  for (const z of zones) {
    const x0 = surfaceXMin + z.uStart * span;
    const x1 = surfaceXMin + z.uEnd * span;
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);

    if (mode === "occlusion") {
      const alpha = (muted ? 0.35 : 0.62) * z.strength;
      grad.addColorStop(0, "rgba(10, 12, 32, 0)");
      grad.addColorStop(0.45, `rgba(14, 16, 46, ${alpha * 0.75})`);
      grad.addColorStop(0.85, `rgba(8, 10, 28, ${alpha})`);
      grad.addColorStop(1, `rgba(8, 10, 28, ${alpha * 0.9})`);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = grad;
      ctx.fillRect(x0 - 8, 0, x1 - x0 + 16, BRAND_VIEWBOX.height);
      ctx.restore();
    } else if (!muted) {
      const alpha = 0.34 * z.strength;
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(0.5, `rgba(176, 232, 255, ${alpha})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = grad;
      ctx.fillRect(x0 - 8, 0, x1 - x0 + 16, BRAND_VIEWBOX.height);
      ctx.restore();
    }
  }
}

export function BrandRibbonRenderer({
  state,
  width = 80,
}: BrandRibbonRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseClockRef = useRef<{ startedAt: number; doneStartedAt: number }>({
    startedAt: 0,
    doneStartedAt: 0,
  });

  const logoHeight = Math.max(
    1,
    Math.round((width * BRAND_VIEWBOX.height) / BRAND_VIEWBOX.width),
  );
  // Extra vertical breathing room so the tall acoustic spike (y=0) and deep W
  // troughs (y=578) never clip during normal deformation or volumetric glow.
  const padY = 5;
  const padX = 3;
  const cssWidth = width + padX * 2;
  const cssHeight = logoHeight + padY * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Supersample on standard/Retina displays so sub-pixel negative spaces and
    // rim highlights remain razor-sharp at 50-100px pill sizes.
    const rawDpr = window.devicePixelRatio || 1;
    const supersample = Math.min(3, Math.max(2, rawDpr * 1.5));
    canvas.width = Math.round(cssWidth * supersample);
    canvas.height = Math.round(cssHeight * supersample);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nowInit = performance.now();
    if (phaseClockRef.current.startedAt === 0) {
      phaseClockRef.current.startedAt = nowInit;
    }
    if (state === "done") {
      phaseClockRef.current.doneStartedAt = nowInit;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const drawScale = (width * supersample) / BRAND_VIEWBOX.width;
    const offsetX = padX * supersample;
    const offsetY =
      (canvas.height - BRAND_VIEWBOX.height * drawScale) * 0.5;

    const applyViewBoxTransform = () => {
      ctx.setTransform(drawScale, 0, 0, drawScale, offsetX, offsetY);
    };

    const profile = getStateProfile(state);
    const muted = isMutedState(state);

    let frameId = 0;

    const renderFrame = (now: number) => {
      const elapsedSec = (now - phaseClockRef.current.startedAt) / 1000;
      const doneElapsed =
        state === "done"
          ? (now - phaseClockRef.current.doneStartedAt) / 1000
          : 0;

      const motion: RibbonMotion = {
        state,
        time: elapsedSec,
        doneElapsed,
        still: reducedMotion,
      };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      applyViewBoxTransform();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 1. Deform all three ribbon surfaces in their local (u, v) frames
      const deformedRibbons = BRAND_RIBBON_SURFACES.map((surface) =>
        deformRibbonSurface(surface, motion),
      );
      const bodyPaths = deformedRibbons.map((d) => buildRibbonBodyPath(d));

      // ---------------------------------------------------------------------
      // LAYER B: Volumetric Glow (Geometry-Matched 1:1 to Ribbon Bodies)
      // ---------------------------------------------------------------------
      ctx.save();
      ctx.globalAlpha = profile.glowOpacity;
      ctx.filter = `blur(${state === "thinking" ? 4.2 : 3.2}px)`;
      ctx.shadowColor = profile.primaryGlowColor;
      ctx.shadowBlur = state === "thinking" ? 14 : 10;

      for (let i = 0; i < deformedRibbons.length; i++) {
        const d = deformedRibbons[i];
        ctx.fillStyle = createRibbonBodyGradient(
          ctx,
          d.id,
          muted,
          motion.time,
        );
        ctx.fill(bodyPaths[i]);
      }
      ctx.restore();

      // ---------------------------------------------------------------------
      // LAYERS A, E, C, D: Per-Ribbon Back-to-Front Volumetric Rendering
      // ---------------------------------------------------------------------
      const sheenPos = evaluateSheenProgress(motion);

      for (let i = 0; i < deformedRibbons.length; i++) {
        const deformed = deformedRibbons[i];
        const bodyPath = bodyPaths[i];
        const { surface, slices } = deformed;

        ctx.save();
        if (muted) {
          ctx.globalAlpha = 0.74;
        }

        // --- A1. Primary Filled Ribbon Body ---
        const baseGrad = createRibbonBodyGradient(
          ctx,
          deformed.id,
          muted,
          motion.time,
        );
        ctx.fillStyle = baseGrad;
        ctx.fill(bodyPath);

        // Clip all internal volumetric, film, occlusion, and specular layers
        // strictly to this ribbon's closed contour.
        ctx.save();
        ctx.clip(bodyPath);

        if (!muted) {
          // --- A2. Optical Film Sub-Ribbons (Translucent Chromatic Waves) ---
          const film0 = buildInternalWaveStrip(deformed, 0, motion);
          const film0Path = buildClosedStripPath(
            film0.upperPts,
            film0.lowerPts,
          );
          const film0Grad = ctx.createLinearGradient(
            surface.xMin,
            120,
            surface.xMax,
            440,
          );
          film0Grad.addColorStop(0, "rgba(34, 221, 235, 0.52)");
          film0Grad.addColorStop(0.5, "rgba(50, 140, 255, 0.44)");
          film0Grad.addColorStop(1, "rgba(149, 96, 255, 0.48)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = film0Grad;
          ctx.fill(film0Path);
          ctx.restore();

          const film1 = buildInternalWaveStrip(deformed, 1, motion);
          const film1Path = buildClosedStripPath(
            film1.upperPts,
            film1.lowerPts,
          );
          const film1Grad = ctx.createLinearGradient(
            surface.xMin,
            460,
            surface.xMax,
            140,
          );
          film1Grad.addColorStop(0, "rgba(50, 140, 255, 0.40)");
          film1Grad.addColorStop(0.45, "rgba(149, 96, 255, 0.46)");
          film1Grad.addColorStop(0.78, "rgba(227, 74, 231, 0.52)");
          film1Grad.addColorStop(1, "rgba(255, 113, 159, 0.50)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = film1Grad;
          ctx.fill(film1Path);
          ctx.restore();
        }

        // --- A3. Transverse Cylindrical Shading (v in [-1, 1] roundness) ---
        // Upper crown light catch (v in [0.35, 1.0])
        const upperCrownPath = buildTransverseBandPath(slices, 1.0, 0.32);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = muted
          ? "rgba(255, 255, 255, 0.10)"
          : "rgba(224, 248, 255, 0.18)";
        ctx.fill(upperCrownPath);
        ctx.restore();

        // Lower belly curvature depth (v in [-1.0, -0.36])
        const lowerBellyPath = buildTransverseBandPath(slices, -0.36, -1.0);
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = muted
          ? "rgba(15, 18, 34, 0.24)"
          : "rgba(16, 12, 48, 0.26)";
        ctx.fill(lowerBellyPath);
        ctx.restore();

        // --- E. Layer Overlap Occlusion & Overpass Caustics ---
        renderOverlapZones(
          ctx,
          surface.xMin,
          surface.xMax,
          surface.occlusionZones,
          "occlusion",
          muted,
        );
        renderOverlapZones(
          ctx,
          surface.xMin,
          surface.xMax,
          surface.overpassZones,
          "overpass",
          muted,
        );

        // --- C. Internal Specular Highlight (Parametric Centerline Core) ---
        const specStrip = buildSpecularCoreStrip(deformed, motion);
        const specPath = buildClosedStripPath(
          specStrip.upperPts,
          specStrip.lowerPts,
        );

        // Persistent soft 3D core luster along the ribbon's spine
        const spineGrad = ctx.createLinearGradient(
          surface.xMin,
          0,
          surface.xMax,
          0,
        );
        const baseLuster = (muted ? 0.12 : 0.24) * profile.specularIntensity;
        spineGrad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
        spineGrad.addColorStop(0.3, `rgba(215, 250, 255, ${baseLuster})`);
        spineGrad.addColorStop(0.7, `rgba(245, 230, 255, ${baseLuster})`);
        spineGrad.addColorStop(1, "rgba(255, 255, 255, 0.06)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = spineGrad;
        ctx.fill(specPath);
        ctx.restore();

        // Traveling specular wave packet along the ribbon spine
        if (sheenPos !== null && !muted) {
          const bandCenter =
            (-0.22 + sheenPos * 1.44) * BRAND_VIEWBOX.width;
          const bandHalfWidth = state === "thinking" ? 210 : 185;
          const travelGrad = ctx.createLinearGradient(
            bandCenter - bandHalfWidth,
            0,
            bandCenter + bandHalfWidth,
            0,
          );
          const peakAlpha =
            (state === "done" ? 0.88 : 0.68) * profile.specularIntensity;

          travelGrad.addColorStop(0, "rgba(34, 221, 235, 0)");
          travelGrad.addColorStop(0.28, `rgba(34, 221, 235, ${peakAlpha * 0.45})`);
          travelGrad.addColorStop(0.5, `rgba(255, 255, 255, ${peakAlpha})`);
          travelGrad.addColorStop(0.72, `rgba(195, 165, 255, ${peakAlpha * 0.45})`);
          travelGrad.addColorStop(1, "rgba(149, 96, 255, 0)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = travelGrad;
          // Fill the parametric core strip first for concentrated spine glow,
          // plus a softer full-surface wash inside the clipped ribbon.
          ctx.fill(specPath);
          ctx.globalAlpha = 0.42;
          ctx.fillRect(0, 0, BRAND_VIEWBOX.width, BRAND_VIEWBOX.height);
          ctx.restore();
        }

        ctx.restore(); // End ribbon clip

        // --- D. Edge Highlights (Upper v=+1 & Lower v=-1 Outer Boundaries) ---
        const upperRimPath = buildRimSubPath(
          slices,
          "upper",
          surface.upperRimRange,
        );
        const lowerRimPath = buildRimSubPath(
          slices,
          "lower",
          surface.lowerRimRange,
        );

        const rimSpanX0 =
          surface.xMin + surface.upperRimRange[0] * (surface.xMax - surface.xMin);
        const rimSpanX1 =
          surface.xMin + surface.upperRimRange[1] * (surface.xMax - surface.xMin);
        const upperRimGrad = ctx.createLinearGradient(
          rimSpanX0,
          0,
          rimSpanX1,
          0,
        );
        upperRimGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
        upperRimGrad.addColorStop(
          0.16,
          muted ? "rgba(220, 228, 245, 0.22)" : "rgba(235, 252, 255, 0.62)",
        );
        upperRimGrad.addColorStop(
          0.52,
          muted ? "rgba(220, 228, 245, 0.28)" : "rgba(255, 255, 255, 0.78)",
        );
        upperRimGrad.addColorStop(
          0.86,
          muted ? "rgba(220, 228, 245, 0.20)" : "rgba(245, 215, 255, 0.56)",
        );
        upperRimGrad.addColorStop(1, "rgba(255, 255, 255, 0)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = upperRimGrad;
        ctx.lineWidth = 11.5;
        ctx.stroke(upperRimPath);

        // Subtle secondary lower rim reflection
        const lowerRimGrad = ctx.createLinearGradient(
          surface.xMin,
          0,
          surface.xMax,
          0,
        );
        lowerRimGrad.addColorStop(0, "rgba(34, 221, 235, 0)");
        lowerRimGrad.addColorStop(
          0.35,
          muted ? "rgba(180, 190, 210, 0.14)" : "rgba(34, 221, 235, 0.42)",
        );
        lowerRimGrad.addColorStop(
          0.75,
          muted ? "rgba(180, 190, 210, 0.14)" : "rgba(227, 74, 231, 0.38)",
        );
        lowerRimGrad.addColorStop(1, "rgba(255, 113, 159, 0)");

        ctx.strokeStyle = lowerRimGrad;
        ctx.lineWidth = 8.0;
        ctx.stroke(lowerRimPath);
        ctx.restore();

        ctx.restore();
      }
    };

    const tick = (now: number) => {
      renderFrame(now);
      if (reducedMotion || state === "muted") return;
      if (
        state === "done" &&
        (now - phaseClockRef.current.doneStartedAt) / 1000 >
          DONE_SETTLE_DURATION + 0.1
      ) {
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    renderFrame(performance.now());
    if (!reducedMotion && state !== "muted") {
      frameId = window.requestAnimationFrame(tick);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [state, width, cssWidth, cssHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="pill-brand-wave"
      data-state={state}
      style={{
        width: `${cssWidth}px`,
        height: `${cssHeight}px`,
      }}
      aria-hidden="true"
    />
  );
}
