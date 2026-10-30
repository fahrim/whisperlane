// Volumetric Brand Ribbon Renderer — Horizontal Wave Propagation & Multi-Layer
// Chromatic Interference (Section 4, 5 & 6).
//
// Renders the three closed ribbon surfaces of the Whisperline brandmark in
// back-to-front depth order with five distinct optical layers per ribbon:
//   A. Ribbon Body (closed filled geometry + longitudinal & transverse gradients
//      + three counter-propagating translucent chromatic wave sub-ribbons that
//      optically interfere and brighten where they cross)
//   B. Volumetric Glow (1:1 duplicate of the deformed closed ribbon geometry)
//   C. Internal Specular Highlight & Central Signal Core (parametric centerline
//      strip clipped strictly inside each ribbon boundary)
//   D. Edge Highlight (true upper v=+1 and lower v=-1 deformed rim highlights)
//   E. Layer Overlap (under-fold occlusion shadows and over-fold caustic lift)

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
  getRibbonTuningConfig,
  getStateProfile,
  isMutedState,
  pointOnDeformedSlice,
  subscribeRibbonTuningConfig,
  type BrandRibbonMotionMode,
  type BrandWaveState,
  type DeformedRibbonSurface,
  type DeformedSlice,
  type RibbonMaterialTuning,
  type RibbonMotion,
  type RibbonTuningConfig,
} from "./RibbonDeformer";

export interface BrandRibbonRendererProps {
  state: BrandWaveState;
  width?: number;
  /**
   * "animated" (default) runs the horizontal wave propagation;
   * "static" locks the renderer to the resting reference brandmark geometry.
   */
  motionMode?: BrandRibbonMotionMode;
  /** Optional explicit tuning configuration override (defaults to active runtime config). */
  tuningConfig?: RibbonTuningConfig;
  /** Optional counter to replay one-shot animations like the "done" settling pulse. */
  replayNonce?: number;
}

// Brand chromatic family (Section 6)
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

  const shift = Math.sin(filmPhase * 0.75) * 0.075;

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
  material: RibbonMaterialTuning,
) {
  if (zones.length === 0) return;
  const span = surfaceXMax - surfaceXMin;

  for (const z of zones) {
    const x0 = surfaceXMin + z.uStart * span;
    const x1 = surfaceXMin + z.uEnd * span;
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);

    if (mode === "occlusion") {
      const baseStrength = muted ? 0.35 : material.occlusionStrength;
      const alpha = Math.min(1, Math.max(0, baseStrength * z.strength));
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
      const alpha = Math.min(
        1,
        Math.max(0, material.overpassCausticStrength * z.strength),
      );
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(0.5, `rgba(195, 240, 255, ${alpha})`);
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
  phase3: number;
  filmPhase: number;
  amplitudeScale: number;
  lastState: BrandWaveState;
  lastReplayNonce: number;
}

export function BrandRibbonRenderer({
  state,
  width = 78,
  motionMode = "animated",
  tuningConfig,
  replayNonce = 0,
}: BrandRibbonRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<BrandWaveState>(state);
  const modeRef = useRef<BrandRibbonMotionMode>(motionMode);
  const tuningRef = useRef<RibbonTuningConfig | undefined>(tuningConfig);
  const wakeLoopRef = useRef<(() => void) | null>(null);

  const clockRef = useRef<AnimationClock>({
    lastFrameMs: null,
    elapsedSec: 0,
    doneElapsedSec: 0,
    phase1: 0,
    phase2: 0,
    phase3: 0,
    filmPhase: 0,
    amplitudeScale: 1,
    lastState: state,
    lastReplayNonce: replayNonce,
  });

  if (
    clockRef.current.lastState !== state ||
    clockRef.current.lastReplayNonce !== replayNonce
  ) {
    if (state === "done") {
      clockRef.current.doneElapsedSec = 0;
    }
    clockRef.current.lastState = state;
    clockRef.current.lastReplayNonce = replayNonce;
  }
  stateRef.current = state;
  modeRef.current = motionMode;
  tuningRef.current = tuningConfig;

  const logoHeight = Math.max(
    1,
    Math.round((width * BRAND_VIEWBOX.height) / BRAND_VIEWBOX.width),
  );
  const padY = 6;
  const padX = 4;
  const cssWidth = width + padX * 2;
  const cssHeight = logoHeight + padY * 2;

  useEffect(() => {
    wakeLoopRef.current?.();
  }, [state, motionMode, tuningConfig, replayNonce]);

  useEffect(() => {
    return subscribeRibbonTuningConfig(() => {
      wakeLoopRef.current?.();
    });
  }, []);

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
      const config = tuningRef.current ?? getRibbonTuningConfig();
      const { material } = config;
      const profile = getStateProfile(currentState, config);
      const muted = isMutedState(currentState);
      const isStatic =
        currentMode === "static" || reducedMotionQuery.matches;

      const dt =
        clock.lastFrameMs === null
          ? 0
          : Math.min(0.064, Math.max(0, (now - clock.lastFrameMs) / 1000));
      clock.lastFrameMs = now;

      if (!isStatic && !muted) {
        clock.elapsedSec += dt;
        clock.phase1 = (clock.phase1 + profile.omega1 * dt) % (Math.PI * 200);
        clock.phase2 = (clock.phase2 + profile.omega2 * dt) % (Math.PI * 200);
        clock.phase3 = (clock.phase3 + profile.omega3 * dt) % (Math.PI * 200);
        clock.filmPhase =
          (clock.filmPhase + profile.filmSpeed * dt) % (Math.PI * 200);
        if (currentState === "done") {
          clock.doneElapsedSec += dt;
        }
      }

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
        phase3: clock.phase3,
        filmPhase: clock.filmPhase,
        amplitudeScale: clock.amplitudeScale,
        renderWidth: width,
      };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      applyViewBoxTransform();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 1. Deform all three ribbon surfaces with horizontal wave propagation
      const deformedRibbons = BRAND_RIBBON_SURFACES.map((surface) =>
        deformRibbonSurface(surface, motion, config),
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
      const sheenPos = evaluateSheenProgress(motion, config);

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

        // Clip all internal chromatic wave strips, volume shading, occlusion,
        // and specular core strictly to this ribbon's deformed closed contour.
        ctx.save();
        ctx.clip(bodyPath);

        // --- A2. Transverse Cylindrical Shading (v in [-1, 1] roundness) ---
        const upperCrownPath = buildTransverseBandPath(slices, 1.0, 0.34);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = muted
          ? "rgba(255, 255, 255, 0.10)"
          : "rgba(224, 248, 255, 0.18)";
        ctx.fill(upperCrownPath);
        ctx.restore();

        const lowerBellyPath = buildTransverseBandPath(slices, -0.36, -1.0);
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = muted
          ? "rgba(15, 18, 34, 0.24)"
          : "rgba(16, 12, 48, 0.24)";
        ctx.fill(lowerBellyPath);
        ctx.restore();

        if (!muted) {
          // --- A3. Three Intersecting Chromatic Wave Sub-Ribbons (Section 4 & 5) ---
          const f0Scale = Math.max(0, material.film0Opacity / 0.58);
          const film0 = buildInternalWaveStrip(deformed, 0, motion, config);
          const film0Path = buildClosedStripPath(
            film0.upperPts,
            film0.lowerPts,
          );
          const film0Grad = ctx.createLinearGradient(
            surface.xMin,
            100,
            surface.xMax,
            460,
          );
          film0Grad.addColorStop(
            0,
            `rgba(34, 221, 235, ${Math.min(1, 0.62 * f0Scale)})`,
          );
          film0Grad.addColorStop(
            0.48,
            `rgba(50, 140, 255, ${Math.min(1, 0.54 * f0Scale)})`,
          );
          film0Grad.addColorStop(
            1,
            `rgba(149, 96, 255, ${Math.min(1, 0.56 * f0Scale)})`,
          );

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = film0Grad;
          ctx.fill(film0Path);
          ctx.restore();

          // Layer 1: Electric Blue -> Violet -> Magenta -> Pink counter-phased wave
          const f1Scale = Math.max(0, material.film1Opacity / 0.58);
          const film1 = buildInternalWaveStrip(deformed, 1, motion, config);
          const film1Path = buildClosedStripPath(
            film1.upperPts,
            film1.lowerPts,
          );
          const film1Grad = ctx.createLinearGradient(
            surface.xMin,
            480,
            surface.xMax,
            120,
          );
          film1Grad.addColorStop(
            0,
            `rgba(50, 140, 255, ${Math.min(1, 0.48 * f1Scale)})`,
          );
          film1Grad.addColorStop(
            0.42,
            `rgba(149, 96, 255, ${Math.min(1, 0.56 * f1Scale)})`,
          );
          film1Grad.addColorStop(
            0.75,
            `rgba(227, 74, 231, ${Math.min(1, 0.62 * f1Scale)})`,
          );
          film1Grad.addColorStop(
            1,
            `rgba(255, 113, 159, ${Math.min(1, 0.58 * f1Scale)})`,
          );

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = film1Grad;
          ctx.fill(film1Path);
          ctx.restore();

          // Layer 2: Additive interference wave strip ("lighter" composite mode)
          const f2Scale = Math.max(0, material.film2AdditiveOpacity / 0.42);
          const film2 = buildInternalWaveStrip(deformed, 2, motion, config);
          const film2Path = buildClosedStripPath(
            film2.upperPts,
            film2.lowerPts,
          );
          const film2Grad = ctx.createLinearGradient(
            BRAND_VIEWBOX.width * 0.12,
            0,
            BRAND_VIEWBOX.width * 0.88,
            0,
          );
          film2Grad.addColorStop(
            0,
            `rgba(34, 221, 235, ${Math.min(1, 0.08 * f2Scale)})`,
          );
          film2Grad.addColorStop(
            0.32,
            `rgba(56, 224, 248, ${Math.min(1, 0.34 * f2Scale)})`,
          );
          film2Grad.addColorStop(
            0.55,
            `rgba(216, 180, 254, ${Math.min(1, 0.42 * f2Scale)})`,
          );
          film2Grad.addColorStop(
            0.78,
            `rgba(244, 114, 182, ${Math.min(1, 0.32 * f2Scale)})`,
          );
          film2Grad.addColorStop(
            1,
            `rgba(255, 113, 159, ${Math.min(1, 0.08 * f2Scale)})`,
          );

          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = film2Grad;
          ctx.fill(film2Path);
          ctx.restore();
        }

        // --- E. Layer Overlap Occlusion & Overpass Caustics ---
        renderOverlapZones(
          ctx,
          surface.xMin,
          surface.xMax,
          surface.occlusionZones,
          "occlusion",
          muted,
          material,
        );
        renderOverlapZones(
          ctx,
          surface.xMin,
          surface.xMax,
          surface.overpassZones,
          "overpass",
          muted,
          material,
        );

        // --- C. Internal Specular Highlight & Central Signal Core ---
        const specStrip = buildSpecularCoreStrip(deformed, motion, config);
        const specPath = buildClosedStripPath(
          specStrip.upperPts,
          specStrip.lowerPts,
        );

        const coreGrad = ctx.createLinearGradient(
          0,
          0,
          BRAND_VIEWBOX.width,
          0,
        );
        const corePulse =
          0.5 + 0.5 * Math.sin(clock.filmPhase * 1.15 + surface.phaseOffset);
        const coreAlpha =
          (muted ? 0.12 : 0.24 + 0.12 * corePulse) * profile.specularIntensity;

        coreGrad.addColorStop(0, "rgba(255, 255, 255, 0.02)");
        coreGrad.addColorStop(0.22, `rgba(185, 245, 255, ${coreAlpha * 0.65})`);
        coreGrad.addColorStop(0.48, `rgba(255, 255, 255, ${coreAlpha * 1.25})`);
        coreGrad.addColorStop(0.72, `rgba(235, 210, 255, ${coreAlpha * 0.75})`);
        coreGrad.addColorStop(1, "rgba(255, 255, 255, 0.03)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = coreGrad;
        ctx.fill(specPath);
        ctx.restore();

        if (sheenPos !== null && !muted) {
          const bandCenter =
            (-0.22 + sheenPos * 1.44) * BRAND_VIEWBOX.width;
          const bandHalfWidth = currentState === "thinking" ? 220 : 195;
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
            `rgba(34, 221, 235, ${peakAlpha * 0.48})`,
          );
          travelGrad.addColorStop(
            0.5,
            `rgba(255, 255, 255, ${peakAlpha})`,
          );
          travelGrad.addColorStop(
            0.72,
            `rgba(195, 165, 255, ${peakAlpha * 0.48})`,
          );
          travelGrad.addColorStop(1, "rgba(149, 96, 255, 0)");

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.fillStyle = travelGrad;
          ctx.fill(specPath);
          ctx.globalAlpha = 0.4;
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
        const uRimMul = Math.max(0, material.upperRimOpacity);
        upperRimGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
        upperRimGrad.addColorStop(
          0.16,
          muted
            ? `rgba(220, 228, 245, ${0.22 * uRimMul})`
            : `rgba(235, 252, 255, ${Math.min(1, 0.62 * uRimMul)})`,
        );
        upperRimGrad.addColorStop(
          0.52,
          muted
            ? `rgba(220, 228, 245, ${0.28 * uRimMul})`
            : `rgba(255, 255, 255, ${Math.min(1, 0.8 * uRimMul)})`,
        );
        upperRimGrad.addColorStop(
          0.86,
          muted
            ? `rgba(220, 228, 245, ${0.2 * uRimMul})`
            : `rgba(245, 215, 255, ${Math.min(1, 0.58 * uRimMul)})`,
        );
        upperRimGrad.addColorStop(1, "rgba(255, 255, 255, 0)");

        ctx.save();
        ctx.globalCompositeOperation = "screen";
        if (material.upperRimWidth > 0 && uRimMul > 0) {
          ctx.strokeStyle = upperRimGrad;
          ctx.lineWidth = material.upperRimWidth;
          ctx.stroke(upperRimPath);
        }

        const lRimMul = Math.max(0, material.lowerRimOpacity);
        const lowerRimGrad = ctx.createLinearGradient(
          surface.xMin,
          0,
          surface.xMax,
          0,
        );
        lowerRimGrad.addColorStop(0, "rgba(34, 221, 235, 0)");
        lowerRimGrad.addColorStop(
          0.35,
          muted
            ? `rgba(180, 190, 210, ${0.14 * lRimMul})`
            : `rgba(34, 221, 235, ${Math.min(1, 0.44 * lRimMul)})`,
        );
        lowerRimGrad.addColorStop(
          0.75,
          muted
            ? `rgba(180, 190, 210, ${0.14 * lRimMul})`
            : `rgba(227, 74, 231, ${Math.min(1, 0.4 * lRimMul)})`,
        );
        lowerRimGrad.addColorStop(1, "rgba(255, 113, 159, 0)");

        if (material.lowerRimWidth > 0 && lRimMul > 0) {
          ctx.strokeStyle = lowerRimGrad;
          ctx.lineWidth = material.lowerRimWidth;
          ctx.stroke(lowerRimPath);
        }
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
