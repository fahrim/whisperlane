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
// Continuous delta-time phase integration ensures smooth wave propagation at
// 60, 120, and 144 Hz without phase jumps or canvas resets on state changes.

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
  type BrandRibbonMotionMode,
  type BrandWaveState,
  type DeformedRibbonSurface,
  type DeformedSlice,
  type RibbonMotion,
} from "./RibbonDeformer";

export interface BrandRibbonRendererProps {
  state: BrandWaveState;
  width?: number;
  /**
   * "animated" (default) runs the organic liquid wave deformation;
   * "static" locks the renderer to the resting reference brandmark geometry.
   */
  motionMode?: BrandRibbonMotionMode;
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

/** Builds a closed Path2D between two transverse coordinates vTop and vBottom in [-1, 1]. */
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
  filmPhase: number,
): CanvasGradient {
  if (muted) {
    const grad = ctx.createLinearGradient(0, 60, BRAND_VIEWBOX.width, 540);
    grad.addColorStop(0, "#9CA6BE");
    grad.addColorStop(0.35, "#7E88A4");
    grad.addColorStop(0.7, "#6C7590");
    grad.addColorStop(1, "#586079");
    return grad;
  }

  // Smooth chromatic breathing coupled to the integrated film phase
  const shift = Math.sin(filmPhase * 0.65) * 0.065;

  if (id === "ribbon-left") {
    const grad = ctx.createLinearGradient(0, 80, 455, 390);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(
      Math.min(0.9, Math.max(0.1, 0.34 + shift)),
      COLOR_ELECTRIC_BLUE,
    );
    grad.addColorStop(
      Math.min(0.95, Math.max(0.2, 0.72 + shift)),
      COLOR_VIOLET,
    );
    grad.addColorStop(1, COLOR_MAGENTA);
    return grad;
  }

  if (id === "ribbon-center") {
    const grad = ctx.createLinearGradient(270, 560, 705, 180);
    grad.addColorStop(0, COLOR_CYAN);
    grad.addColorStop(
      Math.min(0.9, Math.max(0.1, 0.28 + shift)),
      COLOR_ELECTRIC_BLUE,
    );
    grad.addColorStop(
      Math.min(0.92, Math.max(0.2, 0.64 + shift)),
      COLOR_VIOLET,
    );
    grad.addColorStop(1, COLOR_MAGENTA);
    return grad;
  }

  const grad = ctx.createLinearGradient(606, 490, 1160, 30);
  grad.addColorStop(0, "#6E48F5");
  grad.addColorStop(
    Math.min(0.9, Math.max(0.1, 0.28 + shift)),
    COLOR_VIOLET,
  );
  grad.addColorStop(
    Math.min(0.92, Math.max(0.2, 0.62 + shift)),
    COLOR_MAGENTA,
  );
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
      ctx.fillRect(x0 - 12, -90, x1 - x0 + 24, BRAND_VIEWBOX.height + 180);
      ctx.restore();
    } else if (!muted) {
      const alpha = 0.34 * z.strength;
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(0.5, `rgba(176, 232, 255, ${alpha})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = grad;
      ctx.fillRect(x0 - 12, -90, x1 - x0 + 24, BRAND_VIEWBOX.height + 180);
      ctx.restore();
    }
  }
}

interface AnimationClock {
  lastFrameMs: number | null;
  elapsedSec: number;
  doneElapsedSec: number;
  phase1: number;
  phase2: number;
  filmPhase: number;
  amplitudeScale: number;
  lastState: BrandWaveState;
}

export function BrandRibbonRenderer({
  state,
  width = 78,
  motionMode = "animated",
}: BrandRibbonRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<BrandWaveState>(state);
  const modeRef = useRef<BrandRibbonMotionMode>(motionMode);
  const wakeLoopRef = useRef<(() => void) | null>(null);

  const clockRef = useRef<AnimationClock>({
    lastFrameMs: null,
    elapsedSec: 0,
    doneElapsedSec: 0,
    phase1: 0,
    phase2: 0,
    filmPhase: 0,
    amplitudeScale: 1,
    lastState: state,
  });

  // Update refs without tearing down the canvas or resetting the phase integrator
  if (clockRef.current.lastState !== state) {
    if (state === "done") {
      clockRef.current.doneElapsedSec = 0;
    }
    clockRef.current.lastState = state;
  }
  stateRef.current = state;
  modeRef.current = motionMode;

  const logoHeight = Math.max(
    1,
    Math.round((width * BRAND_VIEWBOX.height) / BRAND_VIEWBOX.width),
  );
  // Generous vertical margin (6 CSS px = ~90 viewBox units top and bottom) so
  // the 1.5-2.8 CSS px wave displacement and glow never clip at canvas edges.
  const padY = 6;
  const padX = 4;
  const cssWidth = width + padX * 2;
  const cssHeight = logoHeight + padY * 2;

  useEffect(() => {
    wakeLoopRef.current?.();
  }, [state, motionMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rawDpr = window.devicePixelRatio || 1;
    const supersample = Math.min(3, Math.max(2, rawDpr * 1.5));
    canvas.width = Math.round(cssWidth * supersample);
    canvas.height = Math.round(cssHeight * supersample);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    const drawScale = (width * supersample) / BRAND_VIEWBOX.width;
    const offsetX = padX * supersample;
    const offsetY =
      (canvas.height - BRAND_VIEWBOX.height * drawScale) * 0.5;

    const applyViewBoxTransform = () => {
      ctx.setTransform(drawScale, 0, 0, drawScale, offsetX, offsetY);
    };

    let frameId = 0;
    let running = false;

    const renderFrame = (now: number) => {
      const clock = clockRef.current;
      const currentState = stateRef.current;
      const currentMode = modeRef.current;
      const profile = getStateProfile(currentState);
      const muted = isMutedState(currentState);
      const isStatic =
        currentMode === "static" || reducedMotionQuery.matches;

      // Delta-time integration (clamped to 64ms so background tab wakeups do not jump)
      const dt =
        clock.lastFrameMs === null
          ? 0
          : Math.min(0.064, Math.max(0, (now - clock.lastFrameMs) / 1000));
      clock.lastFrameMs = now;

      if (!isStatic && !muted) {
        clock.elapsedSec += dt;
        clock.phase1 = (clock.phase1 + profile.omega1 * dt) % (Math.PI * 200);
        clock.phase2 = (clock.phase2 + profile.omega2 * dt) % (Math.PI * 200);
        clock.filmPhase =
          (clock.filmPhase + profile.filmSpeed * dt) % (Math.PI * 200);
        if (currentState === "done") {
          clock.doneElapsedSec += dt;
        }
      }

      // Smoothly damp amplitude scale across state transitions
      const targetScale = isStatic || muted ? 0 : 1;
      const dampRate = dt > 0 ? 1 - Math.exp(-dt * 8) : 1;
      clock.amplitudeScale += (targetScale - clock.amplitudeScale) * dampRate;

      const motion: RibbonMotion = {
        state: currentState,
        time: clock.elapsedSec,
        doneElapsed: clock.doneElapsedSec,
        still: isStatic,
        phase1: clock.phase1,
        phase2: clock.phase2,
        filmPhase: clock.filmPhase,
        amplitudeScale: clock.amplitudeScale,
        renderWidth: width,
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
      // LAYER B: Volumetric Glow (Geometry-Matched 1:1 to Deformed Ribbons)
      // ---------------------------------------------------------------------
      ctx.save();
      ctx.globalAlpha = profile.glowOpacity;
      ctx.filter = `blur(${currentState === "thinking" ? 4.2 : 3.2}px)`;
      ctx.shadowColor = profile.primaryGlowColor;
      ctx.shadowBlur = currentState === "thinking" ? 14 : 10;

      for (let i = 0; i < deformedRibbons.length; i++) {
        const d = deformedRibbons[i];
        ctx.fillStyle = createRibbonBodyGradient(
          ctx,
          d.id,
          muted,
          clock.filmPhase,
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
          clock.filmPhase,
        );
        ctx.fillStyle = baseGrad;
        ctx.fill(bodyPath);

        // Clip all internal volumetric, film, occlusion, and specular layers
        // strictly to this ribbon's deformed closed contour.
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
          film0Grad.addColorStop(0, "rgba(34, 221, 235, 0.54)");
          film0Grad.addColorStop(0.5, "rgba(50, 140, 255, 0.46)");
          film0Grad.addColorStop(1, "rgba(149, 96, 255, 0.50)");

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
          film1Grad.addColorStop(0, "rgba(50, 140, 255, 0.42)");
          film1Grad.addColorStop(0.45, "rgba(149, 96, 255, 0.48)");
          film1Grad.addColorStop(0.78, "rgba(227, 74, 231, 0.54)");
          film1Grad.addColorStop(1, "rgba(255, 113, 159, 0.52)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = film1Grad;
          ctx.fill(film1Path);
          ctx.restore();
        }

        // --- A3. Transverse Cylindrical Shading (v in [-1, 1] roundness) ---
        const upperCrownPath = buildTransverseBandPath(slices, 1.0, 0.32);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = muted
          ? "rgba(255, 255, 255, 0.10)"
          : "rgba(224, 248, 255, 0.19)";
        ctx.fill(upperCrownPath);
        ctx.restore();

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

        const spineGrad = ctx.createLinearGradient(
          surface.xMin,
          0,
          surface.xMax,
          0,
        );
        const baseLuster =
          (muted ? 0.12 : 0.25 + 0.04 * Math.sin(clock.filmPhase)) *
          profile.specularIntensity;
        spineGrad.addColorStop(0, "rgba(255, 255, 255, 0.04)");
        spineGrad.addColorStop(0.3, `rgba(215, 250, 255, ${baseLuster})`);
        spineGrad.addColorStop(0.7, `rgba(245, 230, 255, ${baseLuster})`);
        spineGrad.addColorStop(1, "rgba(255, 255, 255, 0.06)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = spineGrad;
        ctx.fill(specPath);
        ctx.restore();

        if (sheenPos !== null && !muted) {
          const bandCenter =
            (-0.22 + sheenPos * 1.44) * BRAND_VIEWBOX.width;
          const bandHalfWidth = currentState === "thinking" ? 210 : 185;
          const travelGrad = ctx.createLinearGradient(
            bandCenter - bandHalfWidth,
            0,
            bandCenter + bandHalfWidth,
            0,
          );
          const peakAlpha =
            (currentState === "done" ? 0.88 : 0.68) *
            profile.specularIntensity;

          travelGrad.addColorStop(0, "rgba(34, 221, 235, 0)");
          travelGrad.addColorStop(
            0.28,
            `rgba(34, 221, 235, ${peakAlpha * 0.45})`,
          );
          travelGrad.addColorStop(
            0.5,
            `rgba(255, 255, 255, ${peakAlpha})`,
          );
          travelGrad.addColorStop(
            0.72,
            `rgba(195, 165, 255, ${peakAlpha * 0.45})`,
          );
          travelGrad.addColorStop(1, "rgba(149, 96, 255, 0)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = travelGrad;
          ctx.fill(specPath);
          ctx.globalAlpha = 0.42;
          ctx.fillRect(0, -90, BRAND_VIEWBOX.width, BRAND_VIEWBOX.height + 180);
          ctx.restore();
        }

        ctx.restore(); // End ribbon clip

        // --- D. Edge Highlights (Upper v=+1 & Lower v=-1 Deformed Boundaries) ---
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
          surface.xMin +
          surface.upperRimRange[0] * (surface.xMax - surface.xMin);
        const rimSpanX1 =
          surface.xMin +
          surface.upperRimRange[1] * (surface.xMax - surface.xMin);
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

    const shouldContinueAnimating = () => {
      if (modeRef.current === "static" || reducedMotionQuery.matches) {
        return false;
      }
      if (stateRef.current === "muted") {
        return clockRef.current.amplitudeScale > 0.01;
      }
      if (stateRef.current === "done") {
        return clockRef.current.doneElapsedSec <= DONE_SETTLE_DURATION + 0.15;
      }
      return true;
    };

    const tick = (now: number) => {
      renderFrame(now);
      if (shouldContinueAnimating()) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        running = false;
        clockRef.current.lastFrameMs = null;
      }
    };

    const wakeLoop = () => {
      if (running) return;
      clockRef.current.lastFrameMs = null;
      renderFrame(performance.now());
      if (shouldContinueAnimating()) {
        running = true;
        frameId = window.requestAnimationFrame(tick);
      }
    };

    wakeLoopRef.current = wakeLoop;
    wakeLoop();

    return () => {
      running = false;
      wakeLoopRef.current = null;
      window.cancelAnimationFrame(frameId);
    };
  }, [width, cssWidth, cssHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="pill-brand-wave"
      data-state={state}
      data-motion={motionMode}
      style={{
        width: `${cssWidth}px`,
        height: `${cssHeight}px`,
      }}
      aria-hidden="true"
    />
  );
}
