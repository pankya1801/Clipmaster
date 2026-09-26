import { describe, expect, it } from "vitest";
import { keyframeExpr, sampleKeyframes, upsertKeyframe } from "../src/core/keyframes";
import type { Keyframe } from "../src/core/types";

const base = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
const keys: Keyframe[] = [
  { ...base, t: 0, scale: 0.5 },
  { ...base, t: 2, scale: 1.5, x: 0.9 },
];

/** Evaluate an FFmpeg-style expression in JS to check it matches sampling. */
function evalExpr(expr: string, t: number): number {
  const js = expr
    .replace(/\\,/g, ",")
    .replace(/if\(/g, "iff(")
    .replace(/lt\(/g, "lt(");
  // eslint-disable-next-line no-new-func
  return new Function("t", "iff", "lt", "clip", `return ${js};`)(
    t,
    (c: number, a: number, b: number) => (c ? a : b),
    (a: number, b: number) => (a < b ? 1 : 0),
    (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  );
}

describe("keyframes", () => {
  it("holds before the first and after the last key", () => {
    expect(sampleKeyframes(keys, -1).scale).toBe(0.5);
    expect(sampleKeyframes(keys, 5).scale).toBe(1.5);
  });
  it("eases between keys", () => {
    expect(sampleKeyframes(keys, 1).scale).toBeCloseTo(1);
    expect(sampleKeyframes(keys, 0.5).scale).toBeLessThan(0.75); // ease-in
  });
  it("FFmpeg expression matches the preview maths", () => {
    for (const prop of ["scale", "x"] as const) {
      const expr = keyframeExpr(keys, prop, "t");
      for (const t of [-0.5, 0, 0.3, 1, 1.7, 2, 3]) expect(evalExpr(expr, t)).toBeCloseTo(sampleKeyframes(keys, t)[prop], 4);
    }
    expect(keyframeExpr(keys, "rotation", "t")).toBe("0");
  });
  it("upserts at the same time instead of duplicating", () => {
    const k = upsertKeyframe(keys, 2.01, { ...base, scale: 3 }, 30);
    expect(k).toHaveLength(2);
    expect(k[1].scale).toBe(3);
    expect(upsertKeyframe(keys, 1, base)).toHaveLength(3);
  });
});
