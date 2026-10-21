import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportPlan } from "../src/core/ffmpeg";
import { addAsset, addTrack, createProject, placeAsset, updateClip } from "../src/core/project";
import { TEXT_PRESETS } from "../src/core/textPresets";
import type { MediaClip, Project } from "../src/core/types";
import {
  ensureGeneratorAsset, GENERATORS, generatorOfPath, INTROS, LAYOUTS, maskCss, maskFilter, particleAt, rng, STICKERS, stickerKeyframes,
} from "../src/core/visuals";

describe("visuals catalogue", () => {
  it("has backgrounds, overlays, stickers and intros", () => {
    expect(GENERATORS.filter((g) => g.category === "background").length).toBeGreaterThanOrEqual(10);
    expect(GENERATORS.filter((g) => g.category === "overlay").length).toBeGreaterThanOrEqual(7);
    expect(STICKERS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    expect(INTROS.filter((t) => t.kind === "intro").length).toBeGreaterThanOrEqual(5);
    // Every intro refers to real generators and text presets.
    for (const t of INTROS) {
      expect(GENERATORS.some((g) => g.id === t.bg)).toBe(true);
      if (t.overlay) expect(GENERATORS.some((g) => g.id === t.overlay)).toBe(true);
      expect(TEXT_PRESETS.some((p) => p.id === t.preset)).toBe(true);
    }
  });
  it("is deterministic", () => {
    const a = rng(5);
    const b = rng(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const g = GENERATORS.find((x) => x.id === "ov-confetti")!;
    expect(g.css(1.5)).toBe(g.css(1.5));
    expect(g.css(1.5)).not.toBe(g.css(2));
  });
  it("wraps particles around the frame", () => {
    const p = { x: 0.5, y: 0.9, vy: 0.5, sway: 0, freq: 1, phase: 0, size: 0.01, color: "#ffffff", alpha: 1 };
    expect(particleAt(p, 0).y).toBeCloseTo(0.89);
    const y = particleAt(p, 1).y;
    expect(y).toBeGreaterThan(-0.02);
    expect(y).toBeLessThan(1.01);
  });
  it("makes masks and keyframes", () => {
    expect(maskFilter(undefined)).toBeNull();
    expect(maskFilter("circle")).toContain("hypot");
    expect(maskCss("rounded", 100, 50)).toBe("inset(0 round 4px)");
    const keys = stickerKeyframes({ x: 0.3, y: 0.4 }, 0.3, 3);
    expect(keys[0].scale).toBeCloseTo(0.06);
    expect(keys[2].scale).toBe(0.3);
    expect(keys.length).toBeGreaterThan(3);
  });
  it("registers generator assets once", () => {
    let p = createProject();
    const a = ensureGeneratorAsset(p, "bg-sunset");
    p = a.project;
    expect(ensureGeneratorAsset(p, "bg-sunset").project).toBe(p);
    expect(generatorOfPath(p.assets[a.assetId].path)?.id).toBe("bg-sunset");
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

function pixel(buf: Buffer, w: number, x: number, y: number) {
  const i = (y * w + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

describe.skipIf(!hasFfmpeg)("real ffmpeg: generated visuals, masks and layouts", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-visuals-"));
  const W = 180;
  const H = 320;
  const red = join(dir, "red.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=2:r=24", "-pix_fmt", "yuv420p", red]);

  const base = () => {
    let p = createProject();
    p = { ...p, settings: { width: W, height: H, fps: 24 } };
    return addAsset(p, { id: "r", path: red, name: "r", kind: "video", duration: 2, width: 320, height: 180, hasAudio: false });
  };
  const render = (p: Project, name: string, at = 1) => {
    const out = join(dir, `${name}.mp4`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft" });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    const raw = join(dir, `${name}.rgb`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw]);
    return readFileSync(raw);
  };

  for (const g of GENERATORS) {
    it(`renders ${g.category} ${g.id}`, () => {
      let p = base();
      const main = placeAsset(p, "r", "t_v1");
      p = main.project;
      const gen = ensureGeneratorAsset(p, g.id);
      p = gen.project;
      if (g.category === "background") {
        // Background alone on the main track.
        p = updateClip(p, main.clipId!, { out: 0.5 });
        const bg = placeAsset(p, gen.assetId, "t_v1", 0.5);
        p = updateClip(bg.project, bg.clipId!, { duration: 2 } as never);
        const f = render(p, g.id);
        const c = pixel(f, W, W / 2, H / 2);
        expect(c[0] + c[1] + c[2]).toBeGreaterThan(30);
      } else {
        p = addTrack(p, "video");
        const top = p.tracks.find((t) => t.kind === "video" && t.id !== "t_v1")!;
        const ov = placeAsset(p, gen.assetId, top.id, 0);
        p = ov.project;
        const f = render(p, g.id);
        // Overlays are see-through: most of the frame is still the red clip.
        let redPx = 0;
        for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) { const c = pixel(f, W, x, y); if (c[0] > 120 && c[2] < 140) redPx++; }
        if (g.id === "ov-spotlight") {
          // Spotlight darkens the edges but keeps the centre clear.
          const c = pixel(f, W, W / 2, H / 2);
          expect(c[0]).toBeGreaterThan(150);
          expect(pixel(f, W, 2, 2)[0]).toBeLessThan(c[0] - 60);
        } else expect(redPx / ((H / 8) * (W / 8))).toBeGreaterThan(0.5);
      }
    });
  }

  it("circle mask leaves the corners transparent", () => {
    let p = base();
    const a = placeAsset(p, "r", "t_v1");
    p = updateClip(a.project, a.clipId!, { mask: "circle", fit: "fill" } as Partial<MediaClip>);
    const f = render(p, "circle");
    expect(pixel(f, W, 3, 3)[0]).toBeLessThan(40); // black corner
    expect(pixel(f, W, W / 2, H / 2)[0]).toBeGreaterThan(150); // red centre
  });

  it("split-screen layout fills only its half", () => {
    let p = base();
    const a = placeAsset(p, "r", "t_v1");
    p = updateClip(a.project, a.clipId!, { box: LAYOUTS.find((l) => l.id === "top")!.box } as Partial<MediaClip>);
    const f = render(p, "top");
    expect(pixel(f, W, W / 2, H / 4)[0]).toBeGreaterThan(150); // top half red, no bars
    expect(pixel(f, W, 4, 6)[0]).toBeGreaterThan(150);
    expect(pixel(f, W, W / 2, (3 * H) / 4)[0]).toBeLessThan(40); // bottom empty
  });
});

import { applyTemplate } from "../src/core/templates";
import { clipEnd, clipsOnTrack as onTrack, projectDuration } from "../src/core/project";
import { introById } from "../src/core/visuals";

describe("intro / outro templates", () => {
  const start = () => {
    let p = createProject();
    p = addAsset(p, { id: "v", path: "v.mp4", name: "v", kind: "video", duration: 10, width: 1920, height: 1080, hasAudio: true });
    p = placeAsset(p, "v", "t_v1").project;
    return { ...p, captions: [{ text: "hi", start: 1, end: 1.5 }] };
  };
  it("intro pushes the video later and fills the gap", () => {
    const tpl = introById("intro-party")!;
    const { project } = applyTemplate(start(), tpl);
    const main = onTrack(project, "t_v1");
    expect(main[0].start).toBe(0);
    expect(clipEnd(main[0])).toBeCloseTo(tpl.duration);
    expect(main[1].start).toBeCloseTo(tpl.duration);
    expect(project.captions[0].start).toBeCloseTo(1 + tpl.duration);
    const texts = Object.values(project.clips).filter((c) => c.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ preset: "pop-title", text: "Happy Birthday!", start: 0, duration: tpl.duration });
    // Confetti overlay on a track above the main one.
    const ov = Object.values(project.clips).find((c) => c.type === "media" && c.assetId === "gen_ov-confetti")!;
    expect(project.tracks.findIndex((t) => t.id === ov.trackId)).toBeLessThan(project.tracks.findIndex((t) => t.id === "t_v1"));
  });
  it("outro goes after the video", () => {
    const tpl = introById("outro-subscribe")!;
    const p = start();
    const { project, start: at } = applyTemplate(p, tpl);
    expect(at).toBeCloseTo(10);
    expect(projectDuration(project)).toBeCloseTo(10 + tpl.duration);
    expect(onTrack(project, "t_v1")[0].start).toBe(0);
  });
});

describe.skipIf(!hasFfmpeg)("real ffmpeg: intro template", () => {
  it("renders an intro before a clip", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipmaster-intro-"));
    const v = join(dir, "v.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=2", "-pix_fmt", "yuv420p", v]);
    let p = createProject();
    p = { ...p, settings: { width: 180, height: 320, fps: 24 } };
    p = addAsset(p, { id: "v", path: v, name: "v", kind: "video", duration: 2, width: 320, height: 180, hasAudio: false });
    p = placeAsset(p, "v", "t_v1").project;
    p = applyTemplate(p, introById("intro-neon")!).project;
    const out = join(dir, "o.mp4");
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft" });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    expect(plan.duration).toBeCloseTo(5);
  });
});
