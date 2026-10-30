// State-facing entry component for the Whisperline volumetric brand ribbon.
//
// Architectural separation of concerns:
//   - brandmarkGeometry.ts: Exact closed ribbon contours, centerline C0(u),
//     normal N(u), liquidNormal, half-width h0(u), and overlap/rim metadata
//     from whisperlane-brandmark-white.svg.
//   - RibbonDeformer.ts: Parametric (u, v) horizontal 3-wave surface deformation
//     R(u, v, t), width breathing h(u, t), internal chromatic film waves, and
//     state profiles (plus selectable static mode & DEV tuning config).
//   - BrandRibbonRenderer.tsx: High-DPI multi-layer volumetric rendering
//     (Ribbon Body, Volumetric Glow, Internal Specular Highlight, Edge
//     Highlight, and Layer Overlap occlusion/caustics).
//   - BrandWave.tsx: State, sizing, and motion-mode coordination for the pill.

import { BrandRibbonRenderer } from "./BrandRibbonRenderer";
import type {
  BrandRibbonMotionMode,
  BrandWaveState,
  RibbonTuningConfig,
} from "./RibbonDeformer";

export type { BrandRibbonMotionMode, BrandWaveState };

export interface BrandWaveProps {
  state: BrandWaveState;
  width?: number;
  /**
   * "animated" (default) enables the organic liquid wave motion;
   * "static" preserves the resting volumetric brandmark without deformation.
   */
  motionMode?: BrandRibbonMotionMode;
  /** Optional explicit tuning configuration override. */
  tuningConfig?: RibbonTuningConfig;
  /** Optional counter to replay one-shot animations like the "done" settling pulse. */
  replayNonce?: number;
}

export function BrandWave({
  state,
  width = 78,
  motionMode = "animated",
  tuningConfig,
  replayNonce,
}: BrandWaveProps) {
  return (
    <BrandRibbonRenderer
      state={state}
      width={width}
      motionMode={motionMode}
      tuningConfig={tuningConfig}
      replayNonce={replayNonce}
    />
  );
}
