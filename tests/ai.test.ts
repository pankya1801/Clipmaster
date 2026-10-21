import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chatRequest, chatText, extractJson, imageRequest, imageResult, llmProvider, parseClipIdeas, parsePublishKit, parseQueries, parseTranslation,
  respread, sentences, speechRequest, timedTranscript,
} from "../src/core/ai";
import { buildExportPlan } from "../src/core/ffmpeg";
import { addAsset, createProject, placeAsset, updateClip } from "../src/core/project";
import { bestFrame, frameScore, wrapWords } from "../src/core/thumbnail";
import type { CaptionWord, MediaClip, Project } from "../src/core/types";
import { brandProject, cornerPos, DEFAULT_BRAND } from "../src/lib/brand";
import { holdFaces } from "../src/lib/faces";

const say = (text: string, from = 0, step = 0.4): CaptionWord[] => text.split(" ").map((t, i) => ({ text: t, start: from + i * step, end: from + i * step + 0.35 }));

describe("AI requests", () => {
  it("prefers Anthropic, then OpenAI, then OpenRouter", () => {
    expect(llmProvider({ openai: "a", anthropic: "b" })).toBe("anthropic");
    expect(llmProvider({ openrouter: "c" })).toBe("openrouter");
    expect(llmProvider({})).toBeNull();
  });
  it("builds chat requests per provider and reads replies", () => {
    const a = chatRequest("anthropic", { anthropic: "K" }, "sys", "hi");
    expect(a.url).toBe("https://api.anthropic.com/v1/messages");
    expect(a.headers["x-api-key"]).toBe("K");
    expect(JSON.parse(a.body!)).toMatchObject({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(chatText("anthropic", { content: [{ type: "text", text: "ok" }] })).toBe("ok");
    const o = chatRequest("openrouter", { openrouter: "R", llmModel: "x/y" }, "s", "u");
    expect(o.url).toContain("openrouter.ai");
    expect(o.headers.Authorization).toBe("Bearer R");
    expect(JSON.parse(o.body!).model).toBe("x/y");
    expect(chatText("openai", { choices: [{ message: { content: "yo" } }] })).toBe("yo");
    expect(() => chatText("openai", { error: { message: "bad key" } })).toThrow("bad key");
  });
  it("extracts JSON from chatty or fenced replies", () => {
    expect(extractJson('Sure! ```json\n[{"a": 1}]\n``` hope it helps')).toEqual([{ a: 1 }]);
    expect(extractJson('Here: {"t": "a } b", "n": [1,2]} done')).toEqual({ t: "a } b", n: [1, 2] });
    expect(() => extractJson("no data")).toThrow();
    expect(() => extractJson('[{"a": 1}')).toThrow("cut off");
  });
  it("builds image and voice requests", () => {
    const i = imageRequest("openai", { openai: "K" }, "cat", "portrait", true);
    expect(JSON.parse(i.body!)).toMatchObject({ size: "1024x1536", background: "transparent" });
    expect(imageResult("openai", { data: [{ b64_json: "AAA" }] })).toEqual({ b64: "AAA" });
    const f = imageRequest("fal", { fal: "F" }, "cat", "landscape");
    expect(f.url).toBe("https://fal.run/fal-ai/flux/schnell");
    expect(f.headers.Authorization).toBe("Key F");
    expect(imageResult("fal", { images: [{ url: "https://v3.fal.media/x.png" }] })).toEqual({ url: "https://v3.fal.media/x.png" });
    const e = speechRequest("elevenlabs", { elevenlabs: "E" }, "hi", "abc");
    expect(e.url).toContain("/text-to-speech/abc");
    expect(e.headers["xi-api-key"]).toBe("E");
    expect(JSON.parse(speechRequest("openai", { openai: "O" }, "hi", "", "calm").body!)).toMatchObject({ voice: "coral", instructions: "calm" });
  });
});

describe("transcript tools", () => {
  const words = [...say("Hello there everyone.", 0), ...say("This is the second sentence!", 2), ...say("after a long pause", 6)];
  it("splits sentences and times them", () => {
    const s = sentences(words);
    expect(s.map((x) => x.text)).toEqual(["Hello there everyone.", "This is the second sentence!", "after a long pause"]);
    expect(timedTranscript(s)).toMatch(/\[2\.0-(3\.9|4\.0)\] This is the second sentence!/);
  });
  it("parses clip ideas, publish kits, queries and translations defensively", () => {
    const ideas = parseClipIdeas([{ start: 5, end: 40, title: "A", hook: "h", score: 70, reason: "r" }, { start: 50, end: 52 }, { start: "x" }, { start: 10, end: 999, score: 90 }], 100);
    expect(ideas.map((x) => x.score)).toEqual([90, 70]);
    expect(ideas[0].end).toBe(100);
    expect(parseClipIdeas({ clips: [{ start: 1, end: 9, score: 5 }] }, 10)).toHaveLength(1);
    expect(parsePublishKit({ titles: ["t"], hashtags: ["#a b", "c"] }).hashtags).toEqual(["ab", "c"]);
    expect(parseQueries([{ id: 0, query: "aerial mountains" }, { id: "x" }]).get(0)).toBe("aerial mountains");
    expect(() => parseTranslation(["a"], 2)).toThrow();
    const w = respread("hola a todos", 1, 2);
    expect(w).toHaveLength(3);
    expect(w[0].start).toBe(1);
    expect(w[2].end).toBeCloseTo(2, 2);
  });
});

describe("thumbnail, brand, faces", () => {
  const frame = (fill: (x: number, y: number) => number, t = 0) => {
    const w = 32, h = 18;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.fill(fill(x, y), (y * w + x) * 3, (y * w + x) * 3 + 3);
    return { t, width: w, height: h, rgb };
  };
  it("scores detailed frames above flat ones", () => {
    const flat = frame(() => 120);
    const busy = frame((x, y) => ((x + y) % 2 ? 200 : 40));
    expect(frameScore(busy)).toBeGreaterThan(frameScore(flat));
    expect(bestFrame([flat, flat, busy, flat, flat, flat, flat])).toBe(2);
    expect(wrapWords("I QUIT MY JOB TO TRAVEL THE WORLD", 12, 3)).toEqual(["I QUIT MY", "JOB TO", "TRAVEL THE WORLD"]);
  });
  it("applies brand colours and places the logo in a safe corner", () => {
    let p: Project = createProject();
    p = brandProject(p, { ...DEFAULT_BRAND, font: "Bangers", primary: "#111111", accent: "#ff0000" });
    expect(p.captionSettings.brand).toEqual({ font: "Bangers", color: "#111111", highlight: "#ff0000" });
    const pos = cornerPos("bottom-left", 0.1, 1920, 1080);
    expect(pos.x).toBeCloseTo(0.09);
    expect(pos.y).toBeLessThan(1);
  });
  it("holds faces through short detection gaps", () => {
    const f = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    expect(holdFaces([[f], [], [], [], [], [f]], 3).map((x) => x.length)).toEqual([1, 1, 1, 1, 0, 1]);
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

describe.skipIf(!hasFfmpeg)("real ffmpeg: face blur, enhance, smooth slow-mo, studio voice", () => {
  const dir = mkdtempSync(join(tmpdir(), "clipmaster-ai-"));
  const src = join(dir, "src.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x64:r=24:d=2", "-f", "lavfi", "-i", "anoisesrc=d=2:a=0.3", "-shortest", "-pix_fmt", "yuv420p", src]);
  const mask = join(dir, "mask.mkv");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=12:d=2,drawbox=x=0:y=0:w=16:h=32:color=white:t=fill,format=gray", "-c:v", "ffv1", mask]);
  const project = (patch: Partial<MediaClip>) => {
    let p: Project = createProject();
    p = { ...p, settings: { width: 64, height: 64, fps: 24 } };
    p = addAsset(p, { id: "a", path: src, name: "a", kind: "video", duration: 2, width: 64, height: 64, hasAudio: true });
    const r = placeAsset(p, "a", "t_v1");
    return updateClip(r.project, r.clipId!, patch);
  };
  const render = (p: Project, name: string, voiceModel?: string) => {
    const out = join(dir, `out_${name}.mp4`);
    const plan = buildExportPlan(p, { outputPath: out, tempDir: dir, quality: "draft", voiceModel });
    for (const f of plan.files) writeFileSync(f.path, f.content);
    execFileSync("ffmpeg", plan.args, { stdio: "pipe" });
    return out;
  };
  const edges = (file: string, x0: number, x1: number) => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    let e = 0;
    for (let y = 1; y < 63; y++) for (let x = x0 + 1; x < x1 - 1; x++) e += Math.abs(raw[y * 64 + x] - raw[y * 64 + x + 1]);
    return e;
  };
  it("blurs only where the face mask is", () => {
    const plain = render(project({}), "plain");
    const blurred = render(project({ faceMask: { path: mask, start: 0, fps: 12 } }), "faces");
    expect(edges(blurred, 0, 30)).toBeLessThan(edges(plain, 0, 30) * 0.7);
    expect(edges(blurred, 36, 64)).toBeGreaterThan(edges(plain, 36, 64) * 0.8);
  });
  it("renders enhance and smooth slow motion", () => {
    expect(existsSync(render(project({ enhance: true }), "enhance"))).toBe(true);
    const plan = buildExportPlan(project({ enhance: true }), { outputPath: "x.mp4", tempDir: dir, quality: "draft" });
    expect(plan.args[plan.args.indexOf("-filter_complex") + 1].startsWith("sws_flags=lanczos")).toBe(true);
    expect(existsSync(render(project({ speed: 0.5, smoothSlow: true }), "slow"))).toBe(true);
  });
  it.skipIf(!existsSync("/tmp/clipmaster-test-sh.rnnn"))("runs RNNoise for studio voice", () => {
    const p = project({ studioVoice: true });
    const plan = buildExportPlan(p, { outputPath: "x.mp4", tempDir: dir, quality: "draft", voiceModel: "/tmp/clipmaster-test-sh.rnnn" });
    expect(plan.args.join(" ")).toContain("arnndn=m=");
    expect(existsSync(render(p, "voice", "/tmp/clipmaster-test-sh.rnnn"))).toBe(true);
  });
});
