/**
 * v0.4 "pro" actions: speed ramps, freeze / reverse, stabilise, chroma key,
 * LUTs, background removal, text to speech, sound library, beat markers,
 * caption translation, motion tracking and shareable templates.
 */
import { soundById, soundRenderArgs } from "../core/audiolib";
import { detectBeats, findMusicClip } from "../core/beats";
import { addAsset, addTrack, clipEnd, clipsOnTrack, placeAsset, splitClip, updateClip, uid } from "../core/project";
import { sampleSize, unpackFrames } from "../core/reframe";
import { fillTemplate, isTemplate, makeTemplate, ShareTemplate } from "../core/sharing";
import { RAMP_PRESETS, sourceTimeAt } from "../core/speed";
import { shiftAll } from "../core/templates";
import { followKeyframes, trackPoint } from "../core/tracking";
import type { MediaAsset, MediaClip, Project } from "../core/types";
import { useEditor } from "../store";
import { errorText } from "./actions";
import { invoke, isTauri, openDialog, probe, saveDialog, thumbnail } from "./backend";

const S = () => useEditor.getState();

function selectedMedia(): MediaClip | undefined {
  const { project, selected, playhead } = S();
  const sel = selected.map((id) => project.clips[id]).find((c): c is MediaClip => c?.type === "media");
  if (sel) return sel;
  // Otherwise the video clip under the playhead on the lowest video track.
  const under = Object.values(project.clips).filter(
    (c): c is MediaClip => c.type === "media" && project.assets[c.assetId]?.kind === "video" && c.start <= playhead && clipEnd(c) > playhead
  );
  return under[under.length - 1];
}

function needClip(): MediaClip {
  const c = selectedMedia();
  if (!c) throw new Error("Select a video clip first.");
  return c;
}

async function importPath(path: string, name: string): Promise<MediaAsset> {
  const info = await probe(path, name);
  const asset: MediaAsset = { id: uid("a"), path, name, ...info };
  S().commit((p) => addAsset(p, asset));
  thumbnail(asset.path, asset.kind, Math.min(1, asset.duration / 2)).then((url) => S().setThumb(asset.id, url));
  return asset;
}

/** Put an audio asset on a free audio track at the playhead. */
function placeAudio(assetId: string, at = S().playhead) {
  let p = S().project;
  const free = p.tracks.find(
    (t) => t.kind === "audio" && !clipsOnTrack(p, t.id).some((c) => c.start < at + (p.assets[assetId]?.duration ?? 1) && clipEnd(c) > at)
  );
  let trackId = free?.id;
  if (!trackId) {
    const before = new Set(p.tracks.map((t) => t.id));
    p = addTrack(p, "audio");
    trackId = p.tracks.find((t) => !before.has(t.id))!.id;
  }
  const r = placeAsset(p, assetId, trackId, at);
  if (r.clipId) {
    S().commit(() => r.project);
    S().select([r.clipId]);
  }
}

// ---------- speed ramps, freeze, reverse ----------

export function setRamp(presetId: string | null): string {
  const c = needClip();
  const preset = RAMP_PRESETS.find((r) => r.id === presetId);
  S().commit((p) => updateClip(p, c.id, { ramp: preset?.points, reverse: preset ? false : c.reverse, freeze: false }));
  return preset ? `${preset.name} speed ramp applied (sound is muted on ramped clips).` : "Speed ramp removed.";
}

export function toggleReverse(): string {
  const c = needClip();
  S().commit((p) => updateClip(p, c.id, { reverse: !c.reverse, ramp: undefined, freeze: false }));
  return c.reverse ? "Reverse off." : "Clip plays backwards.";
}

/** Insert a freeze frame of `seconds` at the playhead, pushing later clips on that track. */
export function freezeFrame(seconds = 2): string {
  const c = needClip();
  const { playhead } = S();
  if (playhead <= c.start || playhead >= clipEnd(c)) throw new Error("Move the playhead over the clip to freeze.");
  const src = sourceTimeAt(c, playhead - c.start);
  let p = S().project;
  const split = splitClip(p, c.id, playhead);
  p = split.project;
  // Push everything after the playhead on this track.
  const later = clipsOnTrack(p, c.trackId).filter((x) => x.start >= playhead - 1e-6);
  for (const x of later) p = { ...p, clips: { ...p.clips, [x.id]: { ...x, start: x.start + seconds } } };
  const id = uid("c");
  const frozen: MediaClip = { ...c, id, start: playhead, in: src, out: src + seconds * c.speed, freeze: true, ramp: undefined, reverse: false };
  p = { ...p, clips: { ...p.clips, [id]: frozen } };
  S().commit(() => p);
  S().select([id]);
  return `Added a ${seconds}s freeze frame.`;
}

// ---------- look: stabilise, chroma key, LUT ----------

export function patchSelected(patch: Partial<MediaClip>) {
  const c = needClip();
  S().commit((p) => updateClip(p, c.id, patch));
}

export async function importLut(): Promise<string> {
  const c = needClip();
  if (!isTauri) throw new Error("LUT import needs the desktop app.");
  const path = await openDialog("cube", "3D LUT (.cube)");
  if (!path) return "";
  const name = path.split(/[\\/]/).pop()!.replace(/\.cube$/i, "");
  S().commit((p) => updateClip(p, c.id, { lut: { path, name, amount: 1 } }));
  return `LUT “${name}” applied (shows on export).`;
}

// ---------- background removal ----------

/** Asset URLs for MediaPipe's offline selfie segmentation (bundled by Vite). */
async function mediapipeFiles(): Promise<Record<string, string>> {
  const base = "@mediapipe/selfie_segmentation/";
  const m = await Promise.all([
    import("@mediapipe/selfie_segmentation/selfie_segmentation.binarypb?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation.tflite?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_landscape.tflite?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.js?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.wasm?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.data?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.js?url"),
    import("@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.wasm?url"),
  ]);
  const names = [
    "selfie_segmentation.binarypb",
    "selfie_segmentation.tflite",
    "selfie_segmentation_landscape.tflite",
    "selfie_segmentation_solution_simd_wasm_bin.js",
    "selfie_segmentation_solution_simd_wasm_bin.wasm",
    "selfie_segmentation_solution_simd_wasm_bin.data",
    "selfie_segmentation_solution_wasm_bin.js",
    "selfie_segmentation_solution_wasm_bin.wasm",
  ];
  void base;
  return Object.fromEntries(names.map((n, i) => [n, m[i].default]));
}

/**
 * Cut the person out of a video clip (no green screen). Runs MediaPipe
 * selfie segmentation on the computer, then saves the mask as a small video
 * that the export uses as the clip's transparency.
 */
export async function removeBackground(onProgress: (msg: string) => void): Promise<string> {
  const c = needClip();
  if (!isTauri) throw new Error("Background removal needs the desktop app.");
  const asset = S().project.assets[c.assetId];
  if (asset.kind !== "video") throw new Error("Background removal works on video clips.");
  onProgress("Loading the cut-out model…");
  const files = await mediapipeFiles();
  // The package is a closure-compiled script: depending on the bundler it
  // shows up as a named export, on the default export, or as a global.
  const mod: any = await import("@mediapipe/selfie_segmentation");
  const SelfieSegmentation = mod.SelfieSegmentation ?? mod.default?.SelfieSegmentation ?? (globalThis as any).SelfieSegmentation;
  if (!SelfieSegmentation) throw new Error("Could not load the cut-out model.");
  const seg = new SelfieSegmentation({ locateFile: (f: string) => files[f] ?? f });
  seg.setOptions({ modelSelection: 1, selfieMode: false });

  const fps = Math.min(15, 600 / Math.max(0.5, c.out - c.in));
  const { width, height } = sampleSize(asset.width, asset.height, 256);
  onProgress("Reading frames…");
  const b64 = await invoke<string>("sample_frames", { path: asset.path, start: c.in, end: c.out, fps, width, height });
  const frames = unpackFrames(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), width, height, c.in, fps);

  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const sctx = src.getContext("2d")!;
  const dst = document.createElement("canvas");
  dst.width = width;
  dst.height = height;
  const dctx = dst.getContext("2d", { willReadFrequently: true })!;
  const out = new Uint8Array(width * height * frames.length);
  let resolveFrame: () => void = () => {};
  seg.onResults((r: any) => {
    dctx.clearRect(0, 0, width, height);
    dctx.drawImage(r.segmentationMask, 0, 0, width, height);
    resolveFrame();
  });
  const img = sctx.createImageData(width, height);
  for (const [i, f] of frames.entries()) {
    if (i % 10 === 0) onProgress(`Cutting out the subject (${Math.round((i / frames.length) * 100)}%)…`);
    for (let k = 0, p = 0; k < width * height; k++, p += 3) {
      img.data[k * 4] = f.rgb[p];
      img.data[k * 4 + 1] = f.rgb[p + 1];
      img.data[k * 4 + 2] = f.rgb[p + 2];
      img.data[k * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    await new Promise<void>((res) => {
      resolveFrame = res;
      seg.send({ image: src });
    });
    const px = dctx.getImageData(0, 0, width, height).data;
    // The mask is in the red (and alpha) channel; use the stronger one.
    for (let k = 0; k < width * height; k++) out[i * width * height + k] = Math.max(px[k * 4], px[k * 4 + 3] > 0 && px[k * 4] === 0 && px[k * 4 + 1] === 0 ? px[k * 4 + 3] : 0);
  }
  seg.close?.();
  onProgress("Saving the mask…");
  let bin = "";
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  const stamp = Date.now();
  const raw = await invoke<string>("write_temp_file", { name: `mask_${stamp}.gray`, dataBase64: btoa(bin) });
  const mask = raw.replace(/\.gray$/, ".mkv");
  await invoke("run_ffmpeg", {
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${width}x${height}`, "-r", String(fps), "-i", raw, "-vf", "gblur=sigma=1", "-c:v", "ffv1", mask],
  });
  S().commit((p) => updateClip(p, c.id, { bgMask: { path: mask, start: c.in, fps } }));
  return "Background removed (shows on export). Put a background or another clip on a lower track.";
}

// ---------- voice & sounds ----------

export async function textToSpeech(text: string, voice: string, rate: number): Promise<string> {
  if (!isTauri) throw new Error("Text to speech needs the desktop app.");
  if (!text.trim()) throw new Error("Type something to say.");
  const dir = await invoke<string>("temp_dir");
  const out = `${dir}/clipmaster_voice_${Date.now()}.wav`;
  await invoke("speak", { text, voice: voice || null, rate, out });
  const asset = await importPath(out, `Voice: ${text.slice(0, 24)}`);
  placeAudio(asset.id);
  return "Voiceover added at the playhead.";
}

export async function addSound(id: string): Promise<string> {
  const s = soundById(id);
  if (!s) return "";
  if (!isTauri) throw new Error("The sound library needs the desktop app.");
  let asset = Object.values(S().project.assets).find((a) => a.name === `♪ ${s.name}`);
  if (!asset) {
    const dir = await invoke<string>("temp_dir");
    const out = `${dir}/clipmaster_sound_${s.id}.wav`;
    await invoke("run_ffmpeg", { args: soundRenderArgs(s, out) });
    asset = await importPath(out, `♪ ${s.name}`);
  }
  placeAudio(asset.id);
  return `${s.name} added.`;
}

// ---------- beat markers ----------

export async function detectBeatMarkers(): Promise<string> {
  if (!isTauri) throw new Error("Beat detection needs the desktop app.");
  const { project } = S();
  const music = findMusicClip(project);
  if (!music) throw new Error("Add a music track on an audio track first.");
  const asset = project.assets[music.assetId];
  const env = await invoke<number[]>("audio_envelope", { path: asset.path, start: music.in, end: music.out });
  const { bpm, beats } = detectBeats(env);
  if (!beats.length) throw new Error("Couldn't find a beat in that track.");
  const markers = beats.map((b) => Math.round((music.start + b / music.speed) * 1000) / 1000).filter((t) => t <= clipEnd(music));
  S().commit((p) => ({ ...p, markers }));
  return `Marked ${markers.length} beats (${bpm} BPM). Clips snap to them.`;
}

export function clearMarkers() {
  S().commit((p) => ({ ...p, markers: [] }));
}

export function addMarkerAtPlayhead() {
  const t = Math.round(S().playhead * 1000) / 1000;
  S().commit((p) => ({ ...p, markers: [...(p.markers ?? []), t].sort((a, b) => a - b) }));
}

// ---------- motion tracking ----------

/**
 * Make the selected sticker / text / overlay follow what's under it in the
 * video below.
 */
export async function trackSelected(onProgress: (msg: string) => void): Promise<string> {
  if (!isTauri) throw new Error("Motion tracking needs the desktop app.");
  const { project, selected } = S();
  const overlay = project.clips[selected[0]];
  if (!overlay || overlay.type !== "media") throw new Error("Select the sticker or overlay clip that should follow something.");
  const kf = overlay.keyframes?.[0];
  const { t: _t, ...first } = kf ?? { t: 0 };
  void _t;
  const base = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, ...overlay.transform, ...first };
  const at = overlay.start;
  const target = Object.values(project.clips).find(
    (c): c is MediaClip => c.id !== overlay.id && c.type === "media" && project.assets[c.assetId]?.kind === "video" && c.start <= at + 1e-6 && clipEnd(c) > at
  );
  if (!target) throw new Error("There's no video under this clip to track.");
  const asset = project.assets[target.assetId];
  const from = sourceTimeAt(target, at - target.start);
  const until = sourceTimeAt(target, Math.min(clipEnd(overlay), clipEnd(target)) - target.start);
  onProgress("Tracking motion…");
  const size = sampleSize(asset.width, asset.height, 160);
  const fps = 10;
  const b64 = await invoke<string>("sample_frames", { path: asset.path, start: from, end: until, fps, ...size });
  const frames = unpackFrames(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), size.width, size.height, from, fps);
  const track = trackPoint(frames, base.x, base.y);
  const keys = followKeyframes(track, base, from, clipEnd(overlay) - overlay.start, target.speed);
  if (keys.length < 2) throw new Error("Not enough video to track.");
  S().commit((p) => updateClip(p, overlay.id, { keyframes: keys }));
  return `Tracked ${track.length} frames — the clip now follows the motion.`;
}

// ---------- templates ----------

export async function saveAsTemplate(): Promise<string> {
  const { project } = S();
  const t = makeTemplate(project);
  if (!t.slots.length) throw new Error("Add some of your own clips first.");
  const text = JSON.stringify(t, null, 2);
  const path = await saveDialog(`${project.name}.cmtemplate`, "cmtemplate", "Clipmaster template");
  if (path) await invoke("write_text_file", { path, content: text });
  else if (!isTauri) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = `${project.name}.cmtemplate`;
    a.click();
  } else return "";
  return `Template saved with ${t.slots.length} slot${t.slots.length > 1 ? "s" : ""}. Share the file — it has no media.`;
}

export async function openTemplate(): Promise<ShareTemplate | null> {
  const path = await openDialog("cmtemplate", "Clipmaster template");
  if (!path) return null;
  const raw = JSON.parse(await invoke<string>("read_text_file", { path }));
  if (!isTemplate(raw)) throw new Error("That file isn't a Clipmaster template.");
  return raw;
}

/** Fill template slots with the given assets (slot id → asset id in the current project). */
export function applyShareTemplate(t: ShareTemplate, picks: Record<string, string>): string {
  const { project } = S();
  const media = Object.fromEntries(Object.entries(picks).flatMap(([slot, id]) => (project.assets[id] ? [[slot, project.assets[id]]] : [])));
  const r = fillTemplate(t, media);
  const assets = { ...project.assets, ...r.project.assets };
  S().commit(() => ({ ...r.project, name: project.name, assets }));
  return r.missing.length ? `Template applied. Empty slots skipped: ${r.missing.join(", ")}.` : "Template applied.";
}

// ---------- text-based editing ----------

/** Delete the chosen caption words (indexes) and the video under them. */
export async function deleteWords(indexes: number[]): Promise<string> {
  const { project } = S();
  if (!indexes.length) return "";
  const { cutTimeline } = await import("../core/smartcut");
  const ranges = indexes.map((i) => project.captions[i]).filter(Boolean).map((w) => ({ start: w.start, end: w.end }));
  const r = cutTimeline(project, ranges);
  S().commit(() => r.project);
  return `Cut ${indexes.length} word${indexes.length > 1 ? "s" : ""} (${r.removed.toFixed(1)}s).`;
}

export { errorText, shiftAll };
export type { Project };
