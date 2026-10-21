import type { MediaAsset, MediaClip, ProjectSettings } from "./types";

/**
 * How a clip fills a canvas with a different shape (e.g. 16:9 footage in a
 * 9:16 project):
 * - fit:  whole picture visible, black bars
 * - fill: crop to fill the frame, following the clip's focus point
 * - blur: whole picture over a blurred, zoomed copy of itself
 */
export type FitMode = "fit" | "fill" | "blur";

export const FIT_MODES: { id: FitMode; label: string; hint: string }[] = [
  { id: "fill", label: "Fill", hint: "Crop to fill the frame (follows the subject after Smart reframe)" },
  { id: "blur", label: "Blur bg", hint: "Show the whole picture over a blurred copy of itself" },
  { id: "fit", label: "Fit", hint: "Show the whole picture with black bars" },
];

/** A point the crop should be centred on, in source time. */
export interface FocusPoint {
  /** Source seconds (so trimming or splitting the clip keeps the path valid). */
  t: number;
  /** Centre of interest, 0..1 of the source picture. */
  x: number;
  y: number;
}

export function clipFit(c: MediaClip, s: ProjectSettings): FitMode {
  return c.fit ?? s.fit ?? "fill";
}

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Media scaled to cover W×H (even dimensions). Unknown size → canvas size. */
export function coverSize(aw: number | undefined, ah: number | undefined, W: number, H: number) {
  if (!aw || !ah) return { w: W, h: H };
  const k = Math.max(W / aw, H / ah);
  return { w: Math.max(W, even(aw * k)), h: Math.max(H, even(ah * k)) };
}

/**
 * Piecewise-linear ffmpeg expression for one focus axis over source time `src`
 * (an expression string). Holds the first/last value outside the range.
 */
export function focusExpr(points: FocusPoint[], axis: "x" | "y", src: string): string {
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (!pts.length) return "0.5";
  let expr = n(pts[pts.length - 1][axis]);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i];
    const b = pts[i + 1];
    const span = Math.max(1e-3, b.t - a.t);
    const seg = a[axis] === b[axis] ? n(a[axis]) : `${n(a[axis])}+(${n(b[axis] - a[axis])})*(${src}-${n(a.t)})/${n(span)}`;
    expr = `if(lt(${src}\\,${n(b.t)})\\,${seg}\\,${expr})`;
  }
  return `if(lt(${src}\\,${n(pts[0].t)})\\,${n(pts[0][axis])}\\,${expr})`;
}

/** Focus at a source time (linear between points). */
export function focusAt(points: FocusPoint[] | undefined, src: number): { x: number; y: number } {
  if (!points?.length) return { x: 0.5, y: 0.5 };
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (src <= pts[0].t) return { x: pts[0].x, y: pts[0].y };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (src <= b.t) {
      const k = (src - a.t) / Math.max(1e-6, b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

/** Crop W×H out of the covered picture, centred on the focus (clamped to the edges). */
function cropFilter(c: MediaClip, W: number, H: number): string {
  const src = `(${n(c.in)}+t*${n(c.speed)})`;
  const pts = c.focus?.length ? c.focus : [{ t: 0, x: 0.5, y: 0.5 }];
  const fx = focusExpr(pts, "x", src);
  const fy = focusExpr(pts, "y", src);
  return `crop=${W}:${H}:x='clip(iw*(${fx})-ow/2\\,0\\,iw-ow)':y='clip(ih*(${fy})-oh/2\\,0\\,ih-oh)'`;
}

/**
 * Filter-graph fragment that turns the trimmed clip (`[inLabel]`) into a W×H
 * frame (`[outLabel]`) for the chosen fit mode.
 */
export function reframeGraph(c: MediaClip, asset: Pick<MediaAsset, "width" | "height">, W: number, H: number, mode: FitMode, inLabel: string, outLabel: string): string {
  const cover = coverSize(asset.width, asset.height, W, H);
  if (mode === "fill") {
    return `[${inLabel}]scale=${cover.w}:${cover.h},${cropFilter(c, W, H)},setsar=1[${outLabel}]`;
  }
  if (mode === "blur") {
    // Blur at a quarter size: much faster and just as soft.
    const bw = even(W / 4);
    const bh = even(H / 4);
    return [
      `[${inLabel}]split[${outLabel}_a][${outLabel}_b]`,
      `[${outLabel}_a]scale=${cover.w}:${cover.h},${cropFilter(c, W, H)},scale=${bw}:${bh},boxblur=10:2,eq=brightness=-0.08:saturation=1.1,scale=${W}:${H},setsar=1[${outLabel}_bg]`,
      `[${outLabel}_b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[${outLabel}_fg]`,
      `[${outLabel}_bg][${outLabel}_fg]overlay=(W-w)/2:(H-h)/2[${outLabel}]`,
    ].join(";");
  }
  return `[${inLabel}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outLabel}]`;
}

/** True when the media's shape differs enough from the canvas for fit to matter. */
export function needsReframe(aw: number | undefined, ah: number | undefined, W: number, H: number) {
  if (!aw || !ah) return false;
  return Math.abs(aw / ah - W / H) / (W / H) > 0.02;
}

/** Preview: CSS object-position (percent) that matches the export crop. */
export function objectPosition(aw: number | undefined, ah: number | undefined, W: number, H: number, focus: { x: number; y: number }) {
  const cover = coverSize(aw, ah, W, H);
  const pos = (f: number, size: number, frame: number) => (size <= frame ? 50 : Math.min(100, Math.max(0, ((f * size - frame / 2) / (size - frame)) * 100)));
  return `${pos(focus.x, cover.w, W)}% ${pos(focus.y, cover.h, H)}%`;
}

// ---------------------------------------------------------------- tracking

/** A small RGB frame sampled from the clip (row-major, 3 bytes per pixel). */
export interface SampleFrame {
  /** Source seconds. */
  t: number;
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Rough skin-tone test (works across a wide range of skin tones). */
export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/**
 * Where the subject is in each frame: a weighted centroid of skin-coloured and
 * moving pixels. Frames with no clear subject keep the previous position.
 */
export function locateSubject(frames: SampleFrame[]): FocusPoint[] {
  const out: FocusPoint[] = [];
  let prev: Float32Array | undefined;
  let last = { x: 0.5, y: 0.45 };
  for (const f of frames) {
    const { width: w, height: h, rgb } = f;
    const lum = new Float32Array(w * h);
    let sum = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0, p = 0; i < w * h; i++, p += 3) {
      const r = rgb[p];
      const g = rgb[p + 1];
      const b = rgb[p + 2];
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      let wgt = isSkin(r, g, b) ? 1 : 0;
      if (prev) {
        const d = Math.abs(lum[i] - prev[i]);
        if (d > 18) wgt += Math.min(1, d / 80) * 0.6;
      }
      if (!wgt) continue;
      const x = (i % w) + 0.5;
      const y = Math.floor(i / w) + 0.5;
      sum += wgt;
      sx += wgt * x;
      sy += wgt * y;
    }
    prev = lum;
    // Need a meaningful blob (≥ 0.5% of the frame) to trust the result.
    if (sum > w * h * 0.005) last = { x: sx / sum / w, y: sy / sum / h };
    out.push({ t: f.t, ...last });
  }
  return out;
}

/**
 * Turn noisy per-frame positions into a calm camera path: median filter,
 * smoothing, then only keep points where the camera really needs to move.
 */
export function smoothPath(raw: FocusPoint[], deadzone = 0.06): FocusPoint[] {
  if (raw.length <= 2) return raw.map((p) => ({ ...p }));
  const med = (vals: number[]) => [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  const filtered = raw.map((p, i) => {
    const win = raw.slice(Math.max(0, i - 2), i + 3);
    return { t: p.t, x: med(win.map((q) => q.x)), y: med(win.map((q) => q.y)) };
  });
  // Exponential smoothing forwards then backwards (no lag).
  const a = 0.35;
  const sm = filtered.map((p) => ({ ...p }));
  for (let i = 1; i < sm.length; i++) {
    sm[i].x = sm[i - 1].x + a * (sm[i].x - sm[i - 1].x);
    sm[i].y = sm[i - 1].y + a * (sm[i].y - sm[i - 1].y);
  }
  for (let i = sm.length - 2; i >= 0; i--) {
    sm[i].x = sm[i + 1].x + a * (sm[i].x - sm[i + 1].x);
    sm[i].y = sm[i + 1].y + a * (sm[i].y - sm[i + 1].y);
  }
  // Keep a point only when the subject has moved past the deadzone.
  const keep: FocusPoint[] = [round(sm[0])];
  for (let i = 1; i < sm.length - 1; i++) {
    const k = keep[keep.length - 1];
    if (Math.abs(sm[i].x - k.x) > deadzone || Math.abs(sm[i].y - k.y) > deadzone) keep.push(round(sm[i]));
  }
  const end = round(sm[sm.length - 1]);
  const k = keep[keep.length - 1];
  if (Math.abs(end.x - k.x) > deadzone / 2 || Math.abs(end.y - k.y) > deadzone / 2 || keep.length === 1) keep.push(end);
  return keep;
}

function round(p: FocusPoint): FocusPoint {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { t: r(p.t), x: r(Math.min(1, Math.max(0, p.x))), y: r(Math.min(1, Math.max(0, p.y))) };
}

/** Frame size for analysis: ~64 px on the long side, keeping the aspect ratio. */
export function sampleSize(aw: number | undefined, ah: number | undefined, long = 64) {
  const w0 = aw || 16;
  const h0 = ah || 9;
  const k = long / Math.max(w0, h0);
  return { width: Math.max(8, Math.round((w0 * k) / 2) * 2), height: Math.max(8, Math.round((h0 * k) / 2) * 2) };
}

/** Decode a packed RGB buffer (as returned by the backend) into frames. */
export function unpackFrames(bytes: Uint8Array, width: number, height: number, start: number, fps: number): SampleFrame[] {
  const size = width * height * 3;
  const frames: SampleFrame[] = [];
  for (let i = 0; (i + 1) * size <= bytes.length; i++) {
    frames.push({ t: start + i / fps, width, height, rgb: bytes.subarray(i * size, (i + 1) * size) });
  }
  return frames;
}
