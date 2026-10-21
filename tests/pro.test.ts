import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportPlan, chromaFilter, lutFilter } from "../src/core/ffmpeg";
import { addAsset, createProject, placeAsset, updateClip } from "../src/core/project";
import { RAMP_PRESETS, rampFactor, rampSetpts, rampTable, silentTiming, sourceTimeAt } from "../src/core/speed";
import type { MediaClip, Project } from "../src/core/types";
import { maskFilter } from "../src/core/visuals";

const clip = (patch: Partial<MediaClip> = {}): MediaClip => ({
  id: "c", type: "media", trackId: "t", assetId: "a", start: 0, in: 2, out: 6, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, effects: [], ...patch,
});

describe("speed ramps", () => {
  it("normalises so the clip keeps its length", () => {
    for (const p of RAMP_PRESETS) {
      const t = rampTable(p.points);
      expect(t[0].v).toBe(0);
      expect(t[t.length - 1].v).toBeCloseTo(1);
      for (let i = 1; i < t.length; i++) expect(t[i].v).toBeGreaterThanOrEqual(t[i - 1].v);
    }
  });
  it("spends longer in the slow part", () => {
    const hero = RAMP_PRESETS.find((p) => p.id === "hero")!;
    const c = clip({ ramp: hero.points });
    expect(rampFactor(hero.points, 0.5)).toBeCloseTo(0.2);
    // Halfway through the timeline we're near the middle of the source but the
    // slow section takes most of the time.
    const s1 = sourceTimeAt(c, 1);
    const s2 = sourceTimeAt(c, 3);
    expect(s1).toBeGreaterThan(2 + 1); // fast at the start
    expect(s2 - s1).toBeLessThan(2); // slow in the middle
    expect(sourceTimeAt(c, 4)).toBeCloseTo(6);
    expect(rampSetpts(c)).toContain("setpts='(if(lt(T");
  });
  it("maps freeze and reverse", () => {
    expect(sourceTimeAt(clip({ freeze: true }), 3)).toBe(2);
    expect(sourceTimeAt(clip({ reverse: true }), 1)).toBe(5);
    expect(silentTiming(clip({ freeze: true }))).toBe(true);
    expect(silentTiming(clip({ reverse: true }))).toBe(false);
  });
  it("builds key, LUT and feather filters", () => {
    expect(chromaFilter({ color: "#00ff00", similarity: 0.12, blend: 0.08 })).toBe("chromakey=color=0x00ff00:similarity=0.12:blend=0.08");
    expect(lutFilter({ path: "/x/a.cube", amount: 1 })).toBe("lut3d=file='/x/a.cube'");
    expect(lutFilter({ path: "/x/a.cube", amount: 0.5 }, "l0")).toContain("blend=all_mode=normal:all_opacity=0.5");
    expect(maskFilter("circle", 0.5)).toContain("/max(1");
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

describe.skipIf(!hasFfmpeg)("real ffmpeg: speed, freeze, reverse, stabilise, key, LUT, background mask", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-pro-"));
  // Frame number burnt in as brightness: frame k → grey level 10*k (k < 24), 24 fps.
  const ramp = join(dir, "ramp.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=24:d=4,geq=lum='min(255\\,N*2.5)':cb=128:cr=128", "-f", "lavfi", "-i", "sine=d=4", "-shortest", "-pix_fmt", "yuv420p", ramp]);
  const green = join(dir, "green.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x00ff00:s=64x64:r=24:d=2,drawbox=x=24:y=24:w=16:h=16:color=red:t=fill", "-pix_fmt", "yuv420p", green]);
  const cube = join(dir, "invert.cube");
  writeFileSync(cube, ["LUT_3D_SIZE 2", "1 1 1", "0 1 1", "1 0 1", "0 0 1", "1 1 0", "0 1 0", "1 0 0", "0 0 0"].join("\n"));
  const mask = join(dir, "mask.mkv");
  // Mask: left half white (keep), right half black (remove).
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=12:d=4,drawbox=x=0:y=0:w=16:h=32:color=white:t=fill,format=gray", "-c:v", "ffv1", mask]);

  const project = (path: string, dur: number, patch: Partial<MediaClip>, bg = "black") => {
    let p: Project = createProject();
    p = { ...p, settings: { width: 64, height: 64, fps: 24 } };
    p = addAsset(p, { id: "a", path, name: "a", kind: "video", duration: dur, width: 64, height: 64, hasAudio: path === ramp });
    if (bg !== "black") {
      p = addAsset(p, { id: "bg", path: "generated:bg-sunset", name: "bg", kind: "image", duration: 0, width: 64, height: 64, hasAudio: false });
    }
    const a = placeAsset(p, "a", "t_v1");
    return updateClip(a.project, a.clipId!, patch);
  };
  const render = (p: Project, name: string) => {
    const out = join(dir, `out_${name}.mp4`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft" });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    return { out, plan };
  };
  const lumaAt = (file: string, t: number, x = 32, y = 32) => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const i = (y * 64 + x) * 3;
    return [raw[i], raw[i + 1], raw[i + 2]];
  };

  it("ramped clip keeps its length and plays slow in the middle", () => {
    const hero = RAMP_PRESETS.find((p) => p.id === "hero")!;
    const { out, plan } = render(project(ramp, 4, { ramp: hero.points }), "ramp");
    expect(plan.duration).toBeCloseTo(4);
    // Brightness rises with source frame; slow-mo means a small change over the middle second.
    const a = lumaAt(out, 1.5)[0];
    const b = lumaAt(out, 2.5)[0];
    const start = lumaAt(out, 0.2)[0];
    const quarter = lumaAt(out, 1.0)[0];
    expect(quarter - start).toBeGreaterThan(b - a); // more source passes per second at the start
  });
  it("freeze holds one frame", () => {
    const { out } = render(project(ramp, 4, { in: 1, out: 3, freeze: true }), "freeze");
    expect(Math.abs(lumaAt(out, 0.2)[0] - lumaAt(out, 1.8)[0])).toBeLessThan(4);
  });
  it("reverse plays backwards", () => {
    const { out } = render(project(ramp, 4, { reverse: true }), "reverse");
    expect(lumaAt(out, 0.3)[0]).toBeGreaterThan(lumaAt(out, 3.5)[0] + 40);
  });
  it("stabilise renders", () => {
    render(project(ramp, 4, { stabilize: true }), "stab");
  });
  it("green screen keys out the green", () => {
    const { out } = render(project(green, 2, { chroma: { color: "#00ff00", similarity: 0.15, blend: 0.05 } }), "key");
    const bgPx = lumaAt(out, 1, 4, 4);
    expect(bgPx[1]).toBeLessThan(60); // green removed → black canvas
    expect(lumaAt(out, 1, 32, 32)[0]).toBeGreaterThan(150); // red square kept
  });
  it("LUT grades the clip", () => {
    const { out } = render(project(green, 2, { lut: { path: cube, name: "invert", amount: 1 } }), "lut");
    const c = lumaAt(out, 1, 4, 4);
    expect(c[0]).toBeGreaterThan(150); // green inverted to magenta
    expect(c[1]).toBeLessThan(80);
  });
  it("background mask keeps only the masked part", () => {
    const { out } = render(project(green, 2, { bgMask: { path: mask, start: 0, fps: 12 } }), "bgmask");
    expect(lumaAt(out, 1, 8, 32)[1]).toBeGreaterThan(150); // left kept (green)
    expect(lumaAt(out, 1, 56, 32)[1]).toBeLessThan(60); // right removed (black canvas)
  });
});
