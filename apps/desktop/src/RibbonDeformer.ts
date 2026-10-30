// Mathematical Ribbon Deformation Engine (Section 6 & 7).
//
// Each ribbon is parameterized in its local geometric coordinate system:
//   - Longitudinal parameter: u in [0, 1]
//   - Transverse parameter:   v in [-1, 1]
//   - Original centerline:    C0(u)
//   - Local normal:           N(u)
//   - Original half-width:    h0(u)
//   - Original surface:       R0(u, v) = C0(u) + v * h0(u) * N(u)
//
// Temporal deformation:
//   - Envelope:               E(u) = sin(pi * u)^1.5
//   - Centerline displacement: D(u, t) = A(t) * E(u) * sin(2*pi*k*u - omega*t + phi) * N(u)
//   - Deformed centerline:    C(u, t) = C0(u) + D(u, t)
//   - Half-width modulation:  h(u, t) = h0(u) * [1 + B(t) * E(u) * cos(2*pi*k*u - omega*t + phi)]
//   - Deformed surface:       R(u, v, t) = C(u, t) + v * h(u, t) * N(u)

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

export interface RibbonMotion {
  readonly state: BrandWaveState;
  /** Continuous animation clock in seconds. */
  readonly time: number;
  /** Seconds elapsed since entering the "done" state. */
  readonly doneElapsed: number;
  /** True when prefers-reduced-motion is enabled. */
  readonly still: boolean;
}

export interface StateMotionProfile {
  /** Normal displacement amplitude A in viewBox units (1164 x 582 space). */
  readonly amplitudeA: number;
  /** Transverse width modulation ratio B (dimensionless, |B| < 0.22). */
  readonly widthModB: number;
  /** Longitudinal spatial wave number k. */
  readonly waveNumberK: number;
  /** Temporal angular velocity omega (rad/s). */
  readonly omega: number;
  /** Slow global breathing modulation rate (rad/s). */
  readonly breathRate: number;
  /** Slow global breathing depth [0, 0.25]. */
  readonly breathDepth: number;
  /** Seconds per internal specular pass (0 = single pass on done). */
  readonly sheenPeriod: number;
  /** Speed of internal chromatic film sub-layers. */
  readonly filmSpeed: number;
  /** Volumetric glow opacity multiplier. */
  readonly glowOpacity: number;
  /** Specular core intensity multiplier. */
  readonly specularIntensity: number;
  /** Ambient glow color for shadow/halo. */
  readonly primaryGlowColor: string;
  readonly secondaryGlowColor: string;
}

const STATE_PROFILES: Record<BrandWaveState, StateMotionProfile> = {
  idle: {
    amplitudeA: 8.5,
    widthModB: 0.055,
    waveNumberK: 1.25,
    omega: 0.85,
    breathRate: 0.7,
    breathDepth: 0.1,
    sheenPeriod: 7.2,
    filmSpeed: 0.55,
    glowOpacity: 0.44,
    specularIntensity: 0.58,
    primaryGlowColor: "rgba(149, 96, 255, 0.52)",
    secondaryGlowColor: "rgba(34, 221, 235, 0.34)",
  },
  ready: {
    amplitudeA: 12.5,
    widthModB: 0.085,
    waveNumberK: 1.35,
    omega: 1.25,
    breathRate: 1.35,
    breathDepth: 0.18,
    sheenPeriod: 4.8,
    filmSpeed: 0.9,
    glowOpacity: 0.58,
    specularIntensity: 0.74,
    primaryGlowColor: "rgba(149, 96, 255, 0.64)",
    secondaryGlowColor: "rgba(50, 140, 255, 0.48)",
  },
  thinking: {
    amplitudeA: 21.0,
    widthModB: 0.135,
    waveNumberK: 1.75,
    omega: 2.75,
    breathRate: 2.2,
    breathDepth: 0.15,
    sheenPeriod: 2.0,
    filmSpeed: 2.1,
    glowOpacity: 0.72,
    specularIntensity: 0.92,
    primaryGlowColor: "rgba(34, 221, 235, 0.70)",
    secondaryGlowColor: "rgba(227, 74, 231, 0.56)",
  },
  done: {
    amplitudeA: 16.0,
    widthModB: 0.1,
    waveNumberK: 1.5,
    omega: 2.4,
    breathRate: 1.6,
    breathDepth: 0.1,
    sheenPeriod: 0,
    filmSpeed: 1.2,
    glowOpacity: 0.62,
    specularIntensity: 0.96,
    primaryGlowColor: "rgba(34, 221, 235, 0.68)",
    secondaryGlowColor: "rgba(149, 96, 255, 0.52)",
  },
  muted: {
    amplitudeA: 0,
    widthModB: 0,
    waveNumberK: 1.0,
    omega: 0,
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

const TAU = Math.PI * 2;
export const DONE_SETTLE_DURATION = 1.55;

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
  /** Effective transverse normal vector pointing from center (v=0) to upper (v=+1). */
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
 * Longitudinal envelope:
 *   E(u) = sin(pi * u)^1.5
 * Keeps the left entry tip (u = 0) and right tail exit (u = 1) anchored
 * while allowing organic volumetric flexion through the interior folds.
 */
export function ribbonEnvelope(u: number): number {
  const s = Math.sin(Math.PI * clamp01(u));
  return Math.pow(Math.max(0, s), 1.5);
}

export function getStateProfile(state: BrandWaveState): StateMotionProfile {
  return STATE_PROFILES[state];
}

export function isMutedState(state: BrandWaveState): boolean {
  return state === "muted";
}

/**
 * Computes time-varying amplitude A(t) and width modulation B(t) for the
 * current state, including breathing modulation and smooth settling in "done".
 */
export function evaluateAmplitudes(motion: RibbonMotion): {
  readonly A: number;
  readonly B: number;
} {
  if (motion.still || motion.state === "muted") {
    return { A: 0, B: 0 };
  }

  const profile = STATE_PROFILES[motion.state];
  const breath =
    1 + profile.breathDepth * Math.sin(profile.breathRate * motion.time);

  let settle = 1;
  if (motion.state === "done") {
    if (motion.doneElapsed >= DONE_SETTLE_DURATION) {
      return { A: 0, B: 0 };
    }
    const progress = clamp01(motion.doneElapsed / DONE_SETTLE_DURATION);
    // Smooth cubic ease-out decay after the confirming pulse
    settle = Math.pow(1 - progress, 2.2);
  }

  return {
    A: profile.amplitudeA * breath * settle,
    B: profile.widthModB * breath * settle,
  };
}

/**
 * Evaluates a single ribbon slice at time t and returns its deformed
 * centerline C(u, t), half-width h(u, t), upper R(u, +1, t), and lower R(u, -1, t).
 */
export function deformSlice(
  slice: RibbonSlice,
  phaseOffset: number,
  motion: RibbonMotion,
  A: number,
  B: number,
): DeformedSlice {
  if (A === 0 && B === 0) {
    return {
      u: slice.u,
      uGlobal: slice.uGlobal,
      x: slice.x,
      center: slice.center0,
      upper: slice.upper0,
      lower: slice.lower0,
      halfWidth: slice.halfWidth0,
      spanUnit: [0, -1],
    };
  }

  const profile = STATE_PROFILES[motion.state];
  // Use coupled global + local u so the three ribbons move as one coherent
  // acoustic wave across overlaps while respecting each ribbon's own contour.
  const uCoupled = slice.uGlobal * 0.78 + slice.u * 0.22;
  const env =
    ribbonEnvelope(slice.uGlobal) * (0.35 + 0.65 * ribbonEnvelope(slice.u));

  const phase =
    TAU * profile.waveNumberK * uCoupled -
    profile.omega * motion.time +
    phaseOffset;

  // Primary + subtle secondary harmonic for organic liquid motion
  const waveSin =
    Math.sin(phase) * 0.82 +
    Math.sin(phase * 1.65 + 1.15) * 0.18;
  const waveCos =
    Math.cos(phase) * 0.82 +
    Math.cos(phase * 1.65 + 1.15) * 0.18;

  // Normal displacement vector D(u, t) = A(t) * E(u) * sin(...) * N(u).
  // Horizontal normal component N_x is scaled by curvatureDamping so steep
  // folds never self-intersect or cross overlap seams.
  const dispMag = A * env * waveSin;
  const nxSafe = slice.normal[0] * slice.curvatureDamping * 0.36;
  const nySafe = slice.normal[1];

  const cx = slice.center0[0] + dispMag * nxSafe;
  const cy = slice.center0[1] + dispMag * nySafe;

  // Width modulation:
  // h(u, t) = h0(u) * [1 + B(t) * E(u) * cos(2*pi*k*u - omega*t + phi)]
  // Clamped to [0.76, 1.26] * h0(u) so width never collapses or inverts.
  const widthScale = Math.min(
    1.26,
    Math.max(0.76, 1 + B * env * waveCos),
  );
  const h = slice.halfWidth0 * widthScale;

  // Subtle normal tilt on the transverse span vector
  const spanX = nxSafe * 0.18;
  const spanY = -1; // In SVG coordinates, v = +1 is upward (-y)

  const upper: Vec2 = [cx + h * spanX, cy + h * spanY];
  const lower: Vec2 = [cx - h * spanX, cy - h * spanY];

  return {
    u: slice.u,
    uGlobal: slice.uGlobal,
    x: cx,
    center: [cx, cy],
    upper,
    lower,
    halfWidth: h,
    spanUnit: [spanX, spanY],
  };
}

/**
 * Evaluates R(u, v, t) = C(u, t) + v * h(u, t) * N(u) for any transverse
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
  const { A, B } = evaluateAmplitudes(motion);
  const slices = surface.slices.map((s) =>
    deformSlice(s, surface.phaseOffset, motion, A, B),
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
  const t = motion.still ? 0 : motion.time * profile.filmSpeed;
  const freq = layerIndex === 0 ? 2.1 : 2.85;
  const dir = layerIndex === 0 ? -1 : 1;
  const basePhase =
    deformed.surface.phaseOffset + (layerIndex === 0 ? 0.3 : 2.15);

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const wave =
      Math.sin(TAU * freq * s.uGlobal + dir * t + basePhase) * 0.34 +
      Math.cos(TAU * (freq * 0.65) * s.u - dir * t * 0.7 + basePhase) * 0.16;

    // Layer 0 rides slightly higher in v, Layer 1 rides slightly lower;
    // their overlap zone around v in [-0.25, +0.25] creates optical color mixing.
    const centerV = (layerIndex === 0 ? 0.16 : -0.14) + wave;
    const halfBand = layerIndex === 0 ? 0.44 : 0.42;

    const vHigh = Math.min(0.94, Math.max(-0.6, centerV + halfBand));
    const vLow = Math.max(-0.94, Math.min(0.6, centerV - halfBand));

    upperPts.push(pointOnDeformedSlice(s, vHigh));
    lowerPts.push(pointOnDeformedSlice(s, vLow));
  }

  return { upperPts, lowerPts };
}

/**
 * Computes the parametric internal specular highlight strip along the ribbon's
 * centerline C(u, t), concentrated around the upper-center ridge (v in [-0.12, +0.46])
 * so light follows the 3D tubular curvature of the folds.
 */
export function buildSpecularCoreStrip(
  deformed: DeformedRibbonSurface,
  motion: RibbonMotion,
): { readonly upperPts: Vec2[]; readonly lowerPts: Vec2[] } {
  const profile = STATE_PROFILES[motion.state];
  const t = motion.still ? 0 : motion.time * (profile.filmSpeed * 0.8);

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const shimmer =
      0.08 *
      Math.sin(
        TAU * 1.8 * s.uGlobal - t + deformed.surface.phaseOffset,
      );
    const vTop = Math.min(0.68, 0.44 + shimmer);
    const vBot = Math.max(-0.45, -0.1 + shimmer * 0.6);

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
    if (motion.doneElapsed >= 1.28) return null;
    // Ease out across the mark for a crisp confirming sweep
    const raw = clamp01(motion.doneElapsed / 1.15);
    return 1 - Math.pow(1 - raw, 1.8);
  }

  const period = STATE_PROFILES[motion.state].sheenPeriod;
  if (period <= 0) return null;
  return (motion.time % period) / period;
}
