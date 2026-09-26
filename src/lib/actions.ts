import { applyAutoEdit, AutoEditOptions, mainTrackId, parseSilenceDetect, Range } from "../core/autoedit";
import { parseSrt, toSrt } from "../core/captions";
import {
  addAsset, addText, clipEnd, clipsOnTrack, createProject, deleteClips, duplicateClip, placeAsset, splitClip, trackAccepts, addTrack, uid,
} from "../core/project";
import type { CaptionWord, MediaAsset, Project } from "../core/types";
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

export function addTextAtPlayhead(text?: string) {
  const { project, playhead } = S();
  let p = project;
  let track = p.tracks.find((t) => t.kind === "text");
  if (!track) {
    p = addTrack(p, "text");
    track = p.tracks.find((t) => t.kind === "text")!;
  }
  const r = addText(p, track.id, playhead, text);
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
  bin: string;
  model: string;
  language: string;
}

export function loadWhisperConfig(): WhisperConfig {
  try {
    return { bin: "", model: "", language: "auto", ...JSON.parse(localStorage.getItem("cm.whisper") ?? "{}") };
  } catch {
    return { bin: "", model: "", language: "auto" };
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
export async function autoCaptions(onProgress?: (msg: string) => void): Promise<number> {
  const cfg = loadWhisperConfig();
  if (!isTauri) throw new Error("Auto captions need the desktop app.");
  if (!cfg.bin || !cfg.model) throw new Error("Set the whisper.cpp program and model in Settings first.");
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
      path: asset.path, start: c.in, end: c.out, whisperBin: cfg.bin, model: cfg.model, language: cfg.language,
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

export async function runAutoEdit(
  opts: AutoEditOptions & { captions: boolean; noiseDb: number; minSilence: number },
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
  S().commit(() => r.project);
  let msg = `Removed ${r.removedSeconds.toFixed(1)}s of silence with ${r.cuts} cuts.`;
  if (opts.captions) {
    try {
      const n = await autoCaptions(onProgress);
      msg += ` Added ${n} caption words.`;
    } catch (e) {
      msg += ` Captions skipped: ${errorText(e)}`;
    }
  }
  return msg;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
