/**
 * Pre-render effect thumbnails from src/assets/preview.jpg with the real
 * export filters, so the Effects panel shows exactly what each effect does.
 * Run after changing effects or the preview image:  npm run previews
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { EFFECTS } from "../src/core/effects";
import { buildTextAss, TEXT_PRESETS } from "../src/core/textPresets";

const W = 320;
const H = 180;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src/assets/preview.jpg");
const out = join(root, "src/assets/fx");
mkdirSync(out, { recursive: true });

const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
for (const e of EFFECTS) {
  // Motion effects are sampled mid-way so the zoom/pan is visible.
  const f = e.filter(0.8, { W, H, fps: 30, duration: 2 });
  const vf = e.category === "motion" ? `${base},loop=loop=60:size=1,fps=30,${f},trim=start=1` : `${base},${f}`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "4", join(out, `${e.id}.jpg`)]);
  process.stdout.write(`${e.id} `);
}
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", base, "-frames:v", "1", "-q:v", "4", join(out, "_original.jpg")]);

// Text templates: rendered mid-animation over the preview image with libass.
const TW = 640;
const TH = 360;
const fonts = join(root, "src-tauri/fonts");
const tbase = `scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},setsar=1`;
for (const p of TEXT_PRESETS) {
  const clip = { id: "c", type: "text" as const, trackId: "t", start: 0, duration: 3, text: p.sample, x: p.x, y: p.y, fontSize: Math.round(p.size * TH), color: p.color, accent: p.accent, box: false, preset: p.id };
  const ass = join(out, `_tmp.ass`);
  writeFileSync(ass, buildTextAss([clip], TW, TH, TH)!);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-t", "3", "-i", src, "-vf", `${tbase},ass=${ass}:fontsdir=${fonts},scale=${W}:${H}`,
    "-ss", "1.6", "-frames:v", "1", "-q:v", "4", join(out, `text-${p.id}.jpg`)]);
  process.stdout.write(`text-${p.id} `);
}
execFileSync("rm", ["-f", join(out, "_tmp.ass")]);
console.log("\ndone");
