// High-Resolution PNG & Multi-Layer Vector SVG Exporter for the Volumetric Brand Ribbon.
//
// - PNG Export: Uses the exact 5-layer Canvas 2D volumetric rendering pipeline
//   (Ribbon Body, Volumetric Glow, Chromatic Wave Sub-Ribbons, Specular Core,
//   Occlusion/Overpass Caustics, and Rim Highlights) at high resolution (1200px
//   wide with 2x supersampling = 2416x1208 transparent PNG).
// - SVG Export: Generates a standalone, multi-layered vector SVG with all
//   closed deformed ribbon contours, linearGradients, clipPaths, glow filter,
//   internal chromatic wave strips, and rim paths.

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
  evaluateSheenProgress,
  getRibbonTuningConfig,
  getStateProfile,
  isMutedState,
  pointOnDeformedSlice,
  type BrandRibbonMotionMode,
  type BrandWaveState,
  type DeformedRibbonSurface,
  type DeformedSlice,
  type RibbonMaterialTuning,
  type RibbonMotion,
  type RibbonTuningConfig,
} from "./RibbonDeformer";

const COLOR_CYAN = "#22DDEB";
const COLOR_ELECTRIC_BLUE = "#328CFF";
const COLOR_VIOLET = "#9560FF";
const COLOR_MAGENTA = "#E34AE7";
const COLOR_PINK = "#FF719F";

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function buildClosedStripPath2D(
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

function buildRibbonBodyPath2D(deformed: DeformedRibbonSurface): Path2D {
  const { slices } = deformed;
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

function buildTransverseBandPath2D(
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

function buildRimSubPath2D(
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

function renderOverlapZones2D(
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

function closedStripToSvgD(
  upperPts: readonly Vec2[],
  lowerPts: readonly Vec2[],
): string {
  if (upperPts.length === 0 || lowerPts.length === 0) return "";
  const parts: string[] = [`M ${fmt(upperPts[0][0])} ${fmt(upperPts[0][1])}`];
  for (let i = 1; i < upperPts.length; i++) {
    parts.push(`L ${fmt(upperPts[i][0])} ${fmt(upperPts[i][1])}`);
  }
  for (let i = lowerPts.length - 1; i >= 0; i--) {
    parts.push(`L ${fmt(lowerPts[i][0])} ${fmt(lowerPts[i][1])}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

function ribbonBodyToSvgD(deformed: DeformedRibbonSurface): string {
  const { slices } = deformed;
  if (slices.length === 0) return "";
  const upper = slices.map((s) => s.upper);
  const lower = slices.map((s) => s.lower);
  return closedStripToSvgD(upper, lower);
}

function transverseBandToSvgD(
  slices: readonly DeformedSlice[],
  vTop: number,
  vBottom: number,
): string {
  if (slices.length === 0) return "";
  const upper = slices.map((s) => pointOnDeformedSlice(s, vTop));
  const lower = slices.map((s) => pointOnDeformedSlice(s, vBottom));
  return closedStripToSvgD(upper, lower);
}

function rimSubPathToSvgD(
  slices: readonly DeformedSlice[],
  boundary: "upper" | "lower",
  uRange: readonly [number, number],
): string {
  const [uMin, uMax] = uRange;
  const parts: string[] = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    if (s.u < uMin || s.u > uMax) continue;
    const pt = boundary === "upper" ? s.upper : s.lower;
    parts.push(
      `${parts.length === 0 ? "M" : "L"} ${fmt(pt[0])} ${fmt(pt[1])}`,
    );
  }
  return parts.join(" ");
}

export interface RibbonExportOptions {
  state: BrandWaveState;
  motionMode?: BrandRibbonMotionMode;
  config?: RibbonTuningConfig;
  /** Optional snapshot time in seconds (defaults to 1.35s for a representative wave pose). */
  snapshotTimeSec?: number;
}

export function createExportMotionSnapshot({
  state,
  motionMode = "animated",
  config = getRibbonTuningConfig(),
  snapshotTimeSec = 1.35,
}: RibbonExportOptions): RibbonMotion {
  const profile = getStateProfile(state, config);
  const still = motionMode === "static" || state === "muted";
  const t = still ? 0 : snapshotTimeSec;
  const doneElapsed = state === "done" ? 0.35 : 0;

  return {
    state,
    time: t,
    doneElapsed,
    still,
    phase1: t * profile.omega1,
    phase2: t * profile.omega2,
    phase3: t * profile.omega3,
    filmPhase: t * profile.filmSpeed,
    amplitudeScale: still ? 0 : 1,
    renderWidth: 78,
  };
}

/**
 * Renders the volumetric brand ribbon onto a high-resolution offscreen Canvas 2D
 * using the exact 5-layer optical pipeline of BrandRibbonRenderer.tsx.
 */
export function renderBrandRibbonHighResCanvas(
  options: RibbonExportOptions,
  targetLogoWidthPx = 1164,
): HTMLCanvasElement {
  const config = options.config ?? getRibbonTuningConfig();
  const motion = createExportMotionSnapshot({ ...options, config });
  const currentState = motion.state;
  const { material } = config;
  const profile = getStateProfile(currentState, config);
  const muted = isMutedState(currentState);
  const filmPhase = motion.filmPhase ?? 0;

  const supersample = 2;
  const logoHeight = Math.round(
    (targetLogoWidthPx * BRAND_VIEWBOX.height) / BRAND_VIEWBOX.width,
  );
  const padX = Math.round(targetLogoWidthPx * 0.055);
  const padY = Math.round(logoHeight * 0.14);
  const cssWidth = targetLogoWidthPx + padX * 2;
  const cssHeight = logoHeight + padY * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssWidth * supersample);
  canvas.height = Math.round(cssHeight * supersample);

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const drawScale = (targetLogoWidthPx * supersample) / BRAND_VIEWBOX.width;
  const offsetX = padX * supersample;
  const offsetY = (canvas.height - BRAND_VIEWBOX.height * drawScale) * 0.5;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(drawScale, 0, 0, drawScale, offsetX, offsetY);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const deformedRibbons = BRAND_RIBBON_SURFACES.map((surface) =>
    deformRibbonSurface(surface, motion, config),
  );
  const bodyPaths = deformedRibbons.map((d) => buildRibbonBodyPath2D(d));

  // Layer B: Volumetric Glow
  const blurScale = targetLogoWidthPx / 78;
  ctx.save();
  ctx.globalAlpha = profile.glowOpacity;
  ctx.filter = `blur(${
    (currentState === "thinking" ? 4.2 : 3.2) * blurScale * 0.45
  }px)`;
  ctx.shadowColor = profile.primaryGlowColor;
  ctx.shadowBlur = (currentState === "thinking" ? 14 : 10) * blurScale * 0.5;

  for (let i = 0; i < deformedRibbons.length; i++) {
    const d = deformedRibbons[i];
    ctx.fillStyle = createRibbonBodyGradient(ctx, d.id, muted, filmPhase);
    ctx.fill(bodyPaths[i]);
  }
  ctx.restore();

  const sheenPos = evaluateSheenProgress(motion, config);

  for (let i = 0; i < deformedRibbons.length; i++) {
    const deformed = deformedRibbons[i];
    const bodyPath = bodyPaths[i];
    const { surface, slices } = deformed;

    ctx.save();
    if (muted) {
      ctx.globalAlpha = 0.74;
    }

    ctx.fillStyle = createRibbonBodyGradient(
      ctx,
      deformed.id,
      muted,
      filmPhase,
    );
    ctx.fill(bodyPath);

    ctx.save();
    ctx.clip(bodyPath);

    const upperCrownPath = buildTransverseBandPath2D(slices, 1.0, 0.34);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = muted
      ? "rgba(255, 255, 255, 0.10)"
      : "rgba(224, 248, 255, 0.18)";
    ctx.fill(upperCrownPath);
    ctx.restore();

    const lowerBellyPath = buildTransverseBandPath2D(slices, -0.36, -1.0);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = muted
      ? "rgba(15, 18, 34, 0.24)"
      : "rgba(16, 12, 48, 0.24)";
    ctx.fill(lowerBellyPath);
    ctx.restore();

    if (!muted) {
      const f0Scale = Math.max(0, material.film0Opacity / 0.58);
      const film0 = buildInternalWaveStrip(deformed, 0, motion, config);
      const film0Path = buildClosedStripPath2D(film0.upperPts, film0.lowerPts);
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

      const f1Scale = Math.max(0, material.film1Opacity / 0.58);
      const film1 = buildInternalWaveStrip(deformed, 1, motion, config);
      const film1Path = buildClosedStripPath2D(film1.upperPts, film1.lowerPts);
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

      const f2Scale = Math.max(0, material.film2AdditiveOpacity / 0.42);
      const film2 = buildInternalWaveStrip(deformed, 2, motion, config);
      const film2Path = buildClosedStripPath2D(film2.upperPts, film2.lowerPts);
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

    renderOverlapZones2D(
      ctx,
      surface.xMin,
      surface.xMax,
      surface.occlusionZones,
      "occlusion",
      muted,
      material,
    );
    renderOverlapZones2D(
      ctx,
      surface.xMin,
      surface.xMax,
      surface.overpassZones,
      "overpass",
      muted,
      material,
    );

    const specStrip = buildSpecularCoreStrip(deformed, motion, config);
    const specPath = buildClosedStripPath2D(
      specStrip.upperPts,
      specStrip.lowerPts,
    );
    const coreGrad = ctx.createLinearGradient(0, 0, BRAND_VIEWBOX.width, 0);
    const corePulse =
      0.5 + 0.5 * Math.sin(filmPhase * 1.15 + surface.phaseOffset);
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
      const bandCenter = (-0.22 + sheenPos * 1.44) * BRAND_VIEWBOX.width;
      const bandHalfWidth = currentState === "thinking" ? 220 : 195;
      const travelGrad = ctx.createLinearGradient(
        bandCenter - bandHalfWidth,
        0,
        bandCenter + bandHalfWidth,
        0,
      );
      const peakAlpha =
        (currentState === "done" ? 0.88 : 0.68) * profile.specularIntensity;
      travelGrad.addColorStop(0, "rgba(34, 221, 235, 0)");
      travelGrad.addColorStop(0.28, `rgba(34, 221, 235, ${peakAlpha * 0.48})`);
      travelGrad.addColorStop(0.5, `rgba(255, 255, 255, ${peakAlpha})`);
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

    ctx.restore(); // End clip

    const upperRimPath = buildRimSubPath2D(
      slices,
      "upper",
      surface.upperRimRange,
    );
    const lowerRimPath = buildRimSubPath2D(
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
    const upperRimGrad = ctx.createLinearGradient(rimSpanX0, 0, rimSpanX1, 0);
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

  return canvas;
}

/**
 * Generates a standalone, multi-layered vector SVG string of the volumetric
 * brand ribbon with all gradients, clipPaths, chromatic wave strips, specular
 * core, occlusion/caustic zones, and rim highlights.
 */
export function buildBrandRibbonSvg(options: RibbonExportOptions): string {
  const config = options.config ?? getRibbonTuningConfig();
  const motion = createExportMotionSnapshot({ ...options, config });
  const { state } = motion;
  const profile = getStateProfile(state, config);
  const { material } = config;
  const muted = isMutedState(state);
  const filmPhase = motion.filmPhase ?? 0;
  const shift = Math.sin(filmPhase * 0.75) * 0.075;

  const deformedRibbons = BRAND_RIBBON_SURFACES.map((surface) =>
    deformRibbonSurface(surface, motion, config),
  );
  const bodyPathsD = deformedRibbons.map((d) => ribbonBodyToSvgD(d));
  const sheenPos = evaluateSheenProgress(motion, config);

  const defs: string[] = [];
  const glowElements: string[] = [];
  const ribbonGroups: string[] = [];

  defs.push(`
    <filter id="ribbon-volumetric-glow" x="-15%" y="-35%" width="130%" height="170%">
      <feGaussianBlur stdDeviation="${state === "thinking" ? 28 : 22}" result="blur" />
    </filter>`);

  const buildBodyGradDef = (id: RibbonId, gradId: string) => {
    if (muted) {
      return `
    <linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="${BRAND_VIEWBOX.width}" y2="540">
      <stop offset="0%" stop-color="#9CA6BE" />
      <stop offset="35%" stop-color="#7E88A4" />
      <stop offset="70%" stop-color="#6C7590" />
      <stop offset="100%" stop-color="#586079" />
    </linearGradient>`;
    }
    if (id === "ribbon-left") {
      const s1 = Math.round(Math.min(0.9, Math.max(0.1, 0.34 + shift)) * 100);
      const s2 = Math.round(Math.min(0.95, Math.max(0.2, 0.72 + shift)) * 100);
      return `
    <linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="0" y1="80" x2="455" y2="390">
      <stop offset="0%" stop-color="${COLOR_CYAN}" />
      <stop offset="${s1}%" stop-color="${COLOR_ELECTRIC_BLUE}" />
      <stop offset="${s2}%" stop-color="${COLOR_VIOLET}" />
      <stop offset="100%" stop-color="${COLOR_MAGENTA}" />
    </linearGradient>`;
    }
    if (id === "ribbon-center") {
      const s1 = Math.round(Math.min(0.9, Math.max(0.1, 0.28 + shift)) * 100);
      const s2 = Math.round(Math.min(0.92, Math.max(0.2, 0.64 + shift)) * 100);
      return `
    <linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="270" y1="560" x2="705" y2="180">
      <stop offset="0%" stop-color="${COLOR_CYAN}" />
      <stop offset="${s1}%" stop-color="${COLOR_ELECTRIC_BLUE}" />
      <stop offset="${s2}%" stop-color="${COLOR_VIOLET}" />
      <stop offset="100%" stop-color="${COLOR_MAGENTA}" />
    </linearGradient>`;
    }
    const s1 = Math.round(Math.min(0.9, Math.max(0.1, 0.28 + shift)) * 100);
    const s2 = Math.round(Math.min(0.92, Math.max(0.2, 0.62 + shift)) * 100);
    return `
    <linearGradient id="${gradId}" gradientUnits="userSpaceOnUse" x1="606" y1="490" x2="1160" y2="30">
      <stop offset="0%" stop-color="#6E48F5" />
      <stop offset="${s1}%" stop-color="${COLOR_VIOLET}" />
      <stop offset="${s2}%" stop-color="${COLOR_MAGENTA}" />
      <stop offset="100%" stop-color="${COLOR_PINK}" />
    </linearGradient>`;
  };

  for (let i = 0; i < deformedRibbons.length; i++) {
    const deformed = deformedRibbons[i];
    const bodyD = bodyPathsD[i];
    const { surface, slices } = deformed;
    const prefix = `r${i}`;
    const bodyGradId = `${prefix}-body-grad`;
    const clipId = `${prefix}-clip`;

    defs.push(buildBodyGradDef(deformed.id, bodyGradId));
    defs.push(`
    <clipPath id="${clipId}">
      <path d="${bodyD}" />
    </clipPath>`);

    glowElements.push(`    <path d="${bodyD}" fill="url(#${bodyGradId})" />`);

    const innerLayers: string[] = [];

    const upperCrownD = transverseBandToSvgD(slices, 1.0, 0.34);
    const lowerBellyD = transverseBandToSvgD(slices, -0.36, -1.0);
    innerLayers.push(
      `      <path d="${upperCrownD}" fill="${
        muted ? "rgba(255,255,255,0.10)" : "rgba(224,248,255,0.18)"
      }" style="mix-blend-mode: screen" />`,
    );
    innerLayers.push(
      `      <path d="${lowerBellyD}" fill="${
        muted ? "rgba(15,18,34,0.24)" : "rgba(16,12,48,0.24)"
      }" />`,
    );

    if (!muted) {
      const f0Scale = Math.max(0, material.film0Opacity / 0.58);
      const film0 = buildInternalWaveStrip(deformed, 0, motion, config);
      const film0D = closedStripToSvgD(film0.upperPts, film0.lowerPts);
      const f0GradId = `${prefix}-film0-grad`;
      defs.push(`
    <linearGradient id="${f0GradId}" gradientUnits="userSpaceOnUse" x1="${fmt(surface.xMin)}" y1="100" x2="${fmt(surface.xMax)}" y2="460">
      <stop offset="0%" stop-color="rgb(34,221,235)" stop-opacity="${fmt(Math.min(1, 0.62 * f0Scale))}" />
      <stop offset="48%" stop-color="rgb(50,140,255)" stop-opacity="${fmt(Math.min(1, 0.54 * f0Scale))}" />
      <stop offset="100%" stop-color="rgb(149,96,255)" stop-opacity="${fmt(Math.min(1, 0.56 * f0Scale))}" />
    </linearGradient>`);
      innerLayers.push(
        `      <path d="${film0D}" fill="url(#${f0GradId})" style="mix-blend-mode: screen" />`,
      );

      const f1Scale = Math.max(0, material.film1Opacity / 0.58);
      const film1 = buildInternalWaveStrip(deformed, 1, motion, config);
      const film1D = closedStripToSvgD(film1.upperPts, film1.lowerPts);
      const f1GradId = `${prefix}-film1-grad`;
      defs.push(`
    <linearGradient id="${f1GradId}" gradientUnits="userSpaceOnUse" x1="${fmt(surface.xMin)}" y1="480" x2="${fmt(surface.xMax)}" y2="120">
      <stop offset="0%" stop-color="rgb(50,140,255)" stop-opacity="${fmt(Math.min(1, 0.48 * f1Scale))}" />
      <stop offset="42%" stop-color="rgb(149,96,255)" stop-opacity="${fmt(Math.min(1, 0.56 * f1Scale))}" />
      <stop offset="75%" stop-color="rgb(227,74,231)" stop-opacity="${fmt(Math.min(1, 0.62 * f1Scale))}" />
      <stop offset="100%" stop-color="rgb(255,113,159)" stop-opacity="${fmt(Math.min(1, 0.58 * f1Scale))}" />
    </linearGradient>`);
      innerLayers.push(
        `      <path d="${film1D}" fill="url(#${f1GradId})" style="mix-blend-mode: screen" />`,
      );

      const f2Scale = Math.max(0, material.film2AdditiveOpacity / 0.42);
      const film2 = buildInternalWaveStrip(deformed, 2, motion, config);
      const film2D = closedStripToSvgD(film2.upperPts, film2.lowerPts);
      const f2GradId = `${prefix}-film2-grad`;
      defs.push(`
    <linearGradient id="${f2GradId}" gradientUnits="userSpaceOnUse" x1="${fmt(BRAND_VIEWBOX.width * 0.12)}" y1="0" x2="${fmt(BRAND_VIEWBOX.width * 0.88)}" y2="0">
      <stop offset="0%" stop-color="rgb(34,221,235)" stop-opacity="${fmt(Math.min(1, 0.08 * f2Scale))}" />
      <stop offset="32%" stop-color="rgb(56,224,248)" stop-opacity="${fmt(Math.min(1, 0.34 * f2Scale))}" />
      <stop offset="55%" stop-color="rgb(216,180,254)" stop-opacity="${fmt(Math.min(1, 0.42 * f2Scale))}" />
      <stop offset="78%" stop-color="rgb(244,114,182)" stop-opacity="${fmt(Math.min(1, 0.32 * f2Scale))}" />
      <stop offset="100%" stop-color="rgb(255,113,159)" stop-opacity="${fmt(Math.min(1, 0.08 * f2Scale))}" />
    </linearGradient>`);
      innerLayers.push(
        `      <path d="${film2D}" fill="url(#${f2GradId})" style="mix-blend-mode: screen" />`,
      );
    }

    const addOverlapSvg = (
      zones: readonly LongitudinalZone[],
      mode: "occlusion" | "overpass",
    ) => {
      const span = surface.xMax - surface.xMin;
      zones.forEach((z, zIdx) => {
        const x0 = surface.xMin + z.uStart * span;
        const x1 = surface.xMin + z.uEnd * span;
        const zGradId = `${prefix}-${mode}-${zIdx}`;
        if (mode === "occlusion") {
          const baseStrength = muted ? 0.35 : material.occlusionStrength;
          const alpha = Math.min(1, Math.max(0, baseStrength * z.strength));
          defs.push(`
    <linearGradient id="${zGradId}" gradientUnits="userSpaceOnUse" x1="${fmt(x0)}" y1="0" x2="${fmt(x1)}" y2="0">
      <stop offset="0%" stop-color="rgb(10,12,32)" stop-opacity="0" />
      <stop offset="45%" stop-color="rgb(14,16,46)" stop-opacity="${fmt(alpha * 0.75)}" />
      <stop offset="85%" stop-color="rgb(8,10,28)" stop-opacity="${fmt(alpha)}" />
      <stop offset="100%" stop-color="rgb(8,10,28)" stop-opacity="${fmt(alpha * 0.9)}" />
    </linearGradient>`);
          innerLayers.push(
            `      <rect x="${fmt(x0 - 12)}" y="-90" width="${fmt(x1 - x0 + 24)}" height="${BRAND_VIEWBOX.height + 180}" fill="url(#${zGradId})" />`,
          );
        } else if (!muted) {
          const alpha = Math.min(
            1,
            Math.max(0, material.overpassCausticStrength * z.strength),
          );
          defs.push(`
    <linearGradient id="${zGradId}" gradientUnits="userSpaceOnUse" x1="${fmt(x0)}" y1="0" x2="${fmt(x1)}" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="50%" stop-color="rgb(195,240,255)" stop-opacity="${fmt(alpha)}" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>`);
          innerLayers.push(
            `      <rect x="${fmt(x0 - 12)}" y="-90" width="${fmt(x1 - x0 + 24)}" height="${BRAND_VIEWBOX.height + 180}" fill="url(#${zGradId})" style="mix-blend-mode: screen" />`,
          );
        }
      });
    };

    addOverlapSvg(surface.occlusionZones, "occlusion");
    addOverlapSvg(surface.overpassZones, "overpass");

    const specStrip = buildSpecularCoreStrip(deformed, motion, config);
    const specD = closedStripToSvgD(specStrip.upperPts, specStrip.lowerPts);
    const corePulse =
      0.5 + 0.5 * Math.sin(filmPhase * 1.15 + surface.phaseOffset);
    const coreAlpha =
      (muted ? 0.12 : 0.24 + 0.12 * corePulse) * profile.specularIntensity;
    const coreGradId = `${prefix}-core-grad`;
    defs.push(`
    <linearGradient id="${coreGradId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${BRAND_VIEWBOX.width}" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.02" />
      <stop offset="22%" stop-color="rgb(185,245,255)" stop-opacity="${fmt(coreAlpha * 0.65)}" />
      <stop offset="48%" stop-color="#FFFFFF" stop-opacity="${fmt(Math.min(1, coreAlpha * 1.25))}" />
      <stop offset="72%" stop-color="rgb(235,210,255)" stop-opacity="${fmt(coreAlpha * 0.75)}" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.03" />
    </linearGradient>`);
    innerLayers.push(
      `      <path d="${specD}" fill="url(#${coreGradId})" style="mix-blend-mode: screen" />`,
    );

    if (sheenPos !== null && !muted) {
      const bandCenter = (-0.22 + sheenPos * 1.44) * BRAND_VIEWBOX.width;
      const bandHalfWidth = state === "thinking" ? 220 : 195;
      const peakAlpha =
        (state === "done" ? 0.88 : 0.68) * profile.specularIntensity;
      const sheenGradId = `${prefix}-sheen-grad`;
      defs.push(`
    <linearGradient id="${sheenGradId}" gradientUnits="userSpaceOnUse" x1="${fmt(bandCenter - bandHalfWidth)}" y1="0" x2="${fmt(bandCenter + bandHalfWidth)}" y2="0">
      <stop offset="0%" stop-color="rgb(34,221,235)" stop-opacity="0" />
      <stop offset="28%" stop-color="rgb(34,221,235)" stop-opacity="${fmt(peakAlpha * 0.48)}" />
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="${fmt(Math.min(1, peakAlpha))}" />
      <stop offset="72%" stop-color="rgb(195,165,255)" stop-opacity="${fmt(peakAlpha * 0.48)}" />
      <stop offset="100%" stop-color="rgb(149,96,255)" stop-opacity="0" />
    </linearGradient>`);
      innerLayers.push(
        `      <path d="${specD}" fill="url(#${sheenGradId})" style="mix-blend-mode: screen" />`,
      );
    }

    const upperRimD = rimSubPathToSvgD(slices, "upper", surface.upperRimRange);
    const lowerRimD = rimSubPathToSvgD(slices, "lower", surface.lowerRimRange);
    const rimSpanX0 =
      surface.xMin +
      surface.upperRimRange[0] * (surface.xMax - surface.xMin);
    const rimSpanX1 =
      surface.xMin +
      surface.upperRimRange[1] * (surface.xMax - surface.xMin);
    const uRimMul = Math.max(0, material.upperRimOpacity);
    const lRimMul = Math.max(0, material.lowerRimOpacity);
    const uRimGradId = `${prefix}-upper-rim-grad`;
    const lRimGradId = `${prefix}-lower-rim-grad`;

    defs.push(`
    <linearGradient id="${uRimGradId}" gradientUnits="userSpaceOnUse" x1="${fmt(rimSpanX0)}" y1="0" x2="${fmt(rimSpanX1)}" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="16%" stop-color="${muted ? "rgb(220,228,245)" : "rgb(235,252,255)"}" stop-opacity="${fmt(Math.min(1, (muted ? 0.22 : 0.62) * uRimMul))}" />
      <stop offset="52%" stop-color="${muted ? "rgb(220,228,245)" : "#FFFFFF"}" stop-opacity="${fmt(Math.min(1, (muted ? 0.28 : 0.8) * uRimMul))}" />
      <stop offset="86%" stop-color="${muted ? "rgb(220,228,245)" : "rgb(245,215,255)"}" stop-opacity="${fmt(Math.min(1, (muted ? 0.2 : 0.58) * uRimMul))}" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>`);

    defs.push(`
    <linearGradient id="${lRimGradId}" gradientUnits="userSpaceOnUse" x1="${fmt(surface.xMin)}" y1="0" x2="${fmt(surface.xMax)}" y2="0">
      <stop offset="0%" stop-color="rgb(34,221,235)" stop-opacity="0" />
      <stop offset="35%" stop-color="${muted ? "rgb(180,190,210)" : "rgb(34,221,235)"}" stop-opacity="${fmt(Math.min(1, (muted ? 0.14 : 0.44) * lRimMul))}" />
      <stop offset="75%" stop-color="${muted ? "rgb(180,190,210)" : "rgb(227,74,231)"}" stop-opacity="${fmt(Math.min(1, (muted ? 0.14 : 0.4) * lRimMul))}" />
      <stop offset="100%" stop-color="rgb(255,113,159)" stop-opacity="0" />
    </linearGradient>`);

    const rimElements: string[] = [];
    if (material.upperRimWidth > 0 && uRimMul > 0) {
      rimElements.push(
        `    <path d="${upperRimD}" fill="none" stroke="url(#${uRimGradId})" stroke-width="${fmt(material.upperRimWidth)}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode: screen" />`,
      );
    }
    if (material.lowerRimWidth > 0 && lRimMul > 0) {
      rimElements.push(
        `    <path d="${lowerRimD}" fill="none" stroke="url(#${lRimGradId})" stroke-width="${fmt(material.lowerRimWidth)}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode: screen" />`,
      );
    }

    ribbonGroups.push(`  <g id="${deformed.id}"${muted ? ' opacity="0.74"' : ""}>
    <path d="${bodyD}" fill="url(#${bodyGradId})" />
    <g clip-path="url(#${clipId})">
${innerLayers.join("\n")}
    </g>
${rimElements.join("\n")}
  </g>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-48 -48 ${BRAND_VIEWBOX.width + 96} ${BRAND_VIEWBOX.height + 96}" width="${BRAND_VIEWBOX.width + 96}" height="${BRAND_VIEWBOX.height + 96}" fill="none">
  <defs>${defs.join("")}
  </defs>
  <g id="volumetric-glow" opacity="${fmt(profile.glowOpacity)}" filter="url(#ribbon-volumetric-glow)">
${glowElements.join("\n")}
  </g>
${ribbonGroups.join("\n")}
</svg>
`;
}

/**
 * Triggers a browser/WebView file download for a Blob or data URL.
 */
export function triggerDownload(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }, 400);
}

/**
 * Downloads the generated standalone SVG file.
 */
export function downloadBrandRibbonSvg(options: RibbonExportOptions): void {
  const svgString = buildBrandRibbonSvg(options);
  const blob = new Blob([svgString], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const modeTag = options.motionMode === "static" ? "static" : options.state;
  triggerDownload(url, `whisperlane-ribbon-${modeTag}.svg`);
}

/**
 * Renders a high-resolution transparent PNG directly via the Canvas 2D
 * volumetric pipeline and triggers a file download.
 */
export function downloadBrandRibbonPng(options: RibbonExportOptions): void {
  const modeTag = options.motionMode === "static" ? "static" : options.state;
  const filename = `whisperlane-ribbon-${modeTag}.png`;
  const canvas = renderBrandRibbonHighResCanvas(options, 1164);
  const pngUrl = canvas.toDataURL("image/png");
  triggerDownload(pngUrl, filename);
}
