import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAutoEdit, keptRanges, parseSilenceDetect, DEFAULT_AUTO_EDIT } from "../src/core/autoedit";
import { assColor, buildAss, CAPTION_TEMPLATES, groupCaptionLines, parseSrt, toSrt } from "../src/core/captions";
import { EFFECTS, TRANSITIONS } from "../src/core/effects";
import { buildExportPlan, VOICE_CLEANUP } from "../src/core/ffmpeg";
import { addAsset, addTrack, clipsOnTrack, createProject, placeAsset, updateClip } from "../src/core/project";
import type { CaptionWord, MediaClip } from "../src/core/types";

const words: CaptionWord[] = "Hello world this is Clipmaster. It makes captions easy!"
  .split(" ")
  .map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));

describe("catalogue", () => {
  it("has 25 caption templates and 30+ effects/transitions with unique ids", () => {
    expect(CAPTION_TEMPLATES).toHaveLength(25);
    expect(EFFECTS.length + TRANSITIONS.length).toBeGreaterThanOrEqual(30);
    const ids = [...CAPTION_TEMPLATES.map((t) => t.id), ...EFFECTS.map((e) => e.id), ...TRANSITIONS.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("captions", () => {
  it("groups by max words and sentence end", () => {
    const lines = groupCaptionLines(words, 3);
    expect(lines[0].words.map((w) => w.text)).toEqual(["Hello", "world", "this"]);
    expect(lines[1].words.at(-1)!.text).toBe("Clipmaster.");
  });
  it("converts colours to ASS BGR", () => {
    expect(assColor("#ff8000")).toBe("&H000080FF");
    expect(assColor("#000000", 1)).toBe("&HFF000000");
  });
  it("round-trips SRT and merges punctuation tokens", () => {
    const back = parseSrt(toSrt(words, 4));
    expect(back.map((w) => w.text)).toEqual(words.map((w) => w.text));
    const wordLevel = parseSrt("1\n00:00:00,000 --> 00:00:00,500\nHi\n\n2\n00:00:00,500 --> 00:00:00,600\n!\n");
    expect(wordLevel).toEqual([{ text: "Hi!", start: 0, end: 0.6 }]);
  });
  it("builds ASS for every template", () => {
    for (const t of CAPTION_TEMPLATES) {
      const ass = buildAss(words, { templateId: t.id, scale: 1 }, 1080, 1920);
      expect(ass).toContain("[Events]");
      expect(ass.match(/^Dialogue:/gm)!.length).toBeGreaterThan(0);
    }
  });
});

describe("auto edit", () => {
  it("parses silencedetect", () => {
    const s = "[silencedetect @ 0x1] silence_start: 1.5\n[silencedetect @ 0x1] silence_end: 3.2 | silence_duration: 1.7\n[silencedetect] silence_start: 9";
    expect(parseSilenceDetect(s, 10)).toEqual([{ start: 1.5, end: 3.2 }, { start: 9, end: 10 }]);
  });
  it("keeps speech with padding", () => {
    expect(keptRanges(0, 10, [{ start: 2, end: 4 }], 0.1, 0.3)).toEqual([{ start: 0, end: 2.1 }, { start: 3.9, end: 10 }]);
  });
  it("jump-cuts the main track and alternates punch-ins", () => {
    let p = addAsset(createProject(), { id: "v", path: "/v.mp4", name: "v", kind: "video", duration: 10, hasAudio: true });
    p = placeAsset(p, "v", "t_v1").project;
    const r = applyAutoEdit(p, { v: [{ start: 2, end: 4 }, { start: 6, end: 7 }] }, { ...DEFAULT_AUTO_EDIT, padding: 0 });
    const clips = clipsOnTrack(r.project, "t_v1") as MediaClip[];
    expect(clips).toHaveLength(3);
    expect(r.cuts).toBe(2);
    expect(r.removedSeconds).toBeCloseTo(3);
    expect(clips[1].start).toBeCloseTo(2);
    expect(clips[1].effects.some((e) => e.id === "punch-in")).toBe(true);
    expect(clips[0].effects.some((e) => e.id === "punch-in")).toBe(false);
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

describe.skipIf(!hasFfmpeg)("real ffmpeg: every effect, transition and caption template renders", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-fx-"));
  const src = join(dir, "src.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=24:d=3", "-f", "lavfi", "-i", "sine=d=3", "-shortest", "-pix_fmt", "yuv420p", src]);
  const fontsDir = join(__dirname, "..", "src-tauri", "fonts");

  function render(mutate: (clip: MediaClip, p: ReturnType<typeof createProject>) => ReturnType<typeof createProject>, name: string) {
    let p = createProject();
    p = { ...p, settings: { width: 320, height: 240, fps: 24 } };
    p = addAsset(p, { id: "v", path: src, name: "v", kind: "video", duration: 3, hasAudio: true });
    const a = placeAsset(p, "v", "t_v1");
    const b = placeAsset(a.project, "v", "t_v1");
    p = mutate(b.project.clips[b.clipId!] as MediaClip, b.project);
    const out = join(dir, `${name}.mp4`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft", fontsDir });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    try {
      execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    } catch (e: any) {
      throw new Error(`${name} failed:\n${e.stderr?.toString().split("\n").slice(-6).join("\n")}`);
    }
    expect(existsSync(out)).toBe(true);
  }

  it.each(EFFECTS.map((e) => e.id))("effect %s", (id) => {
    render((c, p) => updateClip(p, c.id, { effects: [{ id, amount: 0.8 }] }), `fx-${id}`);
  });
  it.each(TRANSITIONS.map((t) => t.id))("transition %s", (id) => {
    const side = TRANSITIONS.find((t) => t.id === id)!.side;
    render((c, p) => updateClip(p, c.id, side === "in" ? { transIn: { id, duration: 0.5 } } : { transOut: { id, duration: 0.5 } }), `tr-${id}`);
  });
  it("picture-in-picture: scaled, rotated, semi-transparent clip with effects over a background", () => {
    const pipOut = join(dir, "pip.mp4");
    let p = createProject();
    p = { ...p, settings: { width: 320, height: 240, fps: 24 } };
    p = addAsset(p, { id: "v", path: src, name: "v", kind: "video", duration: 3, hasAudio: true, width: 320, height: 240 });
    p = addTrack(p, "video"); // new top track
    const bg = placeAsset(p, "v", "t_v1");
    const topTrack = bg.project.tracks.find((t) => t.kind === "video")!.id;
    const pip = placeAsset(bg.project, "v", topTrack, 0);
    p = updateClip(pip.project, pip.clipId!, {
      transform: { x: 0.75, y: 0.75, scale: 0.4, rotation: 15, opacity: 0.8 },
      effects: [{ id: "pixelate", amount: 0.5 }, { id: "shake", amount: 0.5 }],
      transIn: { id: "slide-up", duration: 0.5 },
    });
    const plan = buildExportPlan(p, { outputPath: pipOut, tempDir: dir, quality: "draft", fontsDir });
    expect(plan.args.join(" ")).toContain("rotate=");
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    expect(existsSync(pipOut)).toBe(true);
  });

  it("voice clean-up and loudness normalisation render", () => {
    const out = join(dir, "voice.mp4");
    let p = createProject();
    p = { ...p, settings: { width: 320, height: 240, fps: 24 } };
    p = addAsset(p, { id: "v", path: src, name: "v", kind: "video", duration: 3, hasAudio: true });
    const a = placeAsset(p, "v", "t_v1");
    p = updateClip(a.project, a.clipId!, { denoise: true });
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft", normalizeLoudness: true });
    expect(plan.args.join(" ")).toContain("afftdn");
    expect(plan.args.join(" ")).toContain("loudnorm");
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    expect(existsSync(out)).toBe(true);
  });

  it("voice clean-up removes hiss but keeps the voice", () => {
    const noisy = join(dir, "noisy.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=a=0.03:d=4", "-f", "lavfi", "-i", "sine=f=220:d=4,volume=0.3,afade=t=in:st=2:d=0.01",
      "-filter_complex", "[0][1]amix=inputs=2:normalize=0", noisy]);
    const level = (chain: string, from: number, to: number) => {
      const r = spawnSync("ffmpeg", ["-i", noisy, "-af", `${chain},atrim=${from}:${to},volumedetect`, "-f", "null", "-"]);
      return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr.toString())![1]);
    };
    const chain = VOICE_CLEANUP.join(",");
    expect(level(chain, 0.5, 1.8)).toBeLessThan(level("anull", 0.5, 1.8) - 20); // hiss
    expect(level(chain, 2.5, 3.8)).toBeGreaterThan(level("anull", 2.5, 3.8) - 3); // voice
  });

  it("keyframes: animated position, scale, rotation and opacity", () => {
    const out = join(dir, "kf.mp4");
    let p = createProject();
    p = { ...p, settings: { width: 320, height: 240, fps: 24 } };
    p = addAsset(p, { id: "v", path: src, name: "v", kind: "video", duration: 3, hasAudio: true, width: 320, height: 240 });
    const a = placeAsset(p, "v", "t_v1");
    p = updateClip(a.project, a.clipId!, {
      keyframes: [
        { t: 0, x: 0.2, y: 0.2, scale: 0.3, rotation: 0, opacity: 0.2 },
        { t: 1.5, x: 0.5, y: 0.5, scale: 1, rotation: 90, opacity: 1 },
        { t: 3, x: 0.8, y: 0.7, scale: 0.5, rotation: 180, opacity: 0.6 },
      ],
      effects: [{ id: "vignette", amount: 0.5 }],
    });
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft", fontsDir });
    try {
      execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    } catch (e: any) {
      throw new Error(e.stderr?.toString().split("\n").slice(-8).join("\n"));
    }
    expect(existsSync(out)).toBe(true);
  });

  it.each(CAPTION_TEMPLATES.map((t) => t.id))("caption template %s", (id) => {
    render((_c, p) => ({ ...p, captions: words, captionSettings: { templateId: id, scale: 1 } }), `cap-${id}`);
  });
});
