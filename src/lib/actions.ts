import { applyAutoEdit, AutoEditOptions, mainTrackId, parseSilenceDetect, Range } from "../core/autoedit";
import { applyAutoZoom } from "../core/autozoom";
import { beatSyncMontage, detectBeats, findMusicClip, MontageOptions } from "../core/beats";
import { parseSrt, toSrt } from "../core/captions";
import {
  addAsset, addText, clipEnd, updateClip, DEFAULT_IMAGE_SECONDS, clipsOnTrack, createProject, deleteClips, duplicateClip, placeAsset, splitClip, trackAccepts, addTrack, uid,
} from "../core/project";
import { addBroll, cutTimeline, FILLER_PROMPT, findFillers, keepOnly, pickHighlight } from "../core/smartcut";
import { applyTemplate } from "../core/templates";
import { ensureGeneratorAsset, generatorById, introById, stickerById, stickerKeyframes } from "../core/visuals";
import { renderSticker } from "./stickers";
import { FitMode, FocusPoint, locateSubject, sampleSize, smoothPath, unpackFrames } from "../core/reframe";
import type { CaptionWord, MediaAsset, MediaClip, Project } from "../core/types";
import { useEditor } from "../store";
import { invoke, isTauri, openDialog, pickMediaFiles, probe, saveDialog, thumbnail } from "./backend";

export const notify = (msg: string) => window.dispatchEvent(new CustomEvent("cm-toast", { detail: msg }));

const S = () => useEditor.getState();

export async function importMedia() {
  const files = await pickMediaFiles();
  for (const f of files) {
    try {
      const info = await probe(f.path, f.name);
      const asset: MediaAsset = { id: uid("a"), path: f.path, name: f.name, ...info };
      S().commit((p) => addAsset(p, asset));
      thumbnail(asset.path, asset.kind, Math.min(1, asset.duration / 2)).then((url) => S().setThumb(asset.id, url));
    } catch (e) {
      notify(`Could not import ${f.name}: ${errorText(e)}`);
    }
  }
}

/** Add an asset to the timeline: on the given track, or the first compatible one. */
export function addAssetToTimeline(assetId: string, trackId?: string, at?: number) {
  const { project } = S();
  const asset = project.assets[assetId];
  if (!asset) return;
  let p = project;
  let target = trackId && p.tracks.find((t) => t.id === trackId && trackAccepts(t.kind, { type: "media", assetKind: asset.kind }));
  if (!target) target = p.tracks.find((t) => trackAccepts(t.kind, { type: "media", assetKind: asset.kind }) && (asset.kind !== "video" || t.kind === "video"));
  if (!target) {
    p = addTrack(p, asset.kind === "audio" ? "audio" : "video");
    target = p.tracks.find((t) => trackAccepts(t.kind, { type: "media", assetKind: asset.kind }))!;
  }
  const r = placeAsset(p, assetId, target.id, at);
  if (r.clipId) {
    S().commit(() => r.project);
    S().select([r.clipId]);
  }
}

export function addTextAtPlayhead(text?: string, presetId?: string) {
  const { project, playhead } = S();
  let p = project;
  let track = p.tracks.find((t) => t.kind === "text");
  if (!track) {
    p = addTrack(p, "text");
    track = p.tracks.find((t) => t.kind === "text")!;
  }
  const r = addText(p, track.id, playhead, text, presetId);
  if (r.clipId) {
    S().commit(() => r.project);
    S().select([r.clipId]);
  }
}

export function splitAtPlayhead() {
  const { project, playhead, selected } = S();
  const targets = Object.values(project.clips).filter(
    (c) => (selected.length === 0 || selected.includes(c.id)) && playhead > c.start && playhead < clipEnd(c)
  );
  if (!targets.length) return;
  S().commit((p) => targets.reduce((acc, c) => splitClip(acc, c.id, playhead).project, p));
}

export function deleteSelected(ripple = false) {
  const { selected } = S();
  if (!selected.length) return;
  S().commit((p) => deleteClips(p, selected, ripple));
  S().select([]);
}

export function duplicateSelected() {
  const { selected } = S();
  if (selected.length !== 1) return;
  let newId: string | undefined;
  S().commit((p) => {
    const r = duplicateClip(p, selected[0]);
    newId = r.clipId;
    return r.project;
  });
  if (newId) S().select([newId]);
}

// ---------- project files ----------

const PROJECT_EXT = "clipmaster";

export function newProject() {
  if (S().dirty && !confirm("Discard unsaved changes?")) return;
  S().load(createProject(), null);
}

export async function saveProject(saveAs = false) {
  const { project, projectPath } = S();
  let path = projectPath;
  if (!path || saveAs) path = await saveDialog(`${project.name}.${PROJECT_EXT}`, PROJECT_EXT, "Clipmaster project");
  if (!path) {
    if (!isTauri) downloadText(`${project.name}.${PROJECT_EXT}`, JSON.stringify(project, null, 2));
    return;
  }
  const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  const data = { ...project, name };
  await invoke("write_text_file", { path, content: JSON.stringify(data, null, 2) });
  S().replace(data);
  S().markSaved(path);
  notify("Project saved");
}

export async function openProject() {
  if (S().dirty && !confirm("Discard unsaved changes?")) return;
  const path = await openDialog(PROJECT_EXT, "Clipmaster project");
  if (!path) return;
  try {
    const p = migrate(JSON.parse(await invoke<string>("read_text_file", { path })));
    S().load(p, path);
    for (const a of Object.values(p.assets)) thumbnail(a.path, a.kind, Math.min(1, a.duration / 2)).then((u) => S().setThumb(a.id, u));
  } catch (e) {
    notify(`Could not open project: ${errorText(e)}`);
  }
}

export function migrate(raw: any): Project {
  const base = createProject();
  const p: Project = { ...base, ...raw, settings: { ...base.settings, ...raw.settings } };
  p.captions ??= [];
  p.captionSettings ??= base.captionSettings;
  for (const c of Object.values(p.clips)) if (c.type === "media") c.effects ??= [];
  return p;
}

function downloadText(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
}

// ---------- captions ----------

export interface WhisperConfig {
  /** Custom whisper-cli path; empty = bundled. */
  bin: string;
  /** Custom model file; empty = a downloaded model. */
  model: string;
  /** Preferred downloaded model name (e.g. "base.en"). */
  modelName: string;
  language: string;
}

export interface WhisperModel {
  name: string;
  label: string;
  size_mb: number;
  path: string | null;
}

export function loadWhisperConfig(): WhisperConfig {
  try {
    return { bin: "", model: "", modelName: "base.en", language: "auto", ...JSON.parse(localStorage.getItem("cm.whisper") ?? "{}") };
  } catch {
    return { bin: "", model: "", modelName: "base.en", language: "auto" };
  }
}
export function saveWhisperConfig(c: WhisperConfig) {
  try {
    localStorage.setItem("cm.whisper", JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

/** Transcribe every speech clip on the main track and place word-timed captions. */
export async function autoCaptions(onProgress?: (msg: string) => void, prompt?: string): Promise<number> {
  const cfg = loadWhisperConfig();
  if (!isTauri) throw new Error("Auto captions need the desktop app.");
  let model = cfg.model;
  if (!model) {
    const models = await invoke<WhisperModel[]>("whisper_models");
    const ready = models.filter((m) => m.path);
    model = (ready.find((m) => m.name === cfg.modelName) ?? ready[0])?.path ?? "";
  }
  if (!model) throw new Error("Download a caption model first: Settings → Auto captions.");
  // English-only models can't auto-detect language.
  const language = model.includes(".en.") && cfg.language === "auto" ? "en" : cfg.language;
  const { project } = S();
  const trackId = mainTrackId(project);
  if (!trackId) throw new Error("No clip with audio on the timeline.");
  const clips = clipsOnTrack(project, trackId).filter((c) => c.type === "media");
  const words: CaptionWord[] = [];
  for (const [i, c] of clips.entries()) {
    if (c.type !== "media") continue;
    const asset = project.assets[c.assetId];
    if (!asset?.hasAudio) continue;
    onProgress?.(`Transcribing clip ${i + 1} of ${clips.length}…`);
    const srt = await invoke<string>("transcribe", {
      path: asset.path, start: c.in, end: c.out, whisperBin: cfg.bin, model, language, prompt: prompt ?? null,
    });
    for (const w of parseSrt(srt)) words.push({ text: w.text, start: c.start + w.start / c.speed, end: c.start + w.end / c.speed });
  }
  S().commit((p) => ({ ...p, captions: words }));
  return words.length;
}

export async function importSrt() {
  const path = isTauri ? await openDialog("srt", "Subtitles") : null;
  let text: string | null = null;
  if (path) text = await invoke<string>("read_text_file", { path });
  else if (!isTauri) text = await pickTextFile(".srt");
  if (!text) return;
  const words = parseSrt(text);
  if (!words.length) return notify("No captions found in that file");
  S().commit((p) => ({ ...p, captions: words }));
  notify(`Imported ${words.length} words`);
}

export async function exportSrt() {
  const { project } = S();
  if (!project.captions.length) return;
  const srt = toSrt(project.captions);
  const path = await saveDialog(`${project.name}.srt`, "srt", "Subtitles");
  if (path) await invoke("write_text_file", { path, content: srt });
  else if (!isTauri) downloadText(`${project.name}.srt`, srt);
}

function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve);
    };
    input.click();
  });
}

// ---------- auto edit ----------

export type AutoEditRun = AutoEditOptions & {
  captions: boolean; noiseDb: number; minSilence: number; duck?: boolean; autoZoom?: boolean;
  /** Cut "um", "uh" and stutters (needs captions). */
  fillers?: boolean;
  /** Also cut "like", "you know", "I mean"… when used as filler. */
  softFillers?: boolean;
  /** Cut away to your other clips/photos at natural pauses. */
  broll?: boolean;
  /** Keep only the best 30–60 seconds. */
  highlight?: boolean;
  /** Switch to 9:16 and reframe. */
  vertical?: boolean;
};

export async function runAutoEdit(
  opts: AutoEditRun,
  onProgress: (msg: string) => void
): Promise<string> {
  const { project } = S();
  const trackId = mainTrackId(project);
  if (!trackId) throw new Error("Add a video or audio clip with speech first.");
  const silences: Record<string, Range[]> = {};
  if (opts.removeSilence) {
    if (!isTauri) throw new Error("Silence detection needs the desktop app.");
    const assets = new Set(clipsOnTrack(project, trackId).flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
    let i = 0;
    for (const id of assets) {
      const a = project.assets[id];
      onProgress(`Finding silences (${++i}/${assets.size})…`);
      const log = await invoke<string>("detect_silence", { path: a.path, noiseDb: opts.noiseDb, minDuration: opts.minSilence });
      silences[id] = parseSilenceDetect(log, a.duration);
    }
  }
  const r = applyAutoEdit(project, silences, opts);
  S().commit(() => (opts.duck ? { ...r.project, settings: { ...r.project.settings, autoDuck: true } } : r.project));
  const parts: string[] = [opts.removeSilence ? `Removed ${r.removedSeconds.toFixed(1)}s of silence with ${r.cuts} cuts.` : ""];
  const needWords = opts.captions || opts.fillers || opts.highlight;
  let haveWords = false;
  if (needWords) {
    try {
      const n = await autoCaptions(onProgress, opts.fillers ? FILLER_PROMPT : undefined);
      haveWords = n > 0;
      parts.push(`Added ${n} caption words.`);
    } catch (e) {
      parts.push(`Captions skipped: ${errorText(e)}`);
    }
  }
  if (haveWords && opts.fillers) {
    onProgress("Removing filler words…");
    const main = mainTrackId(S().project);
    const ranges = findFillers(S().project.captions, opts.softFillers);
    if (main && ranges.length) {
      const cut = cutTimeline(S().project, ranges, [main]);
      S().commit(() => cut.project);
      parts.push(`Cut ${ranges.length} filler word${ranges.length > 1 ? "s" : ""} (${cut.removed.toFixed(1)}s).`);
    } else parts.push("No filler words found.");
  }
  if (haveWords && opts.highlight) {
    const best = pickHighlight(S().project.captions);
    if (best) {
      S().commit((p) => keepOnly(p, best));
      parts.push(`Kept the best ${Math.round(best.end - best.start)}s: “${best.text.slice(0, 60)}…”`);
    }
  }
  if (haveWords && opts.autoZoom) parts.push(autoZoom());
  if (!opts.captions && haveWords) S().commit((p) => ({ ...p, captions: [] }));
  if (opts.vertical) parts.push(await makeFormat(1080, 1920, "fill", onProgress));
  if (opts.broll) parts.push(addAutoBroll());
  return parts.filter(Boolean).join(" ");
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- beat sync ----------

export async function runBeatSync(opts: MontageOptions, onProgress: (msg: string) => void): Promise<string> {
  if (!isTauri) throw new Error("Beat detection needs the desktop app.");
  const { project } = S();
  const music = findMusicClip(project);
  if (!music) throw new Error("Add a music track on an audio track first.");
  const asset = project.assets[music.assetId];
  onProgress("Listening for the beat…");
  const env = await invoke<number[]>("audio_envelope", { path: asset.path, start: music.in, end: music.out });
  const { bpm, beats } = detectBeats(env);
  if (!beats.length) throw new Error("Couldn't find a beat in that track.");
  const r = beatSyncMontage(project, music.id, beats.map((b) => b + music.in), opts);
  if (!r.cuts) throw new Error("Add some video clips or photos to the video track first.");
  S().commit(() => r.project);
  return `Detected ${bpm} BPM · made ${r.cuts + 1} shots cut on the beat.`;
}

// ---------- auto zoom ----------

export function autoZoom(): string {
  const { project } = S();
  if (!project.captions.length) throw new Error("Add captions first (✨ Auto captions or Import SRT). Auto zoom uses the word timings.");
  const r = applyAutoZoom(project);
  if (!r.zooms) return "No clear emphasis moments found (or clips already have hand-made keyframes).";
  S().commit(() => r.project);
  return `Added ${r.zooms} zooms on key moments.`;
}

// ---------- reframe ----------

/** Media clips Smart reframe can work on: selected video clips, or all of them. */
function reframeTargets(p: Project, ids: string[]): MediaClip[] {
  const all = Object.values(p.clips).filter(
    (c): c is MediaClip => c.type === "media" && p.assets[c.assetId]?.kind === "video" && !c.transform && !c.keyframes?.length
  );
  const picked = all.filter((c) => ids.includes(c.id));
  return picked.length ? picked : all;
}

/**
 * Track the subject in each video clip and store a smooth crop path, so
 * "Fill" keeps the person (or the action) in frame.
 */
export async function smartReframe(onProgress: (msg: string) => void, ids = S().selected): Promise<string> {
  if (!isTauri) throw new Error("Smart reframe needs the desktop app.");
  const targets = reframeTargets(S().project, ids);
  if (!targets.length) throw new Error("Add a video clip to the timeline first.");
  const paths: Record<string, FocusPoint[]> = {};
  let i = 0;
  for (const c of targets) {
    const asset = S().project.assets[c.assetId];
    onProgress(`Finding the subject (${++i}/${targets.length})…`);
    const size = sampleSize(asset.width, asset.height);
    // ~3 samples a second, capped so long clips stay quick.
    const fps = Math.min(3, 240 / Math.max(0.5, c.out - c.in));
    const b64 = await invoke<string>("sample_frames", { path: asset.path, start: c.in, end: c.out, fps, ...size });
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    paths[c.id] = smoothPath(locateSubject(unpackFrames(bytes, size.width, size.height, c.in, fps)));
  }
  S().commit((p) => Object.entries(paths).reduce((acc, [id, focus]) => (acc.clips[id] ? updateClip(acc, id, { focus, fit: "fill" }) : acc), p));
  return `Smart reframe tracked ${targets.length} clip${targets.length > 1 ? "s" : ""}.`;
}

/** Switch the canvas shape (e.g. to 9:16) and reframe every clip to fill it. */
export async function makeFormat(width: number, height: number, fit: FitMode, onProgress: (msg: string) => void): Promise<string> {
  S().commit((p) => ({ ...p, settings: { ...p.settings, width, height, fit } }));
  if (fit !== "fill" || !isTauri) return `Canvas set to ${width}×${height}.`;
  try {
    return `Canvas set to ${width}×${height}. ${await smartReframe(onProgress, [])}`;
  } catch (e) {
    return `Canvas set to ${width}×${height}. ${errorText(e)}`;
  }
}

// ---------- B-roll ----------

/** Put the media you imported but haven't used yet over the main clip at natural pauses. */
export function addAutoBroll(): string {
  const p = S().project;
  const main = mainTrackId(p);
  if (!main) return "B-roll skipped: no main clip.";
  const used = new Set(Object.values(p.clips).flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
  const pool = Object.values(p.assets).filter((a) => !used.has(a.id) && a.kind !== "audio").map((a) => a.id);
  if (!pool.length) return "B-roll skipped: import some extra clips or photos to use as B-roll.";
  const r = addBroll(p, pool, main);
  if (!r.shots) return "No good spots for B-roll found.";
  S().commit(() => r.project);
  return `Added ${r.shots} B-roll shot${r.shots > 1 ? "s" : ""}.`;
}

// ---------- elements: stickers, backgrounds, overlays, intros ----------

/** A video track above everything else at [at, at+d), creating one if needed. */
function freeTopVideoTrack(p: Project, at: number, d: number): { project: Project; trackId: string } {
  const top = p.tracks.find((t) => t.kind === "video");
  if (top && !clipsOnTrack(p, top.id).some((c) => c.start < at + d && clipEnd(c) > at)) return { project: p, trackId: top.id };
  const next = addTrack(p, "video");
  return { project: next, trackId: next.tracks.find((t) => t.kind === "video")!.id };
}

export async function addSticker(id: string) {
  const def = stickerById(id);
  if (!def) return;
  const { playhead } = S();
  const png = renderSticker(def);
  // Desktop: keep the PNG next to the app data so the project still works later.
  const path = isTauri ? await invoke<string>("save_sticker", { name: `sticker-${def.id}`, pngBase64: png.split(",")[1] }) : png;
  const assetId = `stk_${def.id}`;
  let p = S().project;
  if (!p.assets[assetId]) p = addAsset(p, { id: assetId, path, name: `Sticker ${def.name}`, kind: "image", duration: 0, width: 512, height: 512, hasAudio: false });
  const len = 3;
  const tr = freeTopVideoTrack(p, playhead, len);
  const r = placeAsset(tr.project, assetId, tr.trackId, playhead);
  if (!r.clipId) return;
  // About a third of the frame, slightly above centre (scale 1 = fit the frame).
  const project = updateClip(r.project, r.clipId, { out: len, keyframes: stickerKeyframes({ x: 0.5, y: 0.4 }, 0.35, len) });
  S().commit(() => project);
  S().select([r.clipId]);
}

export function addGenerator(id: string) {
  const g = generatorById(id);
  if (!g) return;
  const { playhead } = S();
  const gen = ensureGeneratorAsset(S().project, id);
  let p = gen.project;
  let trackId: string;
  if (g.category === "overlay") {
    const tr = freeTopVideoTrack(p, playhead, DEFAULT_IMAGE_SECONDS);
    p = tr.project;
    trackId = tr.trackId;
  } else {
    // Backgrounds go on the bottom video track, or a new one under the others.
    const videos = p.tracks.filter((t) => t.kind === "video");
    const bottom = videos[videos.length - 1];
    if (bottom && !clipsOnTrack(p, bottom.id).some((c) => c.start < playhead + DEFAULT_IMAGE_SECONDS && clipEnd(c) > playhead)) trackId = bottom.id;
    else {
      p = addTrack(p, "video");
      const t = p.tracks.find((x) => !S().project.tracks.some((y) => y.id === x.id))!;
      // Move the new track below the other video tracks.
      const rest = p.tracks.filter((x) => x.id !== t.id);
      const lastVideo = rest.map((x) => x.kind).lastIndexOf("video");
      p = { ...p, tracks: [...rest.slice(0, lastVideo + 1), t, ...rest.slice(lastVideo + 1)] };
      trackId = t.id;
    }
  }
  const r = placeAsset(p, gen.assetId, trackId, playhead);
  if (!r.clipId) return;
  S().commit(() => r.project);
  S().select([r.clipId]);
}

export function addTemplate(id: string) {
  const tpl = introById(id);
  if (!tpl) return;
  const r = applyTemplate(S().project, tpl);
  S().commit(() => r.project);
  S().setPlayhead(r.start);
}
