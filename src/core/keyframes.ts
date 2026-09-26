/**
 * Keyframe animation for clip transforms. Values are interpolated with a
 * smooth ease-in-out between keys and held before the first / after the last.
 * The same maths drives the preview (sampleKeyframes) and the FFmpeg export
 * (keyframeExpr), so what you see is what you render.
 */
import type { Keyframe, Transform } from "./types";

export type AnimProp = keyof Transform;
export const ANIM_PROPS: AnimProp[] = ["x", "y", "scale", "rotation", "opacity"];

const ease = (p: number) => p * p * (3 - 2 * p);
const f = (v: number) => Number(v.toFixed(5)).toString();

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.t - b.t);
}

export function sampleKeyframes(keys: Keyframe[], t: number): Transform {
  const k = sortKeys(keys);
  const out = {} as Transform;
  for (const prop of ANIM_PROPS) out[prop] = sampleProp(k, prop, t);
  return out;
}

function sampleProp(k: Keyframe[], prop: AnimProp, t: number): number {
  if (t <= k[0].t) return k[0][prop];
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (t <= b.t) {
      const p = b.t === a.t ? 1 : ease((t - a.t) / (b.t - a.t));
      return a[prop] + (b[prop] - a[prop]) * p;
    }
  }
  return k[k.length - 1][prop];
}

export function isAnimated(keys: Keyframe[], prop: AnimProp): boolean {
  return keys.some((k) => k[prop] !== keys[0][prop]);
}

/**
 * FFmpeg expression for a property over time variable `tv` (e.g. "t" or
 * "(t-3.5)"). Commas are escaped for use inside a filtergraph.
 */
export function keyframeExpr(keys: Keyframe[], prop: AnimProp, tv: string): string {
  const k = sortKeys(keys);
  if (!isAnimated(k, prop)) return f(k[0][prop]);
  let expr = f(k[k.length - 1][prop]);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i];
    const b = k[i + 1];
    const d = Math.max(1e-6, b.t - a.t);
    const p = `clip((${tv}-${f(a.t)})/${f(d)}\\,0\\,1)`;
    const seg = `${f(a[prop])}+${f(b[prop] - a[prop])}*(${p})*(${p})*(3-2*(${p}))`;
    expr = `if(lt(${tv}\\,${f(b.t)})\\,${seg}\\,${expr})`;
  }
  return `if(lt(${tv}\\,${f(k[0].t)})\\,${f(k[0][prop])}\\,${expr})`;
}

/** Add or replace the keyframe at clip-local time t (within half a frame). */
export function upsertKeyframe(keys: Keyframe[] | undefined, t: number, values: Transform, fps = 30): Keyframe[] {
  const tol = 0.5 / fps;
  const rest = (keys ?? []).filter((k) => Math.abs(k.t - t) > tol);
  return sortKeys([...rest, { ...values, t: Math.max(0, t) }]);
}
