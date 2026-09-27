/**
 * Pre-render effect thumbnails from src/assets/preview.jpg with the real
 * export filters, so the Effects panel shows exactly what each effect does.
 * Run after changing effects or the preview image:  npm run previews
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECTS } from "../src/core/effects";

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
console.log("\ndone");
