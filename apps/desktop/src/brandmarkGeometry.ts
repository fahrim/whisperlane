// Volumetric Brand Ribbon Geometry — derived directly from
// brand-kit/01_Logos/SVG/whisperlane-brandmark-white.svg (1164 x 582 viewBox).
//
// Architectural principle:
// Each ribbon is represented as three distinct layers of geometric data:
//   1. Closed filled surface geometry (exact upper U0(u) and lower L0(u)
//      boundary contours preserving every negative space and overlap cut).
//   2. Parametric centerline C0(u), unit tangent T(u), local normal N(u),
//      and half-width profile h0(u) over longitudinal u in [0, 1] and
//      transverse v in [-1, 1].
//   3. Optical layering, rim ranges, and overlap/occlusion metadata.

export const BRAND_VIEWBOX = { width: 1164, height: 582 } as const;

export type Vec2 = readonly [number, number];

export type RibbonId = "ribbon-left" | "ribbon-center" | "ribbon-right";

export interface LongitudinalZone {
  /** Start in local u [0, 1]. */
  readonly uStart: number;
  /** End in local u [0, 1]. */
  readonly uEnd: number;
  /** Peak intensity [0, 1]. */
  readonly strength: number;
}

/**
 * A parametric cross-section of a ribbon at longitudinal parameter u in [0, 1].
 *
 * For any transverse parameter v in [-1, 1], the resting surface point is:
 *   R0(u, v) = C0(u) + v * h0(u) * N_span(u)
 * where v = +1 is the exact upper boundary U0(u), v = 0 is the centerline
 * C0(u), and v = -1 is the exact lower boundary L0(u).
 */
export interface RibbonSlice {
  /** Local longitudinal parameter u in [0, 1] within this ribbon. */
  readonly u: number;
  /** Global longitudinal parameter u_g in [0, 1] across the 1164-unit mark. */
  readonly uGlobal: number;
  /** Longitudinal x coordinate in viewBox space. */
  readonly x: number;
  /** Exact resting upper boundary point U0(u) (v = +1). */
  readonly upper0: Vec2;
  /** Exact resting lower boundary point L0(u) (v = -1). */
  readonly lower0: Vec2;
  /** Resting centerline point C0(u) = (U0(u) + L0(u)) / 2 (v = 0). */
  readonly center0: Vec2;
  /** Resting half-width h0(u) = ||U0(u) - L0(u)|| / 2. */
  readonly halfWidth0: number;
  /** Unit centerline tangent T(u) pointing in the direction of increasing u. */
  readonly tangent: Vec2;
  /** Unit normal N(u) perpendicular to T(u), oriented toward the upper rim (v = +1). */
  readonly normal: Vec2;
  /**
   * Unit-length liquid displacement normal: blends the local curve normal N(u)
   * with curvature/seam safety damping and normalizes to length 1.0 so steep
   * arms of the W retain full wave amplitude without horizontal self-intersection.
   */
  readonly liquidNormal: Vec2;
  /**
   * Topology & curvature damping factor in [0, 1].
   * Attenuates normal-horizontal folding at tight peaks (such as the x=367
   * acoustic spike) and overlap cut seams so the surface never self-intersects.
   */
  readonly curvatureDamping: number;
}

export interface BrandRibbonSurface {
  readonly id: RibbonId;
  /** Back-to-front painter's order: 0 = back-left, 1 = back-right, 2 = front-center arch. */
  readonly zOrder: number;
  readonly xMin: number;
  readonly xMax: number;
  /** Phase offset (radians) coupling this ribbon's wave to the global signal. */
  readonly phaseOffset: number;
  /** Exact source SVG upper contour vertices (ordered left-to-right, v = +1). */
  readonly upperContour: readonly Vec2[];
  /** Exact source SVG lower contour vertices (ordered left-to-right, v = -1). */
  readonly lowerContour: readonly Vec2[];
  /** Local u range [uStart, uEnd] where the upper contour is a true outer rim. */
  readonly upperRimRange: readonly [number, number];
  /** Local u range [uStart, uEnd] where the lower contour is a true outer rim. */
  readonly lowerRimRange: readonly [number, number];
  /** Regions where another ribbon crosses OVER this ribbon (receives soft shadow). */
  readonly occlusionZones: readonly LongitudinalZone[];
  /** Regions where this ribbon crosses OVER another ribbon (receives caustic lift). */
  readonly overpassZones: readonly LongitudinalZone[];
  /** Dense parametric slices containing all exact SVG vertices plus smooth subdivisions. */
  readonly slices: readonly RibbonSlice[];
}

// ---------------------------------------------------------------------------
// 1. Exact Closed Contour Vertices from whisperlane-brandmark-white.svg
// ---------------------------------------------------------------------------

/**
 * Ribbon Left (Subpath 3 in source SVG, x in [0, 451]):
 * Enters at the left needle tip (x=0, y=274..279), swells into the primary
 * acoustic lobe (x=175), rises to the tall signature peak at (367, 0), and
 * tucks beneath the ascending center ribbon along the cut (401, 397) -> (451, 250).
 */
const LEFT_UPPER_CONTOUR: readonly Vec2[] = [
  [0, 274],
  [4, 270],
  [34, 267],
  [58, 261],
  [86, 249],
  [103, 237],
  [122, 218],
  [148, 186],
  [163, 175],
  [175, 171],
  [187, 171],
  [196, 174],
  [208, 182],
  [221, 196],
  [240, 226],
  [257, 242],
  [270, 245],
  [281, 241],
  [291, 231],
  [296, 223],
  [309, 188],
  [339, 44],
  [348, 20],
  [356, 8],
  [367, 0],
  [377, 4],
  [383, 11],
  [395, 38],
  [404, 71],
  [407, 93],
  [413, 117],
  [416, 143],
  [431, 209],
  [440, 234],
  [451, 250],
];

const LEFT_LOWER_CONTOUR: readonly Vec2[] = [
  [0, 279],
  [7, 284],
  [49, 290],
  [72, 297],
  [92, 306],
  [108, 318],
  [146, 365],
  [162, 377],
  [176, 382],
  [197, 380],
  [212, 371],
  [227, 356],
  [251, 325],
  [272, 306],
  [287, 299],
  [296, 297],
  [313, 297],
  [323, 299],
  [348, 313],
  [370, 336],
  [384, 358],
  [396, 383],
  [399, 396],
  [401, 397],
  [422, 346],
  [451, 250],
];

/**
 * Ribbon Center (Subpath 1 in source SVG, x in [270, 710]):
 * Starts at the crescent tip of the first bottom trough (270, 408), curves
 * through the deep trough (406..428, 578), ascends in front of Ribbon Left's
 * descending fold, and forms the central arch (573..607, 168) that passes
 * over Ribbon Right's entry at (710, 299).
 */
const CENTER_UPPER_CONTOUR: readonly Vec2[] = [
  [270, 408],
  [291, 440],
  [307, 456],
  [325, 468],
  [343, 474],
  [359, 475],
  [369, 474],
  [385, 468],
  [394, 462],
  [405, 451],
  [423, 424],
  [432, 406],
  [456, 339],
  [462, 315],
  [465, 310],
  [471, 286],
  [474, 282],
  [480, 261],
  [495, 230],
  [513, 205],
  [526, 192],
  [541, 181],
  [554, 174],
  [573, 168],
  [607, 168],
  [626, 174],
  [646, 186],
  [667, 207],
  [683, 229],
  [698, 263],
  [710, 299],
];

const CENTER_LOWER_CONTOUR: readonly Vec2[] = [
  [270, 408],
  [286, 457],
  [306, 502],
  [329, 537],
  [346, 554],
  [358, 563],
  [377, 572],
  [406, 578],
  [428, 578],
  [445, 575],
  [468, 565],
  [480, 557],
  [500, 538],
  [510, 525],
  [533, 485],
  [551, 438],
  [581, 343],
  [599, 303],
  [610, 288],
  [628, 272],
  [643, 266],
  [661, 264],
  [671, 266],
  [685, 272],
  [699, 285],
  [710, 299],
];

/**
 * Ribbon Right (Subpath 2 in source SVG, x in [606, 1161]):
 * Emerges from beneath the central arch along (606, 362) .. (715, 315),
 * drops into the second bottom trough (751..774, 578), and sweeps upward
 * into the broad upper-right tail ending at (1160, 8) .. (1161, 130).
 */
const RIGHT_UPPER_CONTOUR: readonly Vec2[] = [
  [606, 362],
  [609, 351],
  [612, 347],
  [618, 329],
  [627, 313],
  [643, 298],
  [663, 291],
  [674, 291],
  [687, 294],
  [705, 304],
  [715, 315],
  [719, 323],
  [722, 336],
  [749, 407],
  [761, 424],
  [764, 424],
  [771, 412],
  [789, 367],
  [819, 270],
  [846, 200],
  [873, 150],
  [907, 106],
  [936, 79],
  [970, 55],
  [994, 42],
  [1022, 30],
  [1061, 18],
  [1091, 12],
  [1129, 8],
  [1160, 8],
  [1161, 8],
];

const RIGHT_LOWER_CONTOUR: readonly Vec2[] = [
  [606, 362],
  [636, 458],
  [651, 493],
  [669, 525],
  [687, 547],
  [698, 557],
  [717, 569],
  [733, 575],
  [751, 578],
  [774, 578],
  [801, 572],
  [819, 563],
  [832, 554],
  [850, 536],
  [863, 519],
  [875, 499],
  [893, 460],
  [917, 386],
  [923, 361],
  [926, 357],
  [932, 332],
  [948, 287],
  [966, 247],
  [983, 219],
  [1011, 186],
  [1029, 171],
  [1049, 158],
  [1067, 149],
  [1093, 140],
  [1122, 134],
  [1158, 132],
  [1161, 130],
];

// ---------------------------------------------------------------------------
// 2. Parametric Centerline, Normal & Slice Construction
// ---------------------------------------------------------------------------

/** Evaluates y(x) along a monotonically increasing polyline contour. */
function sampleContourY(contour: readonly Vec2[], x: number): number {
  const first = contour[0];
  if (x <= first[0]) return first[1];
  const last = contour[contour.length - 1];
  if (x >= last[0]) return last[1];

  let lo = 0;
  let hi = contour.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (contour[mid][0] <= x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p0 = contour[lo];
  const p1 = contour[hi];
  const span = p1[0] - p0[0];
  if (span <= 1e-6) return p0[1];
  const t = (x - p0[0]) / span;
  return p0[1] + (p1[1] - p0[1]) * t;
}

/**
 * Builds the sorted longitudinal x-grid containing every exact vertex from
 * both the upper and lower contours, subdivided where intervals exceed maxStep
 * so high-curvature wave deformation remains smooth.
 */
function buildLongitudinalGrid(
  upper: readonly Vec2[],
  lower: readonly Vec2[],
  maxStep = 10,
): number[] {
  const raw = new Set<number>();
  for (const [x] of upper) raw.add(x);
  for (const [x] of lower) raw.add(x);
  const sorted = Array.from(raw).sort((a, b) => a - b);

  const refined: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const x0 = sorted[i];
    const x1 = sorted[i + 1];
    refined.push(x0);
    const span = x1 - x0;
    if (span > maxStep) {
      const steps = Math.ceil(span / maxStep);
      for (let s = 1; s < steps; s++) {
        refined.push(x0 + (span * s) / steps);
      }
    }
  }
  refined.push(sorted[sorted.length - 1]);
  return refined;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildRibbonSlices(
  id: RibbonId,
  upper: readonly Vec2[],
  lower: readonly Vec2[],
): readonly RibbonSlice[] {
  const xs = buildLongitudinalGrid(upper, lower, 9);
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const xSpan = Math.max(1, xMax - xMin);

  const centers: Vec2[] = [];
  const uppers: Vec2[] = [];
  const lowers: Vec2[] = [];
  const halfWidths: number[] = [];

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    let yUp = sampleContourY(upper, x);
    let yLow = sampleContourY(lower, x);

    // At the far-left needle entry (x < 68), the source SVG tapers to 5 units
    // (0.3px at 64px width). A subtle optical minimum thickness keeps the
    // entry stem legible at 50-100px without altering the silhouette.
    if (id === "ribbon-left" && x < 68) {
      const mid = (yUp + yLow) * 0.5;
      const half = Math.max((yLow - yUp) * 0.5, 5.5);
      yUp = mid - half;
      yLow = mid + half;
    }

    const cY = (yUp + yLow) * 0.5;
    const h0 = Math.max(0, (yLow - yUp) * 0.5);

    uppers.push([x, yUp]);
    lowers.push([x, yLow]);
    centers.push([x, cY]);
    halfWidths.push(h0);
  }

  const rawNormals: Vec2[] = [];
  const rawTangents: Vec2[] = [];
  const dampings: number[] = [];

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const u = (x - xMin) / xSpan;

    const iPrev = Math.max(0, i - 3);
    const iNext = Math.min(xs.length - 1, i + 3);
    const dx = centers[iNext][0] - centers[iPrev][0];
    const dy = centers[iNext][1] - centers[iPrev][1];
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;

    const nx = ty;
    const ny = -tx;

    const endTaper =
      smoothstep(0, 0.14, u) * smoothstep(0, 0.14, 1 - u);
    const slopeDamping = 1 - 0.65 * Math.abs(ty);
    const curvatureDamping = endTaper * slopeDamping;

    rawTangents.push([tx, ty]);
    rawNormals.push([nx, ny]);
    dampings.push(curvatureDamping);
  }

  const slices: RibbonSlice[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const u = (x - xMin) / xSpan;
    const uGlobal = x / BRAND_VIEWBOX.width;

    // 5-point Gaussian-weighted smoothing of the horizontal normal component
    // so sharp vertex inflection points never cause adjacent slices to cross in x.
    let smoothNx = 0;
    let weightSum = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = Math.min(xs.length - 1, Math.max(0, i + k));
      const w = k === 0 ? 0.4 : Math.abs(k) === 1 ? 0.24 : 0.06;
      smoothNx += rawNormals[idx][0] * dampings[idx] * w;
      weightSum += w;
    }
    smoothNx /= weightSum;

    const [tx, ty] = rawTangents[i];
    const [nx, ny] = rawNormals[i];
    const curvatureDamping = dampings[i];

    const lnxRaw = smoothNx * 0.28;
    const lnyRaw = -Math.max(0.86, tx);
    const lLen = Math.hypot(lnxRaw, lnyRaw) || 1;
    const liquidNormal: Vec2 = [lnxRaw / lLen, lnyRaw / lLen];

    slices.push({
      u,
      uGlobal,
      x,
      upper0: uppers[i],
      lower0: lowers[i],
      center0: centers[i],
      halfWidth0: halfWidths[i],
      tangent: [tx, ty],
      normal: [nx, ny],
      liquidNormal,
      curvatureDamping,
    });
  }

  return slices;
}

/**
 * The three closed volumetric ribbon surfaces of the Whisperline brandmark,
 * ordered back-to-front (zOrder 0 -> 1 -> 2) so overlaps render with true
 * optical depth.
 */
export const BRAND_RIBBON_SURFACES: readonly BrandRibbonSurface[] = [
  {
    id: "ribbon-left",
    zOrder: 0,
    xMin: 0,
    xMax: 451,
    phaseOffset: 0.0,
    upperContour: LEFT_UPPER_CONTOUR,
    lowerContour: LEFT_LOWER_CONTOUR,
    upperRimRange: [0.02, 0.96],
    // Stop lower rim highlight before the overlap cut (401, 397) -> (451, 250)
    lowerRimRange: [0.02, 0.87],
    occlusionZones: [{ uStart: 0.82, uEnd: 1.0, strength: 0.62 }],
    overpassZones: [{ uStart: 0.34, uEnd: 0.84, strength: 0.35 }],
    slices: buildRibbonSlices("ribbon-left", LEFT_UPPER_CONTOUR, LEFT_LOWER_CONTOUR),
  },
  {
    id: "ribbon-right",
    zOrder: 1,
    xMin: 606,
    xMax: 1161,
    phaseOffset: 0.12,
    upperContour: RIGHT_UPPER_CONTOUR,
    lowerContour: RIGHT_LOWER_CONTOUR,
    // Start upper rim highlight after the under-arch entry seam (606..715)
    upperRimRange: [0.21, 0.98],
    lowerRimRange: [0.06, 0.98],
    occlusionZones: [{ uStart: 0.0, uEnd: 0.24, strength: 0.68 }],
    overpassZones: [{ uStart: 0.38, uEnd: 0.92, strength: 0.4 }],
    slices: buildRibbonSlices("ribbon-right", RIGHT_UPPER_CONTOUR, RIGHT_LOWER_CONTOUR),
  },
  {
    id: "ribbon-center",
    zOrder: 2,
    xMin: 270,
    xMax: 710,
    phaseOffset: 0.06,
    upperContour: CENTER_UPPER_CONTOUR,
    lowerContour: CENTER_LOWER_CONTOUR,
    upperRimRange: [0.04, 0.96],
    lowerRimRange: [0.04, 0.96],
    occlusionZones: [],
    // Foreground ribbon crosses over ribbon-left (u ~ 0.32..0.52) and ribbon-right (u ~ 0.72..0.98)
    overpassZones: [
      { uStart: 0.3, uEnd: 0.56, strength: 0.52 },
      { uStart: 0.7, uEnd: 0.98, strength: 0.56 },
    ],
    slices: buildRibbonSlices(
      "ribbon-center",
      CENTER_UPPER_CONTOUR,
      CENTER_LOWER_CONTOUR,
    ),
  },
];
