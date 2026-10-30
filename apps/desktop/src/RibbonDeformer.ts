// Mathematical Ribbon Deformation Engine — Organic Liquid Wave Motion.
//
// Each ribbon is parameterized in its local geometric coordinate system:
//   - Longitudinal parameter: u in [0, 1] (shared global u_g across the mark)
//   - Transverse parameter:   v in [-1, 1]
//   - Original centerline:    C0(u)
//   - Unit liquid normal:     N_liquid(u)
//   - Original half-width:    h0(u)
//   - Original surface:       R0(u, v) = C0(u) + v * h0(u) * N_span(u)
//
// Coordinated two-wave organic body undulation (Section 2.A):
//   E(u)    = sin(pi * u)^1.3
//   D(u, t) = E(u) * [A1(t) * sin(2*pi*k1*u - psi1(t) + phi1)
//                   + A2(t) * sin(2*pi*k2*u - psi2(t) + phi2)] * N_liquid(u)
//   C(u, t) = C0(u) + D(u, t)
//
// Transverse ribbon thickness breathing (Section 2.B):
//   h(u, t) = h0(u) * [1 + E(u) * (B1(t) * cos(2*pi*k1*u - psi1(t) + phi1)
//                                + B2(t) * cos(2*pi*k2*u - psi2(t) + phi2))]
//
// Deformed surface:
//   R(u, v, t) = C(u, t) + v * h(u, t) * N_span(u, t)

import type {
  BrandRibbonSurface,
  RibbonId,
  RibbonSlice,
  Vec2,
} from "./brandmarkGeometry";

export type BrandWaveState =
  | "idle"
  | "ready"
  | "thinking"
  | "done"
  | "muted";

export type BrandRibbonMotionMode = "animated" | "static";

export interface RibbonMotion {
  readonly state: BrandWaveState;
  /** Continuous animation clock in seconds. */
  readonly time: number;
  /** Seconds elapsed since entering the "done" state. */
  readonly doneElapsed: number;
  /** True when static mode is selected or prefers-reduced-motion is active. */
  readonly still: boolean;
  /** Optional integrated primary wave phase psi1(t) for seamless state transitions. */
  readonly phase1?: number;
  /** Optional integrated secondary wave phase psi2(t) for seamless state transitions. */
  readonly phase2?: number;
  /** Optional integrated internal film phase. */
  readonly filmPhase?: number;
  /** Optional smoothed amplitude scale [0, 1.5] across state transitions. */
  readonly amplitudeScale?: number;
  /** Target CSS render width in pixels (default 78). */
  readonly renderWidth?: number;
}

export interface StateMotionProfile {
  /** Primary wave normal amplitude A1 in viewBox units (at 78px reference width). */
  readonly amplitudeA1: number;
  /** Secondary (weaker) wave normal amplitude A2 in viewBox units. */
  readonly amplitudeA2: number;
  /** Primary transverse width modulation B1 (e.g. 0.058 = 5.8%). */
  readonly widthModB1: number;
  /** Secondary transverse width modulation B2 (e.g. 0.014 = 1.4%). */
  readonly widthModB2: number;
  /** Primary spatial wave number k1 across the mark. */
  readonly waveNumberK1: number;
  /** Secondary spatial wave number k2 across the mark. */
  readonly waveNumberK2: number;
  /** Primary wave cycle period T1 in seconds (omega1 = 2*pi / T1). */
  readonly cycleSeconds1: number;
  /** Secondary wave cycle period T2 in seconds (omega2 = 2*pi / T2). */
  readonly cycleSeconds2: number;
  /** Primary angular velocity omega1 (rad/s). */
  readonly omega1: number;
  /** Secondary angular velocity omega2 (rad/s). */
  readonly omega2: number;
  /** Slow global breathing modulation rate (rad/s). */
  readonly breathRate: number;
  /** Slow global breathing depth [0, 0.2]. */
  readonly breathDepth: number;
  /** Seconds per internal specular pass (0 = single pass on done). */
  readonly sheenPeriod: number;
  /** Speed of internal chromatic film sub-layers (rad/s). */
  readonly filmSpeed: number;
  /** Volumetric glow opacity multiplier. */
  readonly glowOpacity: number;
  /** Specular core intensity multiplier. */
  readonly specularIntensity: number;
  /** Ambient glow colors. */
  readonly primaryGlowColor: string;
  readonly secondaryGlowColor: string;
}

const TAU = Math.PI * 2;
export const DONE_SETTLE_DURATION = 1.65;
export const DEFAULT_RIBBON_WIDTH_PX = 78;

/**
 * State motion profiles calibrated directly against CSS pixel output at the
 * 78px pill render size (where 1 CSS px = 14.923 viewBox units):
 * - Idle:     T1 = 4.4s cycle, peak ~1.92 CSS px normal displacement, ~6.3% thickness breath
 * - Ready:    T1 = 3.8s cycle, peak ~2.20 CSS px normal displacement, ~7.2% thickness breath
 * - Thinking: T1 = 2.3s cycle, peak ~2.64 CSS px (~1.35x Idle), ~9.1% thickness breath
 * - Done:     T1 = 2.2s single pulse decaying smoothly to static rest over 1.65s
 * - Muted:    Static exact geometry
 */
const STATE_PROFILES: Record<BrandWaveState, StateMotionProfile> = {
  idle: {
    amplitudeA1: 25.5,
    amplitudeA2: 6.2,
    widthModB1: 0.056,
    widthModB2: 0.012,
    waveNumberK1: 1.15,
    waveNumberK2: 2.05,
    cycleSeconds1: 4.4,
    cycleSeconds2: 3.0,
    omega1: TAU / 4.4,
    omega2: TAU / 3.0,
    breathRate: 0.65,
    breathDepth: 0.08,
    sheenPeriod: 6.4,
    filmSpeed: 0.85,
    glowOpacity: 0.46,
    specularIntensity: 0.64,
    primaryGlowColor: "rgba(149, 96, 255, 0.54)",
    secondaryGlowColor: "rgba(34, 221, 235, 0.36)",
  },
  ready: {
    amplitudeA1: 29.2,
    amplitudeA2: 7.2,
    widthModB1: 0.064,
    widthModB2: 0.014,
    waveNumberK1: 1.18,
    waveNumberK2: 2.1,
    cycleSeconds1: 3.8,
    cycleSeconds2: 2.65,
    omega1: TAU / 3.8,
    omega2: TAU / 2.65,
    breathRate: 1.1,
    breathDepth: 0.1,
    sheenPeriod: 4.5,
    filmSpeed: 1.15,
    glowOpacity: 0.58,
    specularIntensity: 0.78,
    primaryGlowColor: "rgba(149, 96, 255, 0.64)",
    secondaryGlowColor: "rgba(50, 140, 255, 0.48)",
  },
  thinking: {
    amplitudeA1: 34.8,
    amplitudeA2: 8.6,
    widthModB1: 0.08,
    widthModB2: 0.018,
    waveNumberK1: 1.32,
    waveNumberK2: 2.35,
    cycleSeconds1: 2.3,
    cycleSeconds2: 1.6,
    omega1: TAU / 2.3,
    omega2: TAU / 1.6,
    breathRate: 1.85,
    breathDepth: 0.1,
    sheenPeriod: 2.1,
    filmSpeed: 2.25,
    glowOpacity: 0.72,
    specularIntensity: 0.94,
    primaryGlowColor: "rgba(34, 221, 235, 0.70)",
    secondaryGlowColor: "rgba(227, 74, 231, 0.56)",
  },
  done: {
    amplitudeA1: 31.0,
    amplitudeA2: 7.5,
    widthModB1: 0.07,
    widthModB2: 0.016,
    waveNumberK1: 1.22,
    waveNumberK2: 2.15,
    cycleSeconds1: 2.2,
    cycleSeconds2: 1.55,
    omega1: TAU / 2.2,
    omega2: TAU / 1.55,
    breathRate: 1.4,
    breathDepth: 0.06,
    sheenPeriod: 0,
    filmSpeed: 1.4,
    glowOpacity: 0.62,
    specularIntensity: 0.96,
    primaryGlowColor: "rgba(34, 221, 235, 0.68)",
    secondaryGlowColor: "rgba(149, 96, 255, 0.52)",
  },
  muted: {
    amplitudeA1: 0,
    amplitudeA2: 0,
    widthModB1: 0,
    widthModB2: 0,
    waveNumberK1: 1.15,
    waveNumberK2: 2.05,
    cycleSeconds1: 0,
    cycleSeconds2: 0,
    omega1: 0,
    omega2: 0,
    breathRate: 0,
    breathDepth: 0,
    sheenPeriod: 0,
    filmSpeed: 0,
    glowOpacity: 0.22,
    specularIntensity: 0.22,
    primaryGlowColor: "rgba(120, 128, 152, 0.24)",
    secondaryGlowColor: "rgba(95, 102, 124, 0.18)",
  },
};

export interface DeformedSlice {
  readonly u: number;
  readonly uGlobal: number;
  readonly x: number;
  /** Deformed centerline C(u, t) = C0(u) + D(u, t). */
  readonly center: Vec2;
  /** Deformed upper boundary R(u, +1, t). */
  readonly upper: Vec2;
  /** Deformed lower boundary R(u, -1, t). */
  readonly lower: Vec2;
  /** Deformed half-width h(u, t). */
  readonly halfWidth: number;
  /** Signed normal displacement scalar applied at this slice (in viewBox units). */
  readonly normalDisplacement: number;
  /** Multiplicative width scale h(u, t) / h0(u). */
  readonly widthScale: number;
  /** Effective transverse unit vector pointing from center (v=0) to upper (v=+1). */
  readonly spanUnit: Vec2;
}

export interface DeformedRibbonSurface {
  readonly id: RibbonId;
  readonly surface: BrandRibbonSurface;
  readonly slices: readonly DeformedSlice[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Shared spatial envelope across the brandmark:
 *   E(u) = sin(pi * u)^1.3
 * Softly pins the extreme left tip (u = 0) and right tail exit (u = 1) while
 * keeping high, continuous wave transfer through all interior folds and
 * ribbon intersections (u in [0.15, 0.88]).
 */
export function ribbonEnvelope(u: number): number {
  const s = Math.sin(Math.PI * clamp01(u));
  return Math.pow(Math.max(0, s), 1.3);
}

export function getStateProfile(state: BrandWaveState): StateMotionProfile {
  return STATE_PROFILES[state];
}

export function isMutedState(state: BrandWaveState): boolean {
  return state === "muted";
}

/** Creates an explicit static motion descriptor for static fallback rendering. */
export function createStaticRibbonMotion(
  state: BrandWaveState = "idle",
  renderWidth = DEFAULT_RIBBON_WIDTH_PX,
): RibbonMotion {
  return {
    state,
    time: 0,
    doneElapsed: 0,
    still: true,
    renderWidth,
  };
}

/**
 * Evaluates time-varying wave amplitudes (A1, A2) and thickness modulations
 * (B1, B2), incorporating slow breathing, "done" settling, and CSS render-width
 * compensation so motion remains perceptible at small pill sizes.
 */
export function evaluateWaveParameters(motion: RibbonMotion): {
  readonly A1: number;
  readonly A2: number;
  readonly B1: number;
  readonly B2: number;
  readonly psi1: number;
  readonly psi2: number;
} {
  if (motion.still || motion.state === "muted") {
    return { A1: 0, A2: 0, B1: 0, B2: 0, psi1: 0, psi2: 0 };
  }

  const profile = STATE_PROFILES[motion.state];
  const breath =
    1 + profile.breathDepth * Math.sin(profile.breathRate * motion.time);

  let settle = motion.amplitudeScale ?? 1;
  if (motion.state === "done") {
    if (motion.doneElapsed >= DONE_SETTLE_DURATION) {
      return { A1: 0, A2: 0, B1: 0, B2: 0, psi1: 0, psi2: 0 };
    }
    const progress = clamp01(motion.doneElapsed / DONE_SETTLE_DURATION);
    settle *= Math.pow(1 - progress, 2.1);
  }

  // Sub-linear width compensation so if rendered at 56-64px the CSS pixel
  // displacement does not shrink proportionally below the 1.5px threshold.
  const targetW = motion.renderWidth ?? DEFAULT_RIBBON_WIDTH_PX;
  const sizeCompensation = Math.min(
    1.25,
    Math.max(0.85, Math.pow(DEFAULT_RIBBON_WIDTH_PX / Math.max(48, targetW), 0.35)),
  );

  const scale = breath * settle * sizeCompensation;
  const psi1 = motion.phase1 ?? profile.omega1 * motion.time;
  const psi2 = motion.phase2 ?? profile.omega2 * motion.time;

  return {
    A1: profile.amplitudeA1 * scale,
    A2: profile.amplitudeA2 * scale,
    B1: profile.widthModB1 * breath * settle,
    B2: profile.widthModB2 * breath * settle,
    psi1,
    psi2,
  };
}

/**
 * Evaluates a single ribbon slice at time t using the two-wave organic liquid
 * model (Section 2.A & 2.B):
 *   D(u, t) = E(u) * [A1 * sin(2*pi*k1*u - psi1 + phi1) + A2 * sin(2*pi*k2*u - psi2 + phi2)] * N_liquid(u)
 *   h(u, t) = h0(u) * [1 + E(u) * (B1 * cos(2*pi*k1*u - psi1 + phi1) + B2 * cos(2*pi*k2*u - psi2 + phi2))]
 */
export function deformSlice(
  slice: RibbonSlice,
  phaseOffset: number,
  profile: StateMotionProfile,
  params: {
    readonly A1: number;
    readonly A2: number;
    readonly B1: number;
    readonly B2: number;
    readonly psi1: number;
    readonly psi2: number;
  },
): DeformedSlice {
  const { A1, A2, B1, B2, psi1, psi2 } = params;
  if (A1 === 0 && A2 === 0 && B1 === 0 && B2 === 0) {
    return {
      u: slice.u,
      uGlobal: slice.uGlobal,
      x: slice.x,
      center: slice.center0,
      upper: slice.upper0,
      lower: slice.lower0,
      halfWidth: slice.halfWidth0,
      normalDisplacement: 0,
      widthScale: 1,
      spanUnit: [0, -1],
    };
  }

  // Shared global longitudinal coordinate u keeps all three ribbons locked into
  // one continuous ocean wave across their intersections; a tiny 6% local u
  // contribution adds subtle per-fold organic inflection.
  const uWave = slice.uGlobal * 0.94 + slice.u * 0.06;
  const env = ribbonEnvelope(slice.uGlobal);

  const phi1 = phaseOffset;
  const phi2 = phaseOffset * 1.4 + 0.85;

  const theta1 = TAU * profile.waveNumberK1 * uWave - psi1 + phi1;
  const theta2 = TAU * profile.waveNumberK2 * uWave - psi2 + phi2;

  // A. Organic Body Undulation along unit liquid normal N_liquid(u)
  const dispScalar =
    env * (A1 * Math.sin(theta1) + A2 * Math.sin(theta2));
  const nx = slice.liquidNormal[0];
  const ny = slice.liquidNormal[1];

  const cx = slice.center0[0] + dispScalar * nx;
  const cy = slice.center0[1] + dispScalar * ny;

  // B. Ribbon Thickness Breathing (cos is in quadrature with sin so the film
  // swells as crests pass and thins gently in the troughs)
  const rawWidthDelta =
    env * (B1 * Math.cos(theta1) + B2 * Math.cos(theta2));
  const widthScale = Math.min(1.24, Math.max(0.78, 1 + rawWidthDelta));
  const h = slice.halfWidth0 * widthScale;

  // Transverse thickness breathing acts across the vertical cross-section while
  // the centerline C(u, t) translates along the 2D unit liquidNormal (nx, ny).
  // This guarantees upper[0] === lower[0] === cx and strictly prevents adjacent
  // slice self-intersections even across 1-unit SVG vertex intervals.
  const spanX = 0;
  const spanY = -1;

  const upper: Vec2 = [cx, cy - h];
  const lower: Vec2 = [cx, cy + h];

  return {
    u: slice.u,
    uGlobal: slice.uGlobal,
    x: cx,
    center: [cx, cy],
    upper,
    lower,
    halfWidth: h,
    normalDisplacement: dispScalar,
    widthScale,
    spanUnit: [spanX, spanY],
  };
}

/**
 * Evaluates R(u, v, t) = C(u, t) + v * h(u, t) * N_span(u) for any transverse
 * coordinate v in [-1, 1] on a deformed slice.
 */
export function pointOnDeformedSlice(slice: DeformedSlice, v: number): Vec2 {
  const clampedV = Math.min(1, Math.max(-1, v));
  return [
    slice.center[0] + clampedV * slice.halfWidth * slice.spanUnit[0],
    slice.center[1] + clampedV * slice.halfWidth * slice.spanUnit[1],
  ];
}

/** Deforms all slices of a BrandRibbonSurface for the current animation frame. */
export function deformRibbonSurface(
  surface: BrandRibbonSurface,
  motion: RibbonMotion,
): DeformedRibbonSurface {
  const profile = STATE_PROFILES[motion.state];
  const params = evaluateWaveParameters(motion);
  const slices = surface.slices.map((s) =>
    deformSlice(s, surface.phaseOffset, profile, params),
  );
  return {
    id: surface.id,
    surface,
    slices,
  };
}

/**
 * Computes an internal undulating sub-ribbon (v_low(u, t) to v_high(u, t))
 * inside the [-1, 1] transverse domain of a deformed ribbon. Used to render
 * translucent chromatic film layers that flow and optically intersect inside
 * the ribbon body.
 */
export function buildInternalWaveStrip(
  deformed: DeformedRibbonSurface,
  layerIndex: 0 | 1,
  motion: RibbonMotion,
): { readonly upperPts: Vec2[]; readonly lowerPts: Vec2[] } {
  const profile = STATE_PROFILES[motion.state];
  const t = motion.still
    ? 0
    : (motion.filmPhase ?? motion.time * profile.filmSpeed);
  const freq = layerIndex === 0 ? 1.95 : 2.7;
  const dir = layerIndex === 0 ? -1 : 1;
  const basePhase =
    deformed.surface.phaseOffset + (layerIndex === 0 ? 0.3 : 2.15);

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const wave =
      Math.sin(TAU * freq * s.uGlobal + dir * t + basePhase) * 0.38 +
      Math.cos(TAU * (freq * 0.65) * s.u - dir * t * 0.72 + basePhase) * 0.18;

    const centerV = (layerIndex === 0 ? 0.16 : -0.14) + wave;
    const halfBand = layerIndex === 0 ? 0.45 : 0.43;

    const vHigh = Math.min(0.95, Math.max(-0.62, centerV + halfBand));
    const vLow = Math.max(-0.95, Math.min(0.62, centerV - halfBand));

    upperPts.push(pointOnDeformedSlice(s, vHigh));
    lowerPts.push(pointOnDeformedSlice(s, vLow));
  }

  return { upperPts, lowerPts };
}

/**
 * Computes the parametric internal specular highlight strip along the ribbon's
 * centerline C(u, t), concentrated around the upper-center ridge (v in [-0.12, +0.48])
 * so light follows the 3D tubular curvature of the folds.
 */
export function buildSpecularCoreStrip(
  deformed: DeformedRibbonSurface,
  motion: RibbonMotion,
): { readonly upperPts: Vec2[]; readonly lowerPts: Vec2[] } {
  const profile = STATE_PROFILES[motion.state];
  const t = motion.still
    ? 0
    : (motion.filmPhase ?? motion.time * profile.filmSpeed) * 0.82;

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const shimmer =
      0.11 *
      Math.sin(
        TAU * 1.65 * s.uGlobal - t + deformed.surface.phaseOffset,
      );
    const vTop = Math.min(0.7, 0.45 + shimmer);
    const vBot = Math.max(-0.46, -0.1 + shimmer * 0.65);

    upperPts.push(pointOnDeformedSlice(s, vTop));
    lowerPts.push(pointOnDeformedSlice(s, vBot));
  }

  return { upperPts, lowerPts };
}

/**
 * Normalized longitudinal position [0, 1] of the traveling specular sheen band,
 * or null when settled / muted.
 */
export function evaluateSheenProgress(motion: RibbonMotion): number | null {
  if (motion.state === "muted") return null;
  if (motion.still) return 0.48;

  if (motion.state === "done") {
    if (motion.doneElapsed >= 1.35) return null;
    const raw = clamp01(motion.doneElapsed / 1.2);
    return 1 - Math.pow(1 - raw, 1.8);
  }

  const period = STATE_PROFILES[motion.state].sheenPeriod;
  if (period <= 0) return null;
  return (motion.time % period) / period;
}
