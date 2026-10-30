// Mathematical Ribbon Deformation Engine — Horizontal Wave Propagation Model.
//
// Adapts the multi-layered travelling-wave morphology of LiquidWaveform.tsx to
// the three closed volumetric ribbon surfaces of the Whisperline brandmark:
//
// 1. Three-Component Horizontal Travelling Wave Field (Section 3):
//    d(x, t) = E(x) * [
//      A1 * sin(k1 * x - w1 * t + phi1) +
//      A2 * sin(k2 * x - w2 * t + phi2) +
//      A3 * sin(k3 * x - w3 * t + phi3)
//    ]
//    where x in [0, 1] is the normalized horizontal position across the 1164-unit
//    composition and E(x) = sin(pi * x)^p concentrates energy in the central
//    signal region while smoothly attenuating toward both horizontal ends.
//
// 2. Differential Upper/Lower Contour Propagation & Pinch/Swell Breathing:
//    The upper boundary (v = +1) and lower boundary (v = -1) carry phase-offset
//    travelling wave components plus transverse thickness modulation delta_h(x, t)
//    so neighboring horizontal sections simultaneously expand and contract as
//    peaks and troughs propagate left-to-right through the logo.
//
// 3. Coordinated Multi-Ribbon Phase & Frequency Separation (Section 5):
//    The three brand ribbons share the global horizontal wave clock but apply
//    distinct phase vectors, slight spatial frequency ratios, and amplitude
//    weights (with smooth seam coupling at overlap crossings) so they behave as
//    interacting wave components rather than a single rigid 3D object.

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
  /** Optional integrated dominant wave phase (w1 * t). */
  readonly phase1?: number;
  /** Optional integrated secondary wave phase (w2 * t). */
  readonly phase2?: number;
  /** Optional integrated tertiary wave phase (w3 * t). */
  readonly phase3?: number;
  /** Optional integrated internal chromatic film phase. */
  readonly filmPhase?: number;
  /** Optional smoothed amplitude scale [0, 1.5] across state transitions. */
  readonly amplitudeScale?: number;
  /** Target CSS render width in pixels (default 78). */
  readonly renderWidth?: number;
}

/**
 * Serializable per-state wave preset parameters exposed in the DEV Tuning Lab
 * and used by the deformation + rendering pipeline.
 */
export interface StatePresetTuning {
  /** Dominant horizontal wave amplitude A1 in viewBox units (at 78px width). */
  amplitudeA1: number;
  /** Secondary harmonic amplitude A2 in viewBox units. */
  amplitudeA2: number;
  /** Tertiary interference harmonic amplitude A3 in viewBox units. */
  amplitudeA3: number;
  /** Dominant thickness modulation B1 (e.g. 0.105 = 10.5%). */
  widthModB1: number;
  /** Secondary thickness modulation B2. */
  widthModB2: number;
  /** Tertiary thickness modulation B3. */
  widthModB3: number;
  /** Dominant spatial wave cycles across mark (k1 = 2*pi * k1Cycles). */
  k1Cycles: number;
  /** Secondary spatial wave cycles across mark (k2 = 2*pi * k2Cycles). */
  k2Cycles: number;
  /** Tertiary spatial wave cycles across mark (k3 = 2*pi * k3Cycles). */
  k3Cycles: number;
  /** Dominant wave cycle duration T1 in seconds (w1 = 2*pi / T1). */
  cycleSeconds1: number;
  /** Secondary wave cycle duration T2 in seconds (w2 = 2*pi / T2). */
  cycleSeconds2: number;
  /** Tertiary counter-wave cycle duration T3 in seconds (w3 = -2*pi / T3). */
  cycleSeconds3: number;
  /** Seconds per internal specular pass (0 = single pass on done / disabled). */
  sheenPeriod: number;
  /** Speed of internal chromatic film layers (rad/s). */
  filmSpeed: number;
  /** Volumetric glow opacity multiplier. */
  glowOpacity: number;
  /** Specular core intensity multiplier. */
  specularIntensity: number;
  /** Ambient glow colors. */
  primaryGlowColor: string;
  secondaryGlowColor: string;
}

export interface StateMotionProfile extends StatePresetTuning {
  /** Dominant spatial frequency k1 (radians across x in [0, 1]). */
  readonly k1: number;
  /** Secondary spatial frequency k2 (radians across x in [0, 1]). */
  readonly k2: number;
  /** Tertiary spatial frequency k3 (radians across x in [0, 1]). */
  readonly k3: number;
  /** Dominant angular velocity w1 (rad/s, positive = left-to-right). */
  readonly omega1: number;
  /** Secondary angular velocity w2 (rad/s). */
  readonly omega2: number;
  /** Tertiary angular velocity w3 (rad/s, counter-propagating interference). */
  readonly omega3: number;
}

/**
 * Per-ribbon wave coupling parameters (Section 3 & 5).
 * Gives each of the three ribbon surfaces distinct phase offsets, spatial
 * frequency ratios, and amplitude weights so overlapping horizontal regions
 * move asynchronously like LiquidWaveform ribbons while remaining one signal.
 */
export interface RibbonWaveCoupling {
  phase1: number;
  phase2: number;
  phase3: number;
  freqScale1: number;
  freqScale2: number;
  freqScale3: number;
  ampScale: number;
  thicknessScale: number;
}

/**
 * Global wave envelope, differential upper/lower contour phase offsets,
 * width breathing clamps, and overlap seam protection parameters.
 */
export interface RibbonShapingTuning {
  /** Power p in E(x) = sin(pi * x)^p (default 1.45). */
  envelopePower: number;
  /** Phase lead (rad) on the upper contour v = +1 (default 0.28). */
  upperPhaseLead: number;
  /** Phase lag (rad) on the lower contour v = -1 (default 0.28). */
  lowerPhaseLag: number;
  /** Minimum half-width pinch ratio relative to resting h0(x) (default 0.72). */
  minWidthRatio: number;
  /** Maximum half-width swell ratio relative to resting h0(x) (default 1.32). */
  maxWidthRatio: number;
  /** Horizontal shear factor along smoothed normal (default 0.35). */
  horizontalShear: number;
  /** Phase blend toward center ribbon at underpass seams (default 0.75). */
  seamBlendStrength: number;
  /** Amplitude damping at underpass seams (default 0.32). */
  seamAmpDamping: number;
}

/**
 * Optical material, internal chromatic wave sub-ribbons, rim lighting, and
 * fold occlusion/caustic strengths used by BrandRibbonRenderer.tsx.
 */
export interface RibbonMaterialTuning {
  /** Transverse swing amplitude of internal chromatic wave strips (default 0.72). */
  filmSwing: number;
  /** Opacity multiplier for forward cyan->blue->violet wave strip (default 0.58). */
  film0Opacity: number;
  /** Opacity multiplier for counter-phased blue->violet->magenta->pink strip (default 0.58). */
  film1Opacity: number;
  /** Opacity multiplier for additive ("lighter") central interference strip (default 0.42). */
  film2AdditiveOpacity: number;
  /** Stroke width of upper edge highlight (v = +1) in viewBox units (default 11.5). */
  upperRimWidth: number;
  /** Stroke width of lower edge highlight (v = -1) in viewBox units (default 8.0). */
  lowerRimWidth: number;
  /** Opacity multiplier for upper edge highlight (default 1.0). */
  upperRimOpacity: number;
  /** Opacity multiplier for lower edge highlight (default 1.0). */
  lowerRimOpacity: number;
  /** Underpass fold shadow strength (default 0.62). */
  occlusionStrength: number;
  /** Overpass fold caustic lift strength (default 0.38). */
  overpassCausticStrength: number;
}

export interface RibbonTuningConfig {
  states: Record<BrandWaveState, StatePresetTuning>;
  ribbons: Record<RibbonId, RibbonWaveCoupling>;
  shaping: RibbonShapingTuning;
  material: RibbonMaterialTuning;
}

const TAU = Math.PI * 2;
export const DONE_SETTLE_DURATION = 1.65;
export const DEFAULT_RIBBON_WIDTH_PX = 78;
const DEV_TUNING_STORAGE_KEY = "whisperlane.dev.ribbonTuning.v1";
const DEV_TUNING_EVENT_NAME = "whisperlane-ribbon-tuning-change";

export const DEFAULT_RIBBON_TUNING_CONFIG: RibbonTuningConfig = {
  states: {
    idle: {
      amplitudeA1: 19.5,
      amplitudeA2: 7.5,
      amplitudeA3: 3.8,
      widthModB1: 0.105,
      widthModB2: 0.048,
      widthModB3: 0.024,
      k1Cycles: 2.35,
      k2Cycles: 3.75,
      k3Cycles: 5.2,
      cycleSeconds1: 4.8,
      cycleSeconds2: 2.9,
      cycleSeconds3: 3.6,
      sheenPeriod: 5.8,
      filmSpeed: 1.25,
      glowOpacity: 0.46,
      specularIntensity: 0.68,
      primaryGlowColor: "rgba(149, 96, 255, 0.54)",
      secondaryGlowColor: "rgba(34, 221, 235, 0.36)",
    },
    ready: {
      amplitudeA1: 22.5,
      amplitudeA2: 8.8,
      amplitudeA3: 4.5,
      widthModB1: 0.12,
      widthModB2: 0.055,
      widthModB3: 0.028,
      k1Cycles: 2.35,
      k2Cycles: 3.75,
      k3Cycles: 5.2,
      cycleSeconds1: 4.2,
      cycleSeconds2: 2.5,
      cycleSeconds3: 3.1,
      sheenPeriod: 4.2,
      filmSpeed: 1.55,
      glowOpacity: 0.58,
      specularIntensity: 0.82,
      primaryGlowColor: "rgba(149, 96, 255, 0.64)",
      secondaryGlowColor: "rgba(50, 140, 255, 0.48)",
    },
    thinking: {
      amplitudeA1: 28.0,
      amplitudeA2: 11.2,
      amplitudeA3: 5.8,
      widthModB1: 0.145,
      widthModB2: 0.068,
      widthModB3: 0.035,
      k1Cycles: 2.5,
      k2Cycles: 4.0,
      k3Cycles: 5.6,
      cycleSeconds1: 2.1,
      cycleSeconds2: 1.3,
      cycleSeconds3: 1.65,
      sheenPeriod: 1.9,
      filmSpeed: 2.75,
      glowOpacity: 0.72,
      specularIntensity: 0.96,
      primaryGlowColor: "rgba(34, 221, 235, 0.70)",
      secondaryGlowColor: "rgba(227, 74, 231, 0.56)",
    },
    done: {
      amplitudeA1: 24.0,
      amplitudeA2: 9.2,
      amplitudeA3: 4.6,
      widthModB1: 0.12,
      widthModB2: 0.052,
      widthModB3: 0.025,
      k1Cycles: 2.35,
      k2Cycles: 3.75,
      k3Cycles: 5.2,
      cycleSeconds1: 2.0,
      cycleSeconds2: 1.3,
      cycleSeconds3: 1.6,
      sheenPeriod: 0,
      filmSpeed: 1.8,
      glowOpacity: 0.62,
      specularIntensity: 0.98,
      primaryGlowColor: "rgba(34, 221, 235, 0.68)",
      secondaryGlowColor: "rgba(149, 96, 255, 0.52)",
    },
    muted: {
      amplitudeA1: 0,
      amplitudeA2: 0,
      amplitudeA3: 0,
      widthModB1: 0,
      widthModB2: 0,
      widthModB3: 0,
      k1Cycles: 2.35,
      k2Cycles: 3.75,
      k3Cycles: 5.2,
      cycleSeconds1: 0,
      cycleSeconds2: 0,
      cycleSeconds3: 0,
      sheenPeriod: 0,
      filmSpeed: 0,
      glowOpacity: 0.22,
      specularIntensity: 0.22,
      primaryGlowColor: "rgba(120, 128, 152, 0.24)",
      secondaryGlowColor: "rgba(95, 102, 124, 0.18)",
    },
  },
  ribbons: {
    "ribbon-left": {
      phase1: 0.0,
      phase2: 0.4,
      phase3: 0.0,
      freqScale1: 0.96,
      freqScale2: 1.04,
      freqScale3: 0.94,
      ampScale: 0.94,
      thicknessScale: 0.95,
    },
    "ribbon-center": {
      phase1: 0.68,
      phase2: 1.55,
      phase3: -1.1,
      freqScale1: 1.05,
      freqScale2: 1.1,
      freqScale3: 1.06,
      ampScale: 1.12,
      thicknessScale: 1.15,
    },
    "ribbon-right": {
      phase1: 1.34,
      phase2: 2.8,
      phase3: -2.15,
      freqScale1: 0.93,
      freqScale2: 0.95,
      freqScale3: 1.02,
      ampScale: 0.9,
      thicknessScale: 0.92,
    },
  },
  shaping: {
    envelopePower: 1.45,
    upperPhaseLead: 0.28,
    lowerPhaseLag: 0.28,
    minWidthRatio: 0.72,
    maxWidthRatio: 1.32,
    horizontalShear: 0.35,
    seamBlendStrength: 0.75,
    seamAmpDamping: 0.32,
  },
  material: {
    filmSwing: 0.72,
    film0Opacity: 0.58,
    film1Opacity: 0.58,
    film2AdditiveOpacity: 0.42,
    upperRimWidth: 11.5,
    lowerRimWidth: 8.0,
    upperRimOpacity: 1.0,
    lowerRimOpacity: 1.0,
    occlusionStrength: 0.62,
    overpassCausticStrength: 0.38,
  },
};

export function cloneRibbonTuningConfig(
  src: RibbonTuningConfig = DEFAULT_RIBBON_TUNING_CONFIG,
): RibbonTuningConfig {
  return JSON.parse(JSON.stringify(src)) as RibbonTuningConfig;
}

function mergeWithDefaultConfig(
  partial: Partial<RibbonTuningConfig> | null | undefined,
): RibbonTuningConfig {
  const base = cloneRibbonTuningConfig(DEFAULT_RIBBON_TUNING_CONFIG);
  if (!partial || typeof partial !== "object") return base;

  if (partial.states && typeof partial.states === "object") {
    for (const key of Object.keys(base.states) as BrandWaveState[]) {
      if (partial.states[key]) {
        base.states[key] = { ...base.states[key], ...partial.states[key] };
      }
    }
  }
  if (partial.ribbons && typeof partial.ribbons === "object") {
    for (const key of Object.keys(base.ribbons) as RibbonId[]) {
      if (partial.ribbons[key]) {
        base.ribbons[key] = { ...base.ribbons[key], ...partial.ribbons[key] };
      }
    }
  }
  if (partial.shaping && typeof partial.shaping === "object") {
    base.shaping = { ...base.shaping, ...partial.shaping };
  }
  if (partial.material && typeof partial.material === "object") {
    base.material = { ...base.material, ...partial.material };
  }
  return base;
}

function loadInitialTuningConfig(): RibbonTuningConfig {
  if (typeof window === "undefined") {
    return cloneRibbonTuningConfig(DEFAULT_RIBBON_TUNING_CONFIG);
  }
  try {
    const raw = window.localStorage.getItem(DEV_TUNING_STORAGE_KEY);
    if (!raw) return cloneRibbonTuningConfig(DEFAULT_RIBBON_TUNING_CONFIG);
    return mergeWithDefaultConfig(
      JSON.parse(raw) as Partial<RibbonTuningConfig>,
    );
  } catch {
    return cloneRibbonTuningConfig(DEFAULT_RIBBON_TUNING_CONFIG);
  }
}

let activeTuningConfig: RibbonTuningConfig = loadInitialTuningConfig();

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === DEV_TUNING_STORAGE_KEY) {
      activeTuningConfig = loadInitialTuningConfig();
      window.dispatchEvent(new CustomEvent(DEV_TUNING_EVENT_NAME));
    }
  });
}

export function getRibbonTuningConfig(): RibbonTuningConfig {
  return activeTuningConfig;
}

export function setRibbonTuningConfig(next: RibbonTuningConfig): void {
  activeTuningConfig = mergeWithDefaultConfig(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        DEV_TUNING_STORAGE_KEY,
        JSON.stringify(activeTuningConfig),
      );
    } catch {
      // Ignore storage quota errors
    }
    window.dispatchEvent(new CustomEvent(DEV_TUNING_EVENT_NAME));
  }
}

export function resetRibbonTuningConfig(): RibbonTuningConfig {
  const fresh = cloneRibbonTuningConfig(DEFAULT_RIBBON_TUNING_CONFIG);
  activeTuningConfig = fresh;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(DEV_TUNING_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    window.dispatchEvent(new CustomEvent(DEV_TUNING_EVENT_NAME));
  }
  return fresh;
}

export function subscribeRibbonTuningConfig(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(DEV_TUNING_EVENT_NAME, handler);
  return () => window.removeEventListener(DEV_TUNING_EVENT_NAME, handler);
}

function buildStateMotionProfile(preset: StatePresetTuning): StateMotionProfile {
  return {
    ...preset,
    k1: TAU * preset.k1Cycles,
    k2: TAU * preset.k2Cycles,
    k3: TAU * preset.k3Cycles,
    omega1: preset.cycleSeconds1 > 0 ? TAU / preset.cycleSeconds1 : 0,
    omega2: preset.cycleSeconds2 > 0 ? TAU / preset.cycleSeconds2 : 0,
    omega3: preset.cycleSeconds3 > 0 ? -TAU / preset.cycleSeconds3 : 0,
  };
}

export interface DeformedSlice {
  readonly u: number;
  readonly uGlobal: number;
  readonly x: number;
  /** Deformed centerline C(x, t). */
  readonly center: Vec2;
  /** Deformed upper boundary R(x, +1, t). */
  readonly upper: Vec2;
  /** Deformed lower boundary R(x, -1, t). */
  readonly lower: Vec2;
  /** Deformed half-width h(x, t). */
  readonly halfWidth: number;
  /** Signed vertical wave displacement at this slice (in viewBox units). */
  readonly normalDisplacement: number;
  /** Multiplicative width scale h(x, t) / h0(x). */
  readonly widthScale: number;
  /** Instantaneous normalized wave energy [0, 1] for core luminescence. */
  readonly waveEnergy: number;
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Bell-shaped horizontal spatial envelope E(x) = sin(pi * x)^p (Section 3 & 4).
 * Concentrates wave motion in the central signal region while smoothly
 * anchoring the left needle tip (x = 0) and right tail exit (x = 1).
 */
export function ribbonEnvelope(
  xNorm: number,
  power = activeTuningConfig.shaping.envelopePower,
): number {
  const s = Math.sin(Math.PI * clamp01(xNorm));
  return Math.pow(Math.max(0, s), power);
}

export function getStateProfile(
  state: BrandWaveState,
  config: RibbonTuningConfig = activeTuningConfig,
): StateMotionProfile {
  return buildStateMotionProfile(config.states[state]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Returns the active motion profile for a state, smoothly transitioning
 * from the "done" preset into the "idle" preset over DONE_SETTLE_DURATION
 * so "done" plays its completion effect and then settles into "idle" motion
 * instead of freezing.
 */
export function getBlendedStateProfile(
  state: BrandWaveState,
  doneElapsed = 0,
  config: RibbonTuningConfig = activeTuningConfig,
): StateMotionProfile {
  if (state !== "done" || doneElapsed <= 0) {
    return getStateProfile(state, config);
  }
  if (doneElapsed >= DONE_SETTLE_DURATION) {
    return getStateProfile("idle", config);
  }
  const doneP = getStateProfile("done", config);
  const idleP = getStateProfile("idle", config);
  const t = smoothstep(0, DONE_SETTLE_DURATION, doneElapsed);
  return {
    amplitudeA1: lerp(doneP.amplitudeA1, idleP.amplitudeA1, t),
    amplitudeA2: lerp(doneP.amplitudeA2, idleP.amplitudeA2, t),
    amplitudeA3: lerp(doneP.amplitudeA3, idleP.amplitudeA3, t),
    widthModB1: lerp(doneP.widthModB1, idleP.widthModB1, t),
    widthModB2: lerp(doneP.widthModB2, idleP.widthModB2, t),
    widthModB3: lerp(doneP.widthModB3, idleP.widthModB3, t),
    k1Cycles: lerp(doneP.k1Cycles, idleP.k1Cycles, t),
    k2Cycles: lerp(doneP.k2Cycles, idleP.k2Cycles, t),
    k3Cycles: lerp(doneP.k3Cycles, idleP.k3Cycles, t),
    cycleSeconds1: lerp(doneP.cycleSeconds1, idleP.cycleSeconds1, t),
    cycleSeconds2: lerp(doneP.cycleSeconds2, idleP.cycleSeconds2, t),
    cycleSeconds3: lerp(doneP.cycleSeconds3, idleP.cycleSeconds3, t),
    sheenPeriod: idleP.sheenPeriod,
    filmSpeed: lerp(doneP.filmSpeed, idleP.filmSpeed, t),
    glowOpacity: lerp(doneP.glowOpacity, idleP.glowOpacity, t),
    specularIntensity: lerp(doneP.specularIntensity, idleP.specularIntensity, t),
    primaryGlowColor: t < 0.5 ? doneP.primaryGlowColor : idleP.primaryGlowColor,
    secondaryGlowColor: t < 0.5 ? doneP.secondaryGlowColor : idleP.secondaryGlowColor,
    k1: lerp(doneP.k1, idleP.k1, t),
    k2: lerp(doneP.k2, idleP.k2, t),
    k3: lerp(doneP.k3, idleP.k3, t),
    omega1: lerp(doneP.omega1, idleP.omega1, t),
    omega2: lerp(doneP.omega2, idleP.omega2, t),
    omega3: lerp(doneP.omega3, idleP.omega3, t),
  };
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

export interface EvaluatedWaveParams {
  readonly A1: number;
  readonly A2: number;
  readonly A3: number;
  readonly B1: number;
  readonly B2: number;
  readonly B3: number;
  readonly psi1: number;
  readonly psi2: number;
  readonly psi3: number;
}

/**
 * Evaluates time-varying wave amplitudes (A1, A2, A3), thickness modulations
 * (B1, B2, B3), and temporal phases (psi1, psi2, psi3).
 */
export function evaluateWaveParameters(
  motion: RibbonMotion,
  config: RibbonTuningConfig = activeTuningConfig,
): EvaluatedWaveParams {
  if (motion.still || motion.state === "muted") {
    return {
      A1: 0,
      A2: 0,
      A3: 0,
      B1: 0,
      B2: 0,
      B3: 0,
      psi1: 0,
      psi2: 0,
      psi3: 0,
    };
  }

  const profile = getBlendedStateProfile(motion.state, motion.doneElapsed, config);
  const settle = motion.amplitudeScale ?? 1;

  const targetW = motion.renderWidth ?? DEFAULT_RIBBON_WIDTH_PX;
  const sizeCompensation = Math.min(
    1.25,
    Math.max(
      0.85,
      Math.pow(DEFAULT_RIBBON_WIDTH_PX / Math.max(48, targetW), 0.35),
    ),
  );

  const scale = settle * sizeCompensation;
  const psi1 = motion.phase1 ?? profile.omega1 * motion.time;
  const psi2 = motion.phase2 ?? profile.omega2 * motion.time;
  const psi3 = motion.phase3 ?? profile.omega3 * motion.time;

  return {
    A1: profile.amplitudeA1 * scale,
    A2: profile.amplitudeA2 * scale,
    A3: profile.amplitudeA3 * scale,
    B1: profile.widthModB1 * settle,
    B2: profile.widthModB2 * settle,
    B3: profile.widthModB3 * settle,
    psi1,
    psi2,
    psi3,
  };
}

/**
 * Protects sensitive underpass cut seams so that when ribbon-left tucks under
 * ribbon-center (u in [0.85, 1.0]) or ribbon-right emerges from under
 * ribbon-center (u in [0.0, 0.20]), their phase divergence smoothly blends
 * toward ribbon-center's phase and never breaks overlap topology.
 */
function evaluateSeamCoupling(
  ribbonId: RibbonId,
  uLocal: number,
  shaping: RibbonShapingTuning,
): { readonly phaseBlendToCenter: number; readonly seamAmpFactor: number } {
  if (ribbonId === "ribbon-left") {
    const seam = smoothstep(0.82, 0.98, uLocal);
    return {
      phaseBlendToCenter: seam * shaping.seamBlendStrength,
      seamAmpFactor: 1 - seam * shaping.seamAmpDamping,
    };
  }
  if (ribbonId === "ribbon-right") {
    const seam = 1 - smoothstep(0.02, 0.22, uLocal);
    return {
      phaseBlendToCenter: seam * shaping.seamBlendStrength,
      seamAmpFactor: 1 - seam * shaping.seamAmpDamping,
    };
  }
  return { phaseBlendToCenter: 0, seamAmpFactor: 1 };
}

/**
 * Evaluates a single ribbon slice at time t using the horizontal 3-wave
 * propagation model (Section 3 & 5):
 *   d(x, t) = E(x) * [A1 * sin(k1*x - w1*t + phi1)
 *                   + A2 * sin(k2*x - w2*t + phi2)
 *                   + A3 * sin(k3*x - w3*t + phi3)]
 * with differential upper/lower contour phases and pinch/swell width modulation.
 */
export function deformSlice(
  ribbonId: RibbonId,
  slice: RibbonSlice,
  profile: StateMotionProfile,
  params: EvaluatedWaveParams,
  config: RibbonTuningConfig = activeTuningConfig,
): DeformedSlice {
  const { A1, A2, A3, B1, B2, B3, psi1, psi2, psi3 } = params;
  if (A1 === 0 && A2 === 0 && A3 === 0 && B1 === 0 && B2 === 0 && B3 === 0) {
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
      waveEnergy: 0,
      spanUnit: [0, -1],
    };
  }

  const { shaping, ribbons } = config;
  const coupling = ribbons[ribbonId];
  const centerCoupling = ribbons["ribbon-center"];
  const { phaseBlendToCenter, seamAmpFactor } = evaluateSeamCoupling(
    ribbonId,
    slice.u,
    shaping,
  );

  // Normalized horizontal coordinate x in [0, 1] across the composition
  const x = slice.uGlobal;
  const baseEnv = ribbonEnvelope(x, shaping.envelopePower);
  const env = baseEnv * seamAmpFactor;

  // Blend phase slightly toward center ribbon right at cut seams to preserve overlap
  const phi1 =
    coupling.phase1 +
    (centerCoupling.phase1 - coupling.phase1) * phaseBlendToCenter;
  const phi2 =
    coupling.phase2 +
    (centerCoupling.phase2 - coupling.phase2) * phaseBlendToCenter;
  const phi3 =
    coupling.phase3 +
    (centerCoupling.phase3 - coupling.phase3) * phaseBlendToCenter;

  const k1 = profile.k1 * coupling.freqScale1;
  const k2 = profile.k2 * coupling.freqScale2;
  const k3 = profile.k3 * coupling.freqScale3;

  const theta1 = k1 * x - psi1 + phi1;
  const theta2 = k2 * x - psi2 + phi2;
  const theta3 = k3 * x - psi3 + phi3;

  // Centerline horizontal travelling wave d(x, t)
  const w1Center = Math.sin(theta1);
  const w2Center = Math.sin(theta2);
  const w3Center = Math.sin(theta3);

  const dCenter =
    env *
    coupling.ampScale *
    (A1 * w1Center + A2 * w2Center + A3 * w3Center);

  const lead = shaping.upperPhaseLead;
  const lag = shaping.lowerPhaseLag;

  // Differential upper & lower contour wave components (inspired by LiquidWaveform's
  // opening vs closing contour phase offset) so the top and bottom edges ripple
  // independently as the wave travels horizontally.
  const dUpperWave =
    env *
    coupling.ampScale *
    (A1 * Math.sin(theta1 + lead) +
      A2 * Math.sin(theta2 + lead * 2.2) +
      A3 * Math.cos(theta3 - lead * 1.25));

  const dLowerWave =
    env *
    coupling.ampScale *
    (A1 * Math.sin(theta1 - lag) +
      A2 * Math.sin(theta2 - lag * 1.85) +
      A3 * Math.sin(theta3 + lag * 1.6));

  // Explicit transverse thickness pinch/swell modulation
  const breathWave =
    env *
    coupling.thicknessScale *
    (B1 * Math.cos(theta1 + 0.35) +
      B2 * Math.sin(theta2 + 1.05) +
      B3 * Math.cos(theta3 - 0.5));

  // Subtle horizontal shear along the smoothed liquid normal (kept small so
  // motion is organized primarily as horizontal wave propagation, never whole-body sway)
  const cx =
    slice.center0[0] + dCenter * slice.liquidNormal[0] * shaping.horizontalShear;

  let upperY: number;
  let lowerY: number;
  let widthScale = 1;

  if (slice.halfWidth0 <= 1e-3) {
    // Preserve sharp single-vertex tips exactly closed
    upperY = slice.center0[1] + dCenter;
    lowerY = upperY;
  } else {
    const rawUpperY =
      slice.upper0[1] + dUpperWave - slice.halfWidth0 * breathWave;
    const rawLowerY =
      slice.lower0[1] + dLowerWave + slice.halfWidth0 * breathWave;

    const midY = (rawUpperY + rawLowerY) * 0.5;
    const rawHalfW = (rawLowerY - rawUpperY) * 0.5;

    // Clamp half-width to [minWidthRatio, maxWidthRatio] * h0(x) so the ribbon
    // visibly expands and contracts without ever pinching shut or self-intersecting.
    const minRatio = Math.min(shaping.minWidthRatio, shaping.maxWidthRatio);
    const maxRatio = Math.max(shaping.minWidthRatio, shaping.maxWidthRatio);
    const minHalfW = slice.halfWidth0 * minRatio;
    const maxHalfW = slice.halfWidth0 * maxRatio;
    const clampedHalfW = Math.min(maxHalfW, Math.max(minHalfW, rawHalfW));

    upperY = midY - clampedHalfW;
    lowerY = midY + clampedHalfW;
    widthScale = clampedHalfW / slice.halfWidth0;
  }

  const cy = (upperY + lowerY) * 0.5;
  const h = Math.max(0, (lowerY - upperY) * 0.5);

  // Instantaneous local wave energy [0, 1] used by the renderer to brighten
  // overlapping central regions as wave peaks pass through.
  const normWave =
    Math.abs(w1Center * 0.6 + w2Center * 0.28 + w3Center * 0.12) * baseEnv;
  const waveEnergy = clamp01(normWave * 1.25);

  return {
    u: slice.u,
    uGlobal: slice.uGlobal,
    x: cx,
    center: [cx, cy],
    upper: [cx, upperY],
    lower: [cx, lowerY],
    halfWidth: h,
    normalDisplacement: cy - slice.center0[1],
    widthScale,
    waveEnergy,
    spanUnit: [0, -1],
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
  config: RibbonTuningConfig = activeTuningConfig,
): DeformedRibbonSurface {
  const profile = getBlendedStateProfile(motion.state, motion.doneElapsed, config);
  const params = evaluateWaveParameters(motion, config);
  const slices = surface.slices.map((s) =>
    deformSlice(surface.id, s, profile, params, config),
  );
  return {
    id: surface.id,
    surface,
    slices,
  };
}

/**
 * Computes three internal travelling wave sub-ribbons (layerIndex: 0 | 1 | 2)
 * inside the [-1, 1] transverse domain of a deformed ribbon (Section 4 & 5).
 *
 * Adapted directly from LiquidWaveform.tsx's multi-ribbon interference model:
 * Each chromatic film strip travels at a distinct velocity, spatial frequency,
 * and phase with differential opening/closing contours so translucent color
 * surfaces continuously cross, pinch, swell, and brighten at intersections.
 */
export function buildInternalWaveStrip(
  deformed: DeformedRibbonSurface,
  layerIndex: 0 | 1 | 2,
  motion: RibbonMotion,
  config: RibbonTuningConfig = activeTuningConfig,
): { readonly upperPts: Vec2[]; readonly lowerPts: Vec2[] } {
  const profile = getBlendedStateProfile(motion.state, motion.doneElapsed, config);
  const coupling = config.ribbons[deformed.id];
  const baseSwing = config.material.filmSwing;
  const baseT = motion.still
    ? 0
    : (motion.filmPhase ?? motion.time * profile.filmSpeed);

  // Distinct speeds, directions, and spatial frequencies per internal ribbon,
  // mirroring LiquidWaveform.tsx's RIBBONS array.
  const speedMul =
    layerIndex === 0 ? 1.15 : layerIndex === 1 ? -0.92 : 1.48;
  const freq =
    layerIndex === 0 ? 2.2 : layerIndex === 1 ? 3.1 : 3.9;
  const phase =
    coupling.phase1 +
    (layerIndex === 0 ? 0.2 : layerIndex === 1 ? 1.75 : 3.4);
  const t = baseT * speedMul + phase;

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const x = s.uGlobal;
    const bell = Math.pow(Math.sin(x * Math.PI), 1.35);

    // Opening (upper) vs closing (lower) wave equations adapted from LiquidWaveform.tsx
    const waveOpen =
      Math.sin(x * TAU * freq - t) * 0.68 +
      Math.cos(x * TAU * (freq * 1.75) + t * 0.55) * 0.32;
    const waveClose =
      Math.sin(x * TAU * freq - t + 0.65) * 0.64 +
      Math.sin(x * TAU * (freq * 1.45) + t * 0.42) * 0.36;

    const biasV =
      layerIndex === 0 ? 0.14 : layerIndex === 1 ? -0.14 : 0.0;
    const swing =
      (layerIndex === 2 ? baseSwing * 0.78 : baseSwing) * (0.35 + 0.65 * bell);

    const vA = biasV + waveOpen * swing;
    const vB = biasV - waveClose * swing * 0.85;

    const vHigh = Math.min(0.96, Math.max(-0.65, Math.max(vA, vB) + 0.16));
    const vLow = Math.max(-0.96, Math.min(0.65, Math.min(vA, vB) - 0.16));

    upperPts.push(pointOnDeformedSlice(s, vHigh));
    lowerPts.push(pointOnDeformedSlice(s, vLow));
  }

  return { upperPts, lowerPts };
}

/**
 * Computes the parametric internal specular highlight strip along the ribbon's
 * centerline C(x, t), swelling in thickness where local wave interference
 * peaks so the center of the signal brightens organically.
 */
export function buildSpecularCoreStrip(
  deformed: DeformedRibbonSurface,
  motion: RibbonMotion,
  config: RibbonTuningConfig = activeTuningConfig,
): { readonly upperPts: Vec2[]; readonly lowerPts: Vec2[] } {
  const profile = getBlendedStateProfile(motion.state, motion.doneElapsed, config);
  const coupling = config.ribbons[deformed.id];
  const t = motion.still
    ? 0
    : (motion.filmPhase ?? motion.time * profile.filmSpeed);

  const upperPts: Vec2[] = [];
  const lowerPts: Vec2[] = [];

  for (const s of deformed.slices) {
    const x = s.uGlobal;
    const shimmer =
      0.16 *
      Math.sin(TAU * 2.6 * x - t * 1.2 + coupling.phase1);
    const energyLift = s.waveEnergy * 0.18;

    const vTop = Math.min(0.76, 0.38 + shimmer + energyLift);
    const vBot = Math.max(-0.58, -0.14 + shimmer * 0.5 - energyLift * 0.6);

    upperPts.push(pointOnDeformedSlice(s, vTop));
    lowerPts.push(pointOnDeformedSlice(s, vBot));
  }

  return { upperPts, lowerPts };
}

/**
 * Normalized longitudinal position [0, 1] of the traveling specular sheen band,
 * or null when settled / muted.
 */
export function evaluateSheenProgress(
  motion: RibbonMotion,
  config: RibbonTuningConfig = activeTuningConfig,
): number | null {
  if (motion.state === "muted") return null;
  if (motion.still) return 0.48;

  if (motion.state === "done") {
    if (motion.doneElapsed < 1.35) {
      const raw = clamp01(motion.doneElapsed / 1.2);
      return 1 - Math.pow(1 - raw, 1.8);
    }
    if (motion.doneElapsed < DONE_SETTLE_DURATION) {
      return null;
    }
    const idlePeriod = getStateProfile("idle", config).sheenPeriod;
    if (idlePeriod <= 0) return null;
    const idleTime = motion.doneElapsed - DONE_SETTLE_DURATION;
    return (idleTime % idlePeriod) / idlePeriod;
  }

  const period = getStateProfile(motion.state, config).sheenPeriod;
  if (period <= 0) return null;
  return (motion.time % period) / period;
}
