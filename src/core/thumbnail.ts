/** Thumbnail maker helpers: pick an eye-catching frame and lay out the text. */
import type { SampleFrame } from "./reframe";

/**
 * How good a frame is as a thumbnail: sharp (edge energy), colourful and
 * neither too dark nor blown out.
 */
export function frameScore(f: SampleFrame): number {
  const { width: w, height: h, rgb } = f;
  let edge = 0;
  let sat = 0;
  let lum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 3;
      const l = (q: number) => 0.299 * rgb[q] + 0.587 * rgb[q + 1] + 0.114 * rgb[q + 2];
      const c = l(i);
      edge += Math.abs(4 * c - l(i - 3) - l(i + 3) - l(i - w * 3) - l(i + w * 3));
      const mx = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
      const mn = Math.min(rgb[i], rgb[i + 1], rgb[i + 2]);
      sat += mx - mn;
      lum += c;
      n++;
    }
  }
  if (!n) return 0;
  const meanLum = lum / n;
  const exposure = 1 - Math.min(1, Math.abs(meanLum - 120) / 120);
  return (edge / n) * 1.0 + (sat / n) * 0.4 + exposure * 25;
}

/** Index of the best frame, ignoring the very start and end (fades, blinks). */
export function bestFrame(frames: SampleFrame[]): number {
  if (!frames.length) return -1;
  const skip = frames.length > 6 ? 1 : 0;
  let best = skip;
  let score = -Infinity;
  for (let i = skip; i < frames.length - skip; i++) {
    const s = frameScore(frames[i]);
    if (s > score) {
      score = s;
      best = i;
    }
  }
  return best;
}

export type ThumbLayout = "left" | "right" | "center" | "bottom";

export const THUMB_LAYOUTS: { id: ThumbLayout; name: string }[] = [
  { id: "left", name: "Text left" },
  { id: "right", name: "Text right" },
  { id: "center", name: "Big centre" },
  { id: "bottom", name: "Bottom bar" },
];

/** Break text into at most `maxLines` lines of roughly even length. */
export function wrapWords(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
