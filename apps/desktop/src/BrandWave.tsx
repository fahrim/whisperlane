// State-facing entry component for the Whisperline volumetric brand ribbon.
//
// Architectural separation of concerns:
//   - brandmarkGeometry.ts: Exact closed ribbon contours, centerline C0(u),
//     normal N(u), half-width h0(u), and overlap/rim metadata from
//     whisperlane-brandmark-white.svg.
//   - RibbonDeformer.ts: Parametric (u, v) surface deformation R(u, v, t),
//     width modulation h(u, t), internal chromatic film waves, and state profiles.
//   - BrandRibbonRenderer.tsx: High-DPI multi-layer volumetric rendering
//     (Ribbon Body, Volumetric Glow, Internal Specular Highlight, Edge
//     Highlight, and Layer Overlap occlusion/caustics).
//   - BrandWave.tsx: State & sizing coordination for the pill surface.

import { BrandRibbonRenderer } from "./BrandRibbonRenderer";
import type { BrandWaveState } from "./RibbonDeformer";

export type { BrandWaveState };

export interface BrandWaveProps {
  state: BrandWaveState;
  width?: number;
}

export function BrandWave({ state, width = 78 }: BrandWaveProps) {
  return <BrandRibbonRenderer state={state} width={width} />;
}
