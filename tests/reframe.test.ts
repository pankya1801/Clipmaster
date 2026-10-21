import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportPlan } from "../src/core/ffmpeg";
import { addAsset, createProject, placeAsset, updateClip } from "../src/core/project";
import {
  clipFit, coverSize, focusAt, focusExpr, isSkin, locateSubject, needsReframe, objectPosition, SampleFrame, sampleSize, smoothPath, unpackFrames,
} from "../src/core/reframe";
import type { MediaClip } from "../src/core/types";

/** A frame with a skin-coloured square centred at (cx, cy) on grey. */
function frame(t: number, cx: number, cy: number, w = 64, h = 36): SampleFrame {
  const rgb = new Uint8Array(w * h * 3).fill(60);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - cx * w) < 5 && Math.abs(y - cy * h) < 5) rgb.set([224, 172, 140], (y * w + x) * 3);
    }
  return { t, width: w, height: h, rgb };
}

describe("reframe helpers", () => {
  it("defaults to fill, clip overrides project", () => {
    const c = { fit: undefined } as MediaClip;
    expect(clipFit(c, { width: 1, height: 1, fps: 30 })).toBe("fill");
    expect(clipFit(c, { width: 1, height: 1, fps: 30, fit: "blur" })).toBe("blur");
    expect(clipFit({ ...c, fit: "fit" }, { width: 1, height: 1, fps: 30, fit: "blur" })).toBe("fit");
  });
  it("covers the canvas", () => {
    expect(coverSize(1920, 1080, 1080, 1920)).toEqual({ w: 3414, h: 1920 });
    expect(coverSize(undefined, undefined, 1080, 1920)).toEqual({ w: 1080, h: 1920 });
    expect(needsReframe(1920, 1080, 1080, 1920)).toBe(true);
    expect(needsReframe(1920, 1080, 1920, 1080)).toBe(false);
  });
  it("interpolates focus", () => {
    const pts = [{ t: 1, x: 0.2, y: 0.5 }, { t: 3, x: 0.8, y: 0.5 }];
    expect(focusAt(pts, 0)).toEqual({ x: 0.2, y: 0.5 });
    expect(focusAt(pts, 2).x).toBeCloseTo(0.5);
    expect(focusAt(pts, 9).x).toBe(0.8);
    expect(focusExpr(pts, "x", "T")).toContain("if(lt(T\\,1)");
  });
  it("matches crop position in preview", () => {
    expect(objectPosition(1920, 1080, 1080, 1920, { x: 0.5, y: 0.5 })).toBe("50% 50%");
    expect(objectPosition(1920, 1080, 1080, 1920, { x: 0, y: 0.5 })).toBe("0% 50%");
    expect(objectPosition(1920, 1080, 1080, 1920, { x: 1, y: 0.5 })).toBe("100% 50%");
  });
  it("detects skin across tones", () => {
    expect(isSkin(224, 172, 140)).toBe(true);
    expect(isSkin(141, 85, 36)).toBe(true);
    expect(isSkin(40, 120, 220)).toBe(false);
    expect(isSkin(60, 60, 60)).toBe(false);
  });
  it("follows a subject moving across the frame", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i * 0.5, 0.15 + (0.7 * i) / 19, 0.4));
    const raw = locateSubject(frames);
    expect(raw[0].x).toBeCloseTo(0.15, 1);
    expect(raw[19].x).toBeCloseTo(0.85, 1);
    const path = smoothPath(raw);
    expect(path.length).toBeGreaterThan(2);
    expect(path.length).toBeLessThan(raw.length);
    expect(path[0].x).toBeLessThan(0.35);
    expect(path[path.length - 1].x).toBeGreaterThan(0.65);
    // Monotonic: a calm camera never swings back.
    for (let i = 1; i < path.length; i++) expect(path[i].x).toBeGreaterThanOrEqual(path[i - 1].x - 0.01);
  });
  it("holds still when the subject does", () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i, 0.3 + (i % 2) * 0.01, 0.5));
    const path = smoothPath(locateSubject(frames));
    expect(path.length).toBeLessThanOrEqual(2);
    expect(path[0].x).toBeCloseTo(0.3, 1);
  });
  it("keeps the last position when nothing is found", () => {
    const blank: SampleFrame = { t: 1, width: 8, height: 8, rgb: new Uint8Array(8 * 8 * 3).fill(50) };
    const raw = locateSubject([frame(0, 0.2, 0.5), blank]);
    expect(raw[1].x).toBeCloseTo(raw[0].x);
  });
  it("sizes and unpacks sample frames", () => {
    expect(sampleSize(1920, 1080)).toEqual({ width: 64, height: 36 });
    const bytes = new Uint8Array(64 * 36 * 3 * 3);
    const f = unpackFrames(bytes, 64, 36, 2, 2);
    expect(f.map((x) => x.t)).toEqual([2, 2.5, 3]);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Average RGB of a small box in a raw rgb24 frame. */
function boxColor(buf: Buffer, w: number, x0: number, y0: number, size = 6) {
  let r = 0, g = 0, b = 0;
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * w + x) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
  const k = size * size;
  return [r / k, g / k, b / k];
}

describe.skipIf(!hasFfmpeg)("real ffmpeg: 16:9 footage in a 9:16 canvas", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-reframe-"));
  // 320x180: left third red, middle green, right third blue.
  const src = join(dir, "wide.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=107x180:d=2", "-f", "lavfi", "-i", "color=c=lime:s=106x180:d=2", "-f", "lavfi", "-i", "color=c=blue:s=107x180:d=2",
    "-filter_complex", "[0][1][2]hstack=3,format=yuv420p", "-r", "24", src]);

  const render = (patch: Partial<MediaClip>) => {
    let p = createProject();
    p = { ...p, settings: { width: 180, height: 320, fps: 24 } };
    p = addAsset(p, { id: "v", path: src, name: "v", kind: "video", duration: 2, width: 320, height: 180, hasAudio: false });
    const a = placeAsset(p, "v", "t_v1");
    p = updateClip(a.project, a.clipId!, patch);
    const out = join(dir, `out_${Object.values(patch).map((v) => JSON.stringify(v)).join("_").replace(/\W/g, "")}.mp4`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft" });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    const raw = join(dir, "f.rgb");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
    return readFileSync(raw);
  };
  const W = 180;

  it("fill crops to the centre and leaves no black bars", () => {
    const f = render({ fit: "fill" });
    const top = boxColor(f, W, 87, 4);
    const mid = boxColor(f, W, 87, 157);
    expect(top[1]).toBeGreaterThan(150); // green, not black
    expect(mid[1]).toBeGreaterThan(150);
  });
  it("fill follows the focus point", () => {
    const f = render({ fit: "fill", focus: [{ t: 0, x: 0.05, y: 0.5 }] });
    expect(boxColor(f, W, 87, 157)[0]).toBeGreaterThan(150); // red side
  });
  it("blur keeps the whole picture with a blurred background", () => {
    const f = render({ fit: "blur" });
    const top = boxColor(f, W, 87, 10);
    expect(top[0] + top[1] + top[2]).toBeGreaterThan(60); // not black bars
    const centre = boxColor(f, W, 87, 157);
    expect(centre[1]).toBeGreaterThan(120); // sharp middle is still green
  });
  it("fit letterboxes", () => {
    const f = render({ fit: "fit" });
    const top = boxColor(f, W, 87, 4);
    expect(top[0] + top[1] + top[2]).toBeLessThan(30);
  });
});
