// The live waveform in the pill: a single speaking motion rather than
// a row of bars that only says "something is happening". This is the
// listening face only; every resting and waiting face is the brand wave
// (BrandWave.tsx).
//
// Two decisions shape this file. The level is smoothed with an
// asymmetric attack and release, because a meter that falls as fast as
// it rises flickers and a meter that rises as slowly as it falls never
// acknowledges a word. And the level is held in a ref rather than
// state, so a new reading every forty milliseconds does not restart the
// animation loop and reset the smoothing it is feeding.

import { useEffect, useRef } from "react";

interface LiquidWaveformProps {
  /** Normalised microphone level, 0.0 to 1.0. */
  audioLevel: number;
  width?: number;
  height?: number;
}

interface WaveRibbon {
  colorStart: string;
  colorEnd: string;
  freq: number;
  speed: number;
  phase: number;
  ampMultiplier: number;
}

/**
 * Four ribbons, drawn additively: where they cross they sum, which is
 * what produces the bright core in the middle without drawing one.
 * The fourth is faint and slow, so the ribbon never settles into a
 * recognisable repeating shape.
 */
const RIBBONS: WaveRibbon[] = [
  {
    colorStart: "rgba(244, 63, 94, 0.90)",
    colorEnd: "rgba(168, 85, 247, 0.90)",
    freq: 1.8,
    speed: 0.065,
    phase: 0,
    ampMultiplier: 1.0,
  },
  {
    colorStart: "rgba(56, 189, 248, 0.90)",
    colorEnd: "rgba(99, 102, 241, 0.90)",
    freq: 2.4,
    speed: -0.05,
    phase: 1.5,
    ampMultiplier: 0.9,
  },
  {
    colorStart: "rgba(192, 132, 252, 0.80)",
    colorEnd: "rgba(45, 212, 191, 0.80)",
    freq: 3.1,
    speed: 0.08,
    phase: 3.1,
    ampMultiplier: 0.78,
  },
  {
    colorStart: "rgba(251, 191, 36, 0.65)",
    colorEnd: "rgba(244, 63, 94, 0.65)",
    freq: 1.3,
    speed: 0.04,
    phase: 4.7,
    ampMultiplier: 0.65,
  },
];

/**
 * How far the raw level is pushed so ordinary speech uses the range.
 *
 * The core already normalises against a full-meter reference measured on
 * a real microphone — an ordinary voice lands between a third and two
 * thirds of it — so this lift is what carries a normal syllable from a
 * token ripple to a wave that reads as speech. Raise it if the wave
 * still reads flat, lower it if it sits pinned.
 */
const LEVEL_GAIN = 2.6;
/** Rise quickly, fall slowly. See the note at the top of the file. */
const ATTACK = 0.35;
const RELEASE = 0.08;
/** The floor a live take breathes at, so silence is calm, not dead. */
const IDLE_BREATH = 0.24;
/** How much of the canvas's half-height the wave is allowed to use. */
const SWING = 1.4;

export function LiquidWaveform({
  audioLevel,
  width = 160,
  // Tall enough that an ordinary voice visibly moves the ribbon rather
  // than rippling the centre line. The pill has no vertical padding, so
  // this still sits inside its height.
  height = 44,
}: LiquidWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef(0);
  const timeRef = useRef(0);
  const levelRef = useRef(audioLevel);
  levelRef.current = audioLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let frame = 0;
    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const centerY = height / 2;

      // Asymmetric smoothing. The target is read from a ref so this
      // loop keeps its own pace instead of restarting on every reading.
      const target = Math.min(1, levelRef.current * LEVEL_GAIN);
      const rate = target > smoothedRef.current ? ATTACK : RELEASE;
      smoothedRef.current += (target - smoothedRef.current) * rate;

      if (!reducedMotion) {
        timeRef.current += 1;
      }

      // A live take breathes even in silence, so the pill never looks
      // switched off mid-sentence.
      const effectiveAmp = Math.max(IDLE_BREATH, smoothedRef.current);
      drawRibbons(ctx, width, centerY, height, effectiveAmp, timeRef.current);

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pill-waveform"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: "block",
        filter:
          "drop-shadow(0 0 8px rgba(168, 85, 247, 0.55)) drop-shadow(0 0 16px rgba(56, 189, 248, 0.35))",
      }}
    />
  );
}

/** The speaking face: four additive ribbons and a bright centre line. */
function drawRibbons(
  ctx: CanvasRenderingContext2D,
  width: number,
  centerY: number,
  height: number,
  amp: number,
  time: number,
) {
  ctx.save();
  // Additive: the ribbons sum where they overlap, which is what forms
  // the bright core without drawing one.
  ctx.globalCompositeOperation = "lighter";
  const maxRadius = (height / 2) * SWING;

  for (const ribbon of RIBBONS) {
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, "rgba(0, 0, 0, 0)");
    grad.addColorStop(0.2, ribbon.colorStart);
    grad.addColorStop(0.8, ribbon.colorEnd);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;

    const t = time * ribbon.speed + ribbon.phase;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    for (let x = 0; x <= width; x += 2) {
      ctx.lineTo(x, centerY + offset(x, width, ribbon, t, amp, maxRadius, false));
    }
    for (let x = width; x >= 0; x -= 2) {
      ctx.lineTo(x, centerY + offset(x, width, ribbon, t, amp, maxRadius, true));
    }
    ctx.closePath();
    ctx.fill();
  }

  const core = ctx.createLinearGradient(0, 0, width, 0);
  core.addColorStop(0, "rgba(255, 255, 255, 0)");
  core.addColorStop(0.5, `rgba(255, 255, 255, ${0.35 + amp * 0.5})`);
  core.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, centerY - 0.5, width, 1);
  ctx.restore();
}

/**
 * How far one ribbon sits from the centre line at a given x.
 *
 * The bell envelope is what makes it read as a ribbon rather than as a
 * sawtooth: a wave that runs edge to edge looks like a graph, while one
 * that swells in the middle and dies at both ends looks like something
 * with a body.
 */
function offset(
  x: number,
  width: number,
  ribbon: WaveRibbon,
  t: number,
  amp: number,
  maxRadius: number,
  closing: boolean,
): number {
  const normX = x / width;
  const envelope = Math.pow(Math.sin(normX * Math.PI), 1.6);
  const wave = closing
    ? Math.sin(normX * Math.PI * 2 * ribbon.freq + t + 0.6) * 0.65 +
      Math.sin(normX * Math.PI * 3 * ribbon.freq - t * 0.4) * 0.35
    : Math.sin(normX * Math.PI * 2 * ribbon.freq + t) * 0.7 +
      Math.cos(normX * Math.PI * 4 * ribbon.freq - t * 0.6) * 0.3;
  const direction = closing ? -0.85 : 1;
  return (
    wave * envelope * amp * maxRadius * ribbon.ampMultiplier * direction
  );
}
