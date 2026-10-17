// The settings window's background: our own waveform, moving slowly
// behind the content.
//
// It is the pill's signal without the pill's job. Same four additive
// ribbons, same gradients, same bell envelope — the shape the product is
// recognised by — run from a prepared loop of a voice rather than from a
// live microphone, and drawn as a field behind a form rather than as the
// only thing on screen.
//
// Three things make it a background rather than an effect:
//
//   - Nothing here listens. The loop is baked once, at load, so opening
//     settings does not open the microphone and does not light the
//     operating system's recording indicator. That was the reason the live
//     signal was not used, and it is the reason this can exist at all.
//   - It is a closed loop by construction, not by tuning. Every partial
//     is an integer harmonic of the loop, so the last frame is the first
//     frame and there is no seam to wait for.
//   - It is masked and faint, because a window people read is not a
//     window people watch. Where the small text sits, the wave is drawn
//     least.
//
// Reduced motion stops it. The field then holds one frame, which is the
// same picture minus the movement — so the window looks finished either
// way rather than looking broken on the setting.

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface Ribbon {
  colorStart: string;
  colorEnd: string;
  freq: number;
  phase: number;
  ampMultiplier: number;
}

/**
 * A closing loop of a speaking voice, baked once.
 *
 * Built from integer harmonics of the loop rather than from recorded
 * syllables, because an integer harmonic returns to where it started by
 * construction: sampling the finished array end to start is the same
 * motion as sampling it through the middle. A syllable envelope built by
 * hand would need a cross-fade at the join, and the join is exactly where
 * a loop announces itself.
 */
function bakedVoice(): number[] {
  let seed = 20261017;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  // One strong low partial carries the syllabic pulse; the rest fill in
  // the texture. Weighted by 1/k so the voice has a low end.
  const partials = Array.from({ length: 11 }, (_, i) => ({
    k: i + 1,
    phase: rand() * Math.PI * 2,
    amp: ((i + 1) % 3 === 0 ? 0.5 : 1) / (i + 1) * (0.55 + rand() * 0.7),
  }));

  const count = 512;
  const out = new Array<number>(count);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    let v = 0;
    for (const p of partials) v += Math.sin(t * p.k + p.phase) * p.amp;
    out[i] = v;
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  const span = Math.max(high - low, 1e-6);
  for (let i = 0; i < count; i++) {
    // Never to zero: a voice breathes at a floor, and a wave that touches
    // the centre line reads as a fault rather than as a pause.
    out[i] = 0.22 + 0.78 * ((out[i] - low) / span);
  }
  return out;
}

const VOICE = bakedVoice();

/** Samples of the loop one complete turn of phase away from itself. */
const LOOP_SAMPLES = VOICE.length;
/**
 * How far the ribbons' phase travels in one loop.
 *
 * Each ribbon is a sum of a term advancing at `t` and one advancing at
 * `0.6t`. A loop needs `t` to advance a whole number of turns for the
 * first and `0.6t` to advance a whole number of turns for the second:
 * 10π is five turns of the first and three of the second, so both land
 * home together. No smaller value closes both.
 */
const LOOP_TURN = Math.PI * 10;
/** A flatter bell than the pill's, so the field reaches both edges. */
const ENVELOPE_EXPONENT = 0.5;

const RIBBONS: Ribbon[] = [
  {
    colorStart: "rgba(244, 63, 94, 0.85)",
    colorEnd: "rgba(168, 85, 247, 0.85)",
    freq: 1.4,
    phase: 0,
    ampMultiplier: 1,
  },
  {
    colorStart: "rgba(56, 189, 248, 0.8)",
    colorEnd: "rgba(99, 102, 241, 0.8)",
    freq: 2.1,
    phase: 2.1,
    ampMultiplier: 0.86,
  },
  {
    colorStart: "rgba(192, 132, 252, 0.7)",
    colorEnd: "rgba(45, 212, 191, 0.7)",
    freq: 2.9,
    phase: 4.2,
    ampMultiplier: 0.7,
  },
  {
    colorStart: "rgba(251, 191, 36, 0.5)",
    colorEnd: "rgba(244, 63, 94, 0.5)",
    freq: 1.1,
    phase: 5.6,
    ampMultiplier: 0.55,
  },
];

export function SignalBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = canvas.clientWidth || 560;
    let height = canvas.clientHeight || 760;
    const dpr = window.devicePixelRatio || 1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Every number that decides what this looks like is a custom property
    // rather than a constant, so it can be moved while looking at it. A
    // backdrop's whole difficulty is that the right value for it is found
    // by eye, against a real window, with the real text on it.
    const tuning = { alpha: 0.32, seconds: 18, center: 0.58, spread: 0.13, scale: 0.11 };
    const readTuning = () => {
      const style = getComputedStyle(canvas);
      const read = (name: string, key: keyof typeof tuning, fallback: number) => {
        const parsed = parseFloat(style.getPropertyValue(name));
        if (Number.isFinite(parsed)) tuning[key] = parsed;
        else tuning[key] = fallback;
      };
      read("--signal-alpha", "alpha", 0.32);
      read("--signal-loop", "seconds", 18);
      read("--signal-center", "center", 0.58);
      read("--signal-spread", "spread", 0.13);
      read("--signal-scale", "scale", 0.11);
    };
    readTuning();

    const draw = (progress: number) => {
      const t = progress * LOOP_TURN;
      // Sampled with a wrap, so the last frame and the first are the same
      // picture rather than two pictures that happen to be near each other.
      const voiceAt = (p: number) => {
        const position = p * LOOP_SAMPLES;
        const i = Math.floor(position) % LOOP_SAMPLES;
        const j = (i + 1) % LOOP_SAMPLES;
        const f = position - Math.floor(position);
        return VOICE[i] * (1 - f) + VOICE[j] * f;
      };
      const amp = voiceAt(progress);

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = tuning.alpha;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const centerY = height * tuning.center;
      // A field rather than a line: the ribbons sit far apart vertically
      // so the motion fills the surface instead of crossing it.
      const spread = height * tuning.spread;
      // Displacement grows with the surface but is capped, so a taller
      // window does not turn the wave into a slow ocean swell.
      const scale = Math.min(width * tuning.scale, height * 0.06, 66);

      RIBBONS.forEach((ribbon, index) => {
        const bandY = centerY + (index - (RIBBONS.length - 1) / 2) * spread;
        const amplitude = amp * ribbon.ampMultiplier;

        const path = new Path2D();
        for (let x = 0; x <= width; x += 4) {
          const y = bandY + displacement(x, width, scale, ribbon, t, amplitude);
          if (x === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
        gradient.addColorStop(0.18, ribbon.colorStart);
        gradient.addColorStop(0.82, ribbon.colorEnd);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.strokeStyle = gradient;

        // Two passes, because one line of light is a line of light and a
        // band of it is something else. The wide blurred pass is the glow
        // the field is made of; the narrow one is the edge of it that the
        // eye reads as a moving shape rather than as haze.
        ctx.filter = `blur(${Math.round(spread * 0.62)}px)`;
        ctx.lineWidth = spread * 1.5;
        ctx.stroke(path);

        ctx.filter = `blur(${Math.round(spread * 0.18)}px)`;
        ctx.lineWidth = spread * 0.3;
        ctx.stroke(path);

        ctx.filter = "none";
      });

      ctx.restore();
    };

    const resize = () => {
      width = canvas.clientWidth || width;
      height = canvas.clientHeight || height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Re-read on resize as well as on mount: a custom property edited
      // in the inspector only reaches the canvas the next time something
      // asks it to measure itself.
      readTuning();
      if (reduced) draw(0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    if (reduced) {
      // One frame, held. The window must look like a finished window
      // whether or not the movement is wanted.
      draw(0);
      return () => observer.disconnect();
    }

    let frame = 0;
    let running = false;
    const started = performance.now();
    const render = (now: number) => {
      const elapsed = (now - started) / 1000;
      draw((elapsed % tuning.seconds) / tuning.seconds);
      frame = requestAnimationFrame(render);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      running = false;
    };
    const start = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(render);
    };

    // The window is hidden for nearly all of the application's life, and a
    // full-surface blurred animation drawn through all of that is a cost
    // paid for a picture nobody is looking at. The core says when the
    // window leaves the screen and when it comes back.
    const offVisibility = listen<boolean>("window-visibility", (event) => {
      if (event.payload) start();
      else stop();
    });
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A second way in, because the first one depends on every show going
    // through the core's own command. Focus is the other way a window can
    // arrive on screen, and it costs one listener to stop a missed show
    // from leaving the field permanently still.
    window.addEventListener("focus", start);

    // The window may already be on screen when this mounts, in which case
    // the event that would have started it has not happened yet.
    invoke<boolean>("is_settings_visible")
      .then((visible) => {
        if (visible) start();
      })
      .catch(() => {});

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", start);
      void offVisibility.then((unlisten) => unlisten());
    };
  }, []);

  return <canvas ref={canvasRef} className="signal-backdrop" aria-hidden="true" />;
}

/**
 * One ribbon's distance from its band, at one point across.
 *
 * The same two-term sum as the pill's, because the same shape is what
 * makes it recognisable; only the envelope is gentler, so a field of them
 * still reaches the edges of a window that the pill's ribbon does not.
 */
function displacement(
  x: number,
  width: number,
  scale: number,
  ribbon: Ribbon,
  t: number,
  amp: number,
): number {
  const normX = x / width;
  const envelope = Math.pow(Math.sin(normX * Math.PI), ENVELOPE_EXPONENT);
  const wave =
    Math.sin(normX * Math.PI * 2 * ribbon.freq + t) * 0.7 +
    Math.cos(normX * Math.PI * 4 * ribbon.freq - t * 0.6) * 0.3;
  return wave * envelope * amp * scale * ribbon.ampMultiplier;
}