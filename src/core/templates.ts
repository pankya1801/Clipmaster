/** Intro / outro templates: an animated background, optional overlay and a title. */
import { mainTrackId } from "./autoedit";
import { addText, addTrack, clipsOnTrack, projectDuration, uid, updateClip } from "./project";
import type { MediaClip, Project } from "./types";
import { ensureGeneratorAsset, IntroTemplate } from "./visuals";

/** Push everything on the timeline (and captions) later by `d` seconds. */
export function shiftAll(p: Project, d: number): Project {
  const clips = Object.fromEntries(Object.entries(p.clips).map(([id, c]) => [id, { ...c, start: c.start + d }]));
  return { ...p, clips, captions: p.captions.map((w) => ({ ...w, start: w.start + d, end: w.end + d })) };
}

/** Video track for overlays: an empty one above `below`, or a new one. */
function overlayTrack(p: Project, below: string, at: number, d: number): { project: Project; trackId: string } {
  const idx = p.tracks.findIndex((t) => t.id === below);
  const free = p.tracks.slice(0, idx).find((t) => t.kind === "video" && !clipsOnTrack(p, t.id).some((c) => overlapsRange(c.start, c, at, d)));
  if (free) return { project: p, trackId: free.id };
  const next = addTrack(p, "video");
  const t = next.tracks.find((x) => !p.tracks.some((y) => y.id === x.id))!;
  return { project: next, trackId: t.id };
}

function overlapsRange(start: number, c: { type: string; duration?: number; in?: number; out?: number; speed?: number }, at: number, d: number) {
  const len = c.type === "text" ? c.duration! : (c.out! - c.in!) / c.speed!;
  return start < at + d && start + len > at;
}

export function applyTemplate(p0: Project, tpl: IntroTemplate, text = tpl.text): { project: Project; start: number } {
  const d = tpl.duration;
  let p = tpl.kind === "intro" ? shiftAll(p0, d) : p0;
  const start = tpl.kind === "intro" ? 0 : projectDuration(p0);
  let main = mainTrackId(p) ?? p.tracks.find((t) => t.kind === "video")?.id;
  if (!main) {
    p = addTrack(p, "video");
    main = p.tracks.find((t) => t.kind === "video")!.id;
  }
  // Background on the main video track.
  const bg = ensureGeneratorAsset(p, tpl.bg);
  p = bg.project;
  p = putClip(p, bg.assetId, main, start, d);
  // Overlay above it.
  if (tpl.overlay) {
    const ov = ensureGeneratorAsset(p, tpl.overlay);
    p = ov.project;
    const tr = overlayTrack(p, main, start, d);
    p = tr.project;
    p = putClip(p, ov.assetId, tr.trackId, start, d);
  }
  // Title on a text track.
  let textTrack = p.tracks.find((t) => t.kind === "text")?.id;
  if (!textTrack) {
    p = addTrack(p, "text");
    textTrack = p.tracks.find((t) => t.kind === "text")!.id;
  }
  const t = addText(p, textTrack, start, text, tpl.preset);
  p = t.clipId ? updateClip(t.project, t.clipId, { duration: d }) : t.project;
  return { project: p, start };
}

/** A still/generated clip at an exact time (the slot is known to be free). */
function putClip(p: Project, assetId: string, trackId: string, start: number, d: number): Project {
  const clip: MediaClip = { id: uid("c"), type: "media", trackId, assetId, start, in: 0, out: d, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, effects: [] };
  return { ...p, clips: { ...p.clips, [clip.id]: clip } };
}
