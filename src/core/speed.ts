/**
 * Speed ramps ("curve speed" / velocity edits), freeze frames and reverse.
 *
 * A ramp is a speed multiplier over the clip's source (u = 0..1). It is
 * normalised so the clip keeps the length given by `speed`, so everything
 * else on the timeline (durations, snapping, ripple) stays unchanged.
 */
import type { MediaClip } from "./types";

export interface RampPoint {
  /** Position in the clip's source, 0..1. */
  u: number;
  /** Relative speed (1 = clip speed). */
  f: number;
}

export const RAMP_PRESETS: { id: string; name: string; hint: string; points: RampPoint[] }[] = [
  { id: "montage", name: "Montage", hint: "Fast → slow-mo → fast", points: [{ u: 0, f: 2.5 }, { u: 0.4, f: 0.3 }, { u: 0.6, f: 0.3 }, { u: 1, f: 2.5 }] },
  { id: "hero", name: "Hero", hint: "Normal → dramatic slow-mo → normal", points: [{ u: 0, f: 1 }, { u: 0.42, f: 0.2 }, { u: 0.58, f: 0.2 }, { u: 1, f: 1 }] },
  { id: "bullet", name: "Bullet", hint: "Fast, then freeze-like slow-mo", points: [{ u: 0, f: 3 }, { u: 0.5, f: 3 }, { u: 0.62, f: 0.15 }, { u: 1, f: 0.15 }] },
  { id: "flash-in", name: "Flash in", hint: "Slow start, speeds up", points: [{ u: 0, f: 0.3 }, { u: 1, f: 3 }] },
  { id: "flash-out", name: "Flash out", hint: "Fast start, slows down", points: [{ u: 0, f: 3 }, { u: 1, f: 0.3 }] },
  { id: "jump", name: "Jump cut", hint: "Normal, a fast skip, normal", points: [{ u: 0, f: 1 }, { u: 0.45, f: 1 }, { u: 0.5, f: 5 }, { u: 0.55, f: 1 }, { u: 1, f: 1 }] },
];

const N = 64;

/** Relative speed at u (linear between points). */
export function rampFactor(points: RampPoint[], u: number): number {
  const p = [...points].sort((a, b) => a.u - b.u);
  if (u <= p[0].u) return p[0].f;
  for (let i = 0; i < p.length - 1; i++) {
    if (u <= p[i + 1].u) {
      const k = (u - p[i].u) / Math.max(1e-9, p[i + 1].u - p[i].u);
      return p[i].f + (p[i + 1].f - p[i].f) * k;
    }
  }
  return p[p.length - 1].f;
}

/**
 * Table mapping source fraction u → timeline fraction v (both 0..1), with
 * the curve normalised so v(1) = 1. Built by integrating 1/speed.
 */
export function rampTable(points: RampPoint[]): { u: number; v: number }[] {
  const raw: number[] = [0];
  for (let i = 1; i <= N; i++) {
    const a = rampFactor(points, (i - 1) / N);
    const b = rampFactor(points, i / N);
    // Trapezoid on 1/f.
    raw.push(raw[i - 1] + (0.5 * (1 / Math.max(0.01, a) + 1 / Math.max(0.01, b))) / N);
  }
  const total = raw[N];
  return raw.map((v, i) => ({ u: i / N, v: v / total }));
}

function interp(table: { u: number; v: number }[], x: number, from: "u" | "v", to: "u" | "v") {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][from]) {
      const a = table[i - 1];
      const b = table[i];
      const k = (x - a[from]) / Math.max(1e-9, b[from] - a[from]);
      return a[to] + (b[to] - a[to]) * k;
    }
  }
  return 1;
}

/** Source time (seconds) shown `local` seconds into the clip on the timeline. */
export function sourceTimeAt(c: MediaClip, local: number): number {
  const len = c.out - c.in;
  const dur = len / c.speed;
  if (c.freeze) return c.in;
  if (c.reverse) return c.out - Math.min(len, Math.max(0, local * c.speed));
  if (!c.ramp?.length) return c.in + local * c.speed;
  return c.in + interp(rampTable(c.ramp), local / dur, "v", "u") * len;
}

const n = (v: number) => (Math.round(v * 1e5) / 1e5).toString();

/**
 * setpts expression for a ramped clip whose input timestamps start at 0
 * (source-relative seconds `T`): returns the output time in seconds.
 */
export function rampSetpts(c: MediaClip): string {
  const len = c.out - c.in;
  const dur = len / c.speed;
  const t = rampTable(c.ramp ?? [{ u: 0, f: 1 }, { u: 1, f: 1 }]);
  let expr = n(dur);
  for (let i = t.length - 1; i >= 1; i--) {
    const a = t[i - 1];
    const b = t[i];
    const ta = a.u * len;
    const tb = b.u * len;
    const seg = `${n(a.v * dur)}+(T-${n(ta)})*${n(((b.v - a.v) * dur) / Math.max(1e-9, tb - ta))}`;
    expr = `if(lt(T\\,${n(tb)})\\,${seg}\\,${expr})`;
  }
  return `setpts='(${expr})/TB'`;
}

/**
 * Filters that turn the raw clip input into its timed video stream
 * (trim + speed / ramp / freeze / reverse), before sizing and effects.
 * `tail` extends the clip for an incoming dissolve.
 */
export function timingFilters(c: MediaClip, isImage: boolean, shown: number, tail: number): string[] {
  if (isImage) return [`trim=duration=${n(shown)}`, `setpts=PTS-STARTPTS`];
  if (c.freeze) {
    return [`trim=start=${n(c.in)}:duration=0.1`, "setpts=PTS-STARTPTS", `tpad=stop_mode=clone:stop_duration=${n(shown + 0.2)}`, `trim=duration=${n(shown)}`];
  }
  if (c.reverse) {
    return [`trim=start=${n(c.in)}:end=${n(c.out)}`, "setpts=PTS-STARTPTS", "reverse", `setpts=PTS/${n(c.speed)}`];
  }
  if (c.ramp?.length) return [`trim=start=${n(c.in)}:end=${n(c.out)}`, "setpts=PTS-STARTPTS", rampSetpts(c)];
  return [`trim=start=${n(c.in)}:end=${n(c.out + tail * c.speed)}`, `setpts=(PTS-STARTPTS)/${n(c.speed)}`];
}

/** Clips whose own sound is dropped on export (it can't follow the timing). */
export function silentTiming(c: MediaClip): boolean {
  return !!c.freeze || !!c.ramp?.length;
}
