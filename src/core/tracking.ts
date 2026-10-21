/**
 * Motion tracking: follow a small patch of the picture from frame to frame
 * (block matching on luminance), so a sticker or text can stick to a moving
 * object.
 */
import type { Keyframe, Transform } from "./types";
import type { SampleFrame } from "./reframe";

export interface TrackPoint {
  /** Source seconds. */
  t: number;
  /** Patch centre, 0..1 of the frame. */
  x: number;
  y: number;
  /** Match quality 0..1 (1 = identical patch). */
  confidence: number;
}

function luma(f: SampleFrame): Float32Array {
  const out = new Float32Array(f.width * f.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 3) out[i] = 0.299 * f.rgb[p] + 0.587 * f.rgb[p + 1] + 0.114 * f.rgb[p + 2];
  return out;
}

/**
 * Track the patch centred at (x0, y0) (0..1) through the frames. `patch` is
 * the half-size in pixels of the sample frames, `search` how far it may move
 * between two frames.
 */
export function trackPoint(frames: SampleFrame[], x0: number, y0: number, patch = 4, search = 6): TrackPoint[] {
  if (!frames.length) return [];
  const { width: w, height: h } = frames[0];
  const clampC = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let cx = clampC(Math.round(x0 * w), patch, w - patch - 1);
  let cy = clampC(Math.round(y0 * h), patch, h - patch - 1);
  const lums = frames.map(luma);
  // Template from the first frame; refreshed when the match is good, so slow
  // changes (lighting, rotation) don't lose the object.
  const grab = (L: Float32Array, x: number, y: number) => {
    const t = new Float32Array((2 * patch + 1) ** 2);
    let k = 0;
    for (let dy = -patch; dy <= patch; dy++) for (let dx = -patch; dx <= patch; dx++) t[k++] = L[(y + dy) * w + (x + dx)];
    return t;
  };
  let tpl = grab(lums[0], cx, cy);
  const out: TrackPoint[] = [{ t: frames[0].t, x: cx / w, y: cy / h, confidence: 1 }];
  for (let i = 1; i < frames.length; i++) {
    const L = lums[i];
    let best = Infinity;
    let bx = cx;
    let by = cy;
    for (let sy = -search; sy <= search; sy++) {
      for (let sx = -search; sx <= search; sx++) {
        const x = cx + sx;
        const y = cy + sy;
        if (x < patch || y < patch || x >= w - patch || y >= h - patch) continue;
        let sad = 0;
        let k = 0;
        for (let dy = -patch; dy <= patch && sad < best; dy++) for (let dx = -patch; dx <= patch; dx++) sad += Math.abs(L[(y + dy) * w + (x + dx)] - tpl[k++]);
        // Slight preference for small moves breaks ties on flat areas.
        sad += (Math.abs(sx) + Math.abs(sy)) * 0.5;
        if (sad < best) {
          best = sad;
          bx = x;
          by = y;
        }
      }
    }
    const confidence = Math.max(0, 1 - best / (tpl.length * 40));
    cx = bx;
    cy = by;
    if (confidence > 0.6) tpl = grab(L, cx, cy);
    out.push({ t: frames[i].t, x: cx / w, y: cy / h, confidence });
  }
  return out;
}

/**
 * Keyframes that move an overlay with the tracked point. The overlay keeps its
 * offset from the object; times are relative to the overlay clip, whose
 * start lines up with source time `sourceAtOverlayStart` of the tracked clip.
 */
export function followKeyframes(
  track: TrackPoint[],
  base: Transform,
  sourceAtOverlayStart: number,
  overlayDuration: number,
  speed = 1,
  step = 2
): Keyframe[] {
  if (!track.length) return [];
  const dx = base.x - track[0].x;
  const dy = base.y - track[0].y;
  const keys: Keyframe[] = [];
  for (let i = 0; i < track.length; i += step) {
    const p = track[i];
    const t = (p.t - sourceAtOverlayStart) / speed;
    if (t < -1e-6 || t > overlayDuration + 1e-6) continue;
    keys.push({ ...base, t: Math.max(0, Math.round(t * 1000) / 1000), x: p.x + dx, y: p.y + dy });
  }
  const last = track[track.length - 1];
  const tl = (last.t - sourceAtOverlayStart) / speed;
  if (tl <= overlayDuration && keys[keys.length - 1]?.t !== Math.round(tl * 1000) / 1000) keys.push({ ...base, t: Math.round(tl * 1000) / 1000, x: last.x + dx, y: last.y + dy });
  return keys;
}
