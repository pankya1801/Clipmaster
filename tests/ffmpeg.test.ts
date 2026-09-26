import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atempoChain, buildExportPlan, escapeFilterValue, parseProgress } from "../src/core/ffmpeg";
import { addAsset, addText, createProject, placeAsset, updateClip } from "../src/core/project";

describe("helpers", () => {
  it("chains atempo within range", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(1.5)).toEqual(["atempo=1.5"]);
  });
  it("escapes filter values", () => {
    expect(escapeFilterValue("C:\\a b\\it's")).toBe("C\\:/a b/it'\\''s");
  });
  it("parses progress", () => {
    expect(parseProgress("out_time_ms=2500000")).toBe(2.5);
    expect(parseProgress("frame=10")).toBeNull();
  });
  it("throws on empty timeline", () => {
    expect(() => buildExportPlan(createProject(), { outputPath: "o.mp4", tempDir: "/tmp", quality: "draft" })).toThrow();
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

function probe(path: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]);
  return JSON.parse(out.toString());
}

describe.skipIf(!hasFfmpeg)("real ffmpeg export", () => {
  it("renders video + image + music + text at 9:16", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipmaster-"));
    const v = join(dir, "v.mp4");
    const img = join(dir, "i.png");
    const mp3 = join(dir, "m.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-shortest", "-pix_fmt", "yuv420p", v]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x400:d=1", "-frames:v", "1", img]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=f=220:d=10", mp3]);

    let p = createProject();
    p = { ...p, settings: { width: 540, height: 960, fps: 30 } };
    p = addAsset(p, { id: "v", path: v, name: "v", kind: "video", duration: 4, hasAudio: true });
    p = addAsset(p, { id: "i", path: img, name: "i", kind: "image", duration: 0, hasAudio: false });
    p = addAsset(p, { id: "m", path: mp3, name: "m", kind: "audio", duration: 10, hasAudio: true });
    const a = placeAsset(p, "v", "t_v1");
    p = updateClip(a.project, a.clipId!, { speed: 2, fadeIn: 0.5 }); // 2s
    p = placeAsset(p, "i", "t_v1").project; // 2..7
    const m = placeAsset(p, "m", "t_a1");
    p = updateClip(m.project, m.clipId!, { volume: 0.5, fadeOut: 1 });
    const t = addText(p, "t_text", 0.5, "Hello: it's \"Clipmaster\" 100%");
    p = t.project;

    const out = join(dir, "out.mp4");
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft" });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });

    expect(existsSync(out)).toBe(true);
    const info = probe(out);
    const vs = info.streams.find((s: any) => s.codec_type === "video");
    expect(vs.width).toBe(540);
    expect(vs.height).toBe(960);
    expect(info.streams.some((s: any) => s.codec_type === "audio")).toBe(true);
    expect(Math.abs(Number(info.format.duration) - plan.duration)).toBeLessThan(0.25);
    expect(plan.duration).toBe(10);
  });
});
