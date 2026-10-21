import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOUNDS, soundRenderArgs } from "../src/core/audiolib";
import { buildExportPlan } from "../src/core/ffmpeg";
import { addAsset, createProject, placeAsset } from "../src/core/project";
import type { SampleFrame } from "../src/core/reframe";
import { fillTemplate, isTemplate, makeTemplate } from "../src/core/sharing";
import { followKeyframes, trackPoint } from "../src/core/tracking";
import type { MediaAsset, Project } from "../src/core/types";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Frames with a bright 4×4 square moving right by 2 px per frame. */
function movingSquare(n: number): SampleFrame[] {
  const w = 48, h = 32;
  return Array.from({ length: n }, (_, i) => {
    const rgb = new Uint8Array(w * h * 3).fill(20);
    for (let y = 12; y < 16; y++) for (let x = 8 + i * 2; x < 12 + i * 2; x++) rgb.fill(240, (y * w + x) * 3, (y * w + x) * 3 + 3);
    return { t: i / 10, width: w, height: h, rgb };
  });
}

describe("motion tracking", () => {
  it("follows a moving square", () => {
    const tr = trackPoint(movingSquare(10), 10 / 48, 14 / 32, 3, 5);
    expect(tr).toHaveLength(10);
    expect(tr[9].x * 48).toBeCloseTo(10 + 18, 0);
    expect(tr[9].y * 32).toBeCloseTo(14, 0);
  });
  it("turns the path into keyframes that keep the offset", () => {
    const tr = trackPoint(movingSquare(10), 10 / 48, 14 / 32, 3, 5);
    const base = { x: 0.3, y: 0.2, scale: 0.3, rotation: 0, opacity: 1 };
    const keys = followKeyframes(tr, base, 0, 1);
    expect(keys[0]).toMatchObject({ t: 0, x: 0.3, y: 0.2 });
    const last = keys[keys.length - 1];
    expect(last.x - 0.3).toBeCloseTo(tr[tr.length - 1].x - tr[0].x, 3);
  });
});

describe("shareable templates", () => {
  const asset = (id: string, duration: number): MediaAsset => ({ id, path: `/m/${id}.mp4`, name: id, kind: "video", duration, width: 1920, height: 1080, hasAudio: true });
  let p: Project = createProject();
  p = addAsset(addAsset(p, asset("a1", 10)), asset("a2", 8));
  p = placeAsset(p, "a1", "t_v1").project;
  p = placeAsset(p, "a2", "t_v1").project;

  it("turns user media into numbered slots with no paths", () => {
    const t = makeTemplate(p, "My edit");
    expect(isTemplate(JSON.parse(JSON.stringify(t)))).toBe(true);
    expect(t.slots.map((s) => s.label)).toEqual(["Clip 1", "Clip 2"]);
    expect(Object.values(t.project.assets).every((a) => a.path === "")).toBe(true);
  });
  it("fills slots and shortens clips for shorter media", () => {
    const t = makeTemplate(p);
    const r = fillTemplate(t, { a1: asset("n1", 4) });
    expect(r.missing).toEqual(["Clip 2"]);
    const clips = Object.values(r.project.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0].type === "media" && clips[0].out).toBeLessThanOrEqual(4);
    expect(r.project.assets.a1.path).toBe("/m/n1.mp4");
  });
});

describe.skipIf(!hasFfmpeg)("sound library and export formats (real ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-v04-"));
  it("renders every sound", () => {
    for (const s of SOUNDS) {
      const out = join(dir, `${s.id}.wav`);
      execFileSync("ffmpeg", soundRenderArgs(s, out), { stdio: "pipe" });
      expect(statSync(out).size).toBeGreaterThan(1000);
    }
  });
  it.each(["gif", "webm", "mov"] as const)("exports %s", (format) => {
    const src = join(dir, "src.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=64x64:r=24:d=1", "-f", "lavfi", "-i", "sine=d=1", "-shortest", "-pix_fmt", "yuv420p", src]);
    let p: Project = createProject();
    p = { ...p, settings: { width: 64, height: 64, fps: 24 } };
    p = addAsset(p, { id: "a", path: src, name: "a", kind: "video", duration: 1, width: 64, height: 64, hasAudio: true });
    p = placeAsset(p, "a", "t_v1").project;
    const out = join(dir, `out.${format}`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft", format });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", out]).toString();
    expect(probe).toContain(format === "gif" ? "gif" : format === "webm" ? "vp9" : "h264");
  });
});
