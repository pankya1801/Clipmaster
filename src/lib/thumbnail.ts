/** Thumbnail maker: best frame + optional cut-out + big text → 1280×720 PNG. */
import { sampleSize, unpackFrames } from "../core/reframe";
import { bestFrame, ThumbLayout, wrapWords } from "../core/thumbnail";
import type { MediaClip } from "../core/types";
import { clipEnd } from "../core/project";
import { sourceTimeAt } from "../core/speed";
import { useEditor } from "../store";
import { invoke, isTauri, saveDialog } from "./backend";
import { mediapipeFiles } from "./pro";

const S = () => useEditor.getState();
export const THUMB_W = 1280;
export const THUMB_H = 720;

export interface ThumbOptions {
  text: string;
  layout: ThumbLayout;
  color: string;
  accent: string;
  font: string;
  cutout: boolean;
  /** Darken + blur the background behind a cut-out subject. */
  dim: number;
}

function videoClips(): MediaClip[] {
  const p = S().project;
  return Object.values(p.clips).filter((c): c is MediaClip => c.type === "media" && p.assets[c.assetId]?.kind === "video").sort((a, b) => a.start - b.start);
}

async function frameAt(path: string, t: number, w: number, h: number): Promise<ImageData> {
  const b64 = await invoke<string>("sample_frames", { path, start: Math.max(0, t), end: t + 0.2, fps: 5, width: w, height: h });
  const rgb = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const img = new ImageData(w, h);
  for (let k = 0, p = 0; k < w * h; k++, p += 3) {
    img.data[k * 4] = rgb[p];
    img.data[k * 4 + 1] = rgb[p + 1];
    img.data[k * 4 + 2] = rgb[p + 2];
    img.data[k * 4 + 3] = 255;
  }
  return img;
}

/** A frame for the thumbnail: the best-looking one, or the one under the playhead. */
export async function grabFrame(mode: "best" | "playhead", onProgress: (m: string) => void): Promise<HTMLCanvasElement> {
  if (!isTauri) throw new Error("The thumbnail maker needs the desktop app.");
  const clips = videoClips();
  if (!clips.length) throw new Error("Add a video clip first.");
  const p = S().project;
  let clip = clips[0];
  let src = clip.in;
  if (mode === "playhead") {
    const t = S().playhead;
    clip = clips.find((c) => c.start <= t && clipEnd(c) > t) ?? clips[0];
    src = sourceTimeAt(clip, Math.max(0, t - clip.start));
  } else {
    onProgress("Finding the best frame…");
    let best = -Infinity;
    for (const c of clips.slice(0, 6)) {
      const a = p.assets[c.assetId];
      const size = sampleSize(a.width, a.height, 160);
      const fps = Math.min(4, 40 / Math.max(1, c.out - c.in));
      const b64 = await invoke<string>("sample_frames", { path: a.path, start: c.in, end: c.out, fps, ...size });
      const frames = unpackFrames(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), size.width, size.height, c.in, fps);
      const i = bestFrame(frames);
      if (i < 0) continue;
      const { frameScore } = await import("../core/thumbnail");
      const s = frameScore(frames[i]);
      if (s > best) {
        best = s;
        clip = c;
        src = frames[i].t;
      }
    }
  }
  const a = p.assets[clip.assetId];
  // Cover-crop to 16:9 at full thumbnail size.
  const aw = a.width ?? 1920;
  const ah = a.height ?? 1080;
  const k = Math.max(THUMB_W / aw, THUMB_H / ah);
  const w = Math.round((aw * k) / 2) * 2;
  const h = Math.round((ah * k) / 2) * 2;
  onProgress("Grabbing the frame…");
  const img = await frameAt(a.path, src, w, h);
  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  c.getContext("2d")!.drawImage(tmp, (THUMB_W - w) / 2, (THUMB_H - h) / 2);
  return c;
}

/** Person mask for a frame (white = person), via the offline cut-out model. */
export async function subjectMask(frame: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const files = await mediapipeFiles();
  const mod: any = await import("@mediapipe/selfie_segmentation"); // eslint-disable-line @typescript-eslint/no-explicit-any
  const SelfieSegmentation = mod.SelfieSegmentation ?? mod.default?.SelfieSegmentation ?? (globalThis as any).SelfieSegmentation; // eslint-disable-line @typescript-eslint/no-explicit-any
  const seg = new SelfieSegmentation({ locateFile: (f: string) => files[f] ?? f });
  seg.setOptions({ modelSelection: 1 });
  const mask = document.createElement("canvas");
  mask.width = frame.width;
  mask.height = frame.height;
  await new Promise<void>((res) => {
    seg.onResults((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      mask.getContext("2d")!.drawImage(r.segmentationMask, 0, 0, mask.width, mask.height);
      res();
    });
    seg.send({ image: frame });
  });
  seg.close?.();
  return mask;
}

/** Draw the thumbnail onto `out` (1280×720). */
export function composeThumbnail(out: HTMLCanvasElement, frame: HTMLCanvasElement, mask: HTMLCanvasElement | null, o: ThumbOptions) {
  out.width = THUMB_W;
  out.height = THUMB_H;
  const g = out.getContext("2d")!;
  g.save();
  if (mask) g.filter = `blur(${Math.round(o.dim * 14)}px) brightness(${1 - o.dim * 0.55})`;
  g.drawImage(frame, -20, -20, THUMB_W + 40, THUMB_H + 40);
  g.restore();
  if (mask) {
    // Cut out the subject: frame masked by the person mask, with a white outline.
    const cut = document.createElement("canvas");
    cut.width = THUMB_W;
    cut.height = THUMB_H;
    const cg = cut.getContext("2d")!;
    cg.drawImage(mask, 0, 0, THUMB_W, THUMB_H);
    // Mask: MediaPipe draws the person in red/alpha; turn it into alpha.
    const md = cg.getImageData(0, 0, THUMB_W, THUMB_H);
    for (let i = 0; i < md.data.length; i += 4) {
      const a = Math.max(md.data[i], md.data[i + 3] && !md.data[i + 1] && !md.data[i] ? md.data[i + 3] : 0);
      md.data[i] = md.data[i + 1] = md.data[i + 2] = 255;
      md.data[i + 3] = a > 110 ? 255 : a * 1.5;
    }
    cg.putImageData(md, 0, 0);
    const outline = document.createElement("canvas");
    outline.width = THUMB_W;
    outline.height = THUMB_H;
    const og = outline.getContext("2d")!;
    for (let a = 0; a < 16; a++) og.drawImage(cut, Math.cos((a / 16) * Math.PI * 2) * 7, Math.sin((a / 16) * Math.PI * 2) * 7);
    g.save();
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = 30;
    g.drawImage(outline, 0, 0);
    g.restore();
    cg.globalCompositeOperation = "source-in";
    cg.drawImage(frame, 0, 0);
    g.save();
    g.filter = "contrast(1.08) saturate(1.15)";
    g.drawImage(cut, 0, 0);
    g.restore();
  }
  if (!o.text.trim()) return;
  const text = o.text.toUpperCase();
  const side = o.layout === "left" || o.layout === "right";
  const lines = wrapWords(text, side ? 12 : o.layout === "bottom" ? 26 : 16, side ? 4 : 2);
  const maxW = side ? THUMB_W * 0.5 : THUMB_W * 0.9;
  let size = o.layout === "bottom" ? 110 : 160;
  const font = (s: number) => `${s}px "${o.font}", Impact, sans-serif`;
  g.font = font(size);
  while (size > 40 && (Math.max(...lines.map((l) => g.measureText(l).width)) > maxW || lines.length * size * 1.02 > THUMB_H * (side ? 0.8 : 0.5))) {
    size -= 4;
    g.font = font(size);
  }
  const lh = size * 1.02;
  const blockH = lines.length * lh;
  g.textBaseline = "top";
  g.lineJoin = "round";
  let x = THUMB_W / 2;
  let y = (THUMB_H - blockH) / 2;
  g.textAlign = "center";
  if (o.layout === "left") (g.textAlign = "left"), (x = 48);
  if (o.layout === "right") (g.textAlign = "right"), (x = THUMB_W - 48);
  if (o.layout === "bottom") {
    y = THUMB_H - blockH - 44;
    g.fillStyle = o.accent;
    g.fillRect(0, y - 22, THUMB_W, blockH + 44);
  }
  lines.forEach((l, i) => {
    const ly = y + i * lh;
    g.lineWidth = size * 0.16;
    g.strokeStyle = "#000";
    g.strokeText(l, x, ly);
    // Accent on the last line, like popular thumbnails.
    g.fillStyle = i === lines.length - 1 && lines.length > 1 && o.layout !== "bottom" ? o.accent : o.color;
    g.fillText(l, x, ly);
  });
}

export async function saveThumbnail(canvas: HTMLCanvasElement): Promise<string> {
  const path = await saveDialog(`${S().project.name}-thumbnail.png`, "png", "PNG image");
  if (!path) return "";
  await invoke("write_binary_file", { path, dataBase64: canvas.toDataURL("image/png").split(",")[1] });
  return `Thumbnail saved to ${path}`;
}
