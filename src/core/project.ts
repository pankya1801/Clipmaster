import type { Clip, MediaAsset, MediaClip, Project, TextClip, Track, TrackKind, Transform } from "./types";

export const DEFAULT_IMAGE_SECONDS = 5;

export const IDENTITY_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

/** Picture-in-picture presets (corner placement at 35% size). */
export const PIP_PRESETS: { label: string; t: Transform }[] = [
  { label: "Top left", t: { x: 0.21, y: 0.23, scale: 0.35, rotation: 0, opacity: 1 } },
  { label: "Top right", t: { x: 0.79, y: 0.23, scale: 0.35, rotation: 0, opacity: 1 } },
  { label: "Bottom left", t: { x: 0.21, y: 0.77, scale: 0.35, rotation: 0, opacity: 1 } },
  { label: "Bottom right", t: { x: 0.79, y: 0.77, scale: 0.35, rotation: 0, opacity: 1 } },
];

export function isIdentity(t?: Transform) {
  return !t || (t.x === 0.5 && t.y === 0.5 && t.scale === 1 && t.rotation === 0 && t.opacity === 1);
}
export const MIN_CLIP_SECONDS = 0.1;

let counter = 0;
export function uid(prefix: string) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createProject(name = "Untitled"): Project {
  return {
    version: 1,
    name,
    settings: { width: 1920, height: 1080, fps: 30 },
    assets: {},
    tracks: [
      { id: "t_text", kind: "text", name: "Text", muted: false, hidden: false },
      { id: "t_v1", kind: "video", name: "Video 1", muted: false, hidden: false },
      { id: "t_a1", kind: "audio", name: "Audio 1", muted: false, hidden: false },
    ],
    clips: {},
    captions: [],
    captionSettings: { templateId: "bold-yellow", scale: 1 },
  };
}

export function clipDuration(c: Clip): number {
  return c.type === "text" ? c.duration : (c.out - c.in) / c.speed;
}
export function clipEnd(c: Clip): number {
  return c.start + clipDuration(c);
}

export function projectDuration(p: Project): number {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  return end;
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

export function trackAccepts(kind: TrackKind, clip: { type: "media" | "text"; assetKind?: MediaAsset["kind"] }) {
  if (clip.type === "text") return kind === "text";
  if (kind === "audio") return clip.assetKind === "audio" || clip.assetKind === "video";
  if (kind === "video") return clip.assetKind === "video" || clip.assetKind === "image";
  return false;
}

/** Does [start, end) overlap any other clip on the track? */
export function overlaps(p: Project, trackId: string, start: number, end: number, ignoreId?: string) {
  return clipsOnTrack(p, trackId).some((c) => c.id !== ignoreId && start < clipEnd(c) - 1e-6 && end > c.start + 1e-6);
}

/** Nearest start ≥ 0 where a clip of `dur` fits on the track without overlap. */
export function findFreeStart(p: Project, trackId: string, desired: number, dur: number, ignoreId?: string): number {
  desired = Math.max(0, desired);
  if (!overlaps(p, trackId, desired, desired + dur, ignoreId)) return desired;
  const others = clipsOnTrack(p, trackId).filter((c) => c.id !== ignoreId);
  const candidates = [0, ...others.map(clipEnd), ...others.map((c) => c.start - dur)]
    .filter((s) => s >= 0 && !overlaps(p, trackId, s, s + dur, ignoreId))
    .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return candidates[0] ?? (others.length ? clipEnd(others[others.length - 1]) : 0);
}

/** Snap a time to nearby clip edges / playhead within `threshold` seconds. */
export function snapTime(p: Project, t: number, threshold: number, extra: number[] = [], ignoreId?: string): number {
  const points = [0, ...extra];
  for (const c of Object.values(p.clips)) {
    if (c.id === ignoreId) continue;
    points.push(c.start, clipEnd(c));
  }
  let best = t;
  let bestD = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d < bestD) {
      bestD = d;
      best = pt;
    }
  }
  return best;
}

// ---------- mutations (return new projects; never mutate input) ----------

function withClip(p: Project, c: Clip): Project {
  return { ...p, clips: { ...p.clips, [c.id]: c } };
}

export function addAsset(p: Project, a: MediaAsset): Project {
  return { ...p, assets: { ...p.assets, [a.id]: a } };
}

export function addTrack(p: Project, kind: TrackKind): Project {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const label = kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text";
  const track: Track = { id: uid("t"), kind, name: `${label} ${n}`, muted: false, hidden: false };
  // Video/text tracks go on top of existing tracks of that kind; audio at the bottom.
  const tracks = [...p.tracks];
  if (kind === "audio") tracks.push(track);
  else {
    const firstOfKind = tracks.findIndex((t) => t.kind === kind);
    tracks.splice(firstOfKind === -1 ? 0 : firstOfKind, 0, track);
  }
  return { ...p, tracks };
}

export function updateTrack(p: Project, id: string, patch: Partial<Track>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function removeTrack(p: Project, id: string): Project {
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.trackId !== id));
  return { ...p, tracks: p.tracks.filter((t) => t.id !== id), clips };
}

export function placeAsset(p: Project, assetId: string, trackId: string, at?: number): { project: Project; clipId?: string } {
  const asset = p.assets[assetId];
  const track = p.tracks.find((t) => t.id === trackId);
  if (!asset || !track || !trackAccepts(track.kind, { type: "media", assetKind: asset.kind })) return { project: p };
  const len = asset.kind === "image" ? DEFAULT_IMAGE_SECONDS : asset.duration;
  const existing = clipsOnTrack(p, trackId);
  const desired = at ?? (existing.length ? clipEnd(existing[existing.length - 1]) : 0);
  const clip: MediaClip = {
    id: uid("c"),
    type: "media",
    trackId,
    assetId,
    start: findFreeStart(p, trackId, desired, len),
    in: 0,
    out: len,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    effects: [],
  };
  return { project: withClip(p, clip), clipId: clip.id };
}

export function addText(p: Project, trackId: string, at: number, text = "Your text"): { project: Project; clipId?: string } {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== "text") return { project: p };
  const clip: TextClip = {
    id: uid("c"),
    type: "text",
    trackId,
    start: findFreeStart(p, trackId, at, 3),
    duration: 3,
    text,
    x: 0.5,
    y: 0.85,
    fontSize: Math.round(p.settings.height / 14),
    color: "#ffffff",
    box: true,
  };
  return { project: withClip(p, clip), clipId: clip.id };
}

export type ClipPatch = Partial<Omit<MediaClip, "type">> | Partial<Omit<TextClip, "type">>;

export function updateClip(p: Project, id: string, patch: ClipPatch): Project {
  const c = p.clips[id];
  if (!c) return p;
  const next = { ...c, ...patch } as Clip;
  if (next.type === "media") {
    next.speed = clamp(next.speed, 0.25, 4);
    next.volume = clamp(next.volume, 0, 2);
    const dur = clipDuration(next);
    next.fadeIn = clamp(next.fadeIn, 0, dur);
    next.fadeOut = clamp(next.fadeOut, 0, dur - next.fadeIn);
    if (next.transform) {
      const t = next.transform;
      next.transform = {
        x: clamp(t.x, -0.5, 1.5),
        y: clamp(t.y, -0.5, 1.5),
        scale: clamp(t.scale, 0.05, 4),
        rotation: ((t.rotation % 360) + 360) % 360,
        opacity: clamp(t.opacity, 0, 1),
      };
      if (isIdentity(next.transform)) next.transform = undefined;
    }
  } else {
    next.duration = Math.max(MIN_CLIP_SECONDS, next.duration);
    next.x = clamp(next.x, 0, 1);
    next.y = clamp(next.y, 0, 1);
  }
  if (overlaps(p, next.trackId, next.start, clipEnd(next), id)) return p;
  return withClip(p, next);
}

/** Move a clip to a new track/time; lands in the nearest free slot. */
export function moveClip(p: Project, id: string, trackId: string, start: number): Project {
  const c = p.clips[id];
  const track = p.tracks.find((t) => t.id === trackId);
  if (!c || !track) return p;
  const assetKind = c.type === "media" ? p.assets[c.assetId]?.kind : undefined;
  if (!trackAccepts(track.kind, { type: c.type, assetKind })) return p;
  const dur = clipDuration(c);
  return withClip(p, { ...c, trackId, start: findFreeStart(p, trackId, start, dur, id) });
}

/** Trim the left edge to timeline time `t` (keeps right edge fixed). */
export function trimStart(p: Project, id: string, t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const end = clipEnd(c);
  const prevEnd = Math.max(0, ...clipsOnTrack(p, c.trackId).filter((o) => o.id !== id && clipEnd(o) <= c.start + 1e-6).map(clipEnd));
  let start = clamp(t, prevEnd, end - MIN_CLIP_SECONDS);
  if (c.type === "text") return withClip(p, { ...c, start, duration: end - start });
  const asset = p.assets[c.assetId];
  let newIn = c.in + (start - c.start) * c.speed;
  if (newIn < 0 && asset?.kind !== "image") {
    newIn = 0;
    start = end - (c.out - newIn) / c.speed;
  }
  if (asset?.kind === "image") return withClip(p, { ...c, start, in: 0, out: (end - start) * c.speed });
  return withClip(p, { ...c, start, in: newIn });
}

/** Trim the right edge to timeline time `t`. */
export function trimEnd(p: Project, id: string, t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const nextStart = Math.min(
    Infinity,
    ...clipsOnTrack(p, c.trackId).filter((o) => o.id !== id && o.start >= clipEnd(c) - 1e-6).map((o) => o.start)
  );
  const end = clamp(t, c.start + MIN_CLIP_SECONDS, nextStart);
  if (c.type === "text") return withClip(p, { ...c, duration: end - c.start });
  const asset = p.assets[c.assetId];
  let out = c.in + (end - c.start) * c.speed;
  if (asset && asset.kind !== "image") out = Math.min(out, asset.duration);
  return withClip(p, { ...c, out });
}

/** Split a clip at timeline time `t`. Returns the new right-hand clip id. */
export function splitClip(p: Project, id: string, t: number): { project: Project; clipId?: string } {
  const c = p.clips[id];
  if (!c || t <= c.start + MIN_CLIP_SECONDS || t >= clipEnd(c) - MIN_CLIP_SECONDS) return { project: p };
  const rightId = uid("c");
  if (c.type === "text") {
    const left: TextClip = { ...c, duration: t - c.start };
    const right: TextClip = { ...c, id: rightId, start: t, duration: clipEnd(c) - t };
    return { project: withClip(withClip(p, left), right), clipId: rightId };
  }
  const cut = c.in + (t - c.start) * c.speed;
  const left: MediaClip = { ...c, out: cut, fadeOut: 0, transOut: undefined };
  const right: MediaClip = { ...c, id: rightId, start: t, in: cut, fadeIn: 0, transIn: undefined };
  return { project: withClip(withClip(p, left), right), clipId: rightId };
}

export function deleteClips(p: Project, ids: string[], ripple = false): Project {
  let next: Project = { ...p, clips: { ...p.clips } };
  for (const id of ids) {
    const c = next.clips[id];
    if (!c) continue;
    delete next.clips[id];
    if (ripple) {
      const gap = clipDuration(c);
      for (const o of Object.values(next.clips)) {
        if (o.trackId === c.trackId && o.start >= c.start) next.clips[o.id] = { ...o, start: Math.max(0, o.start - gap) };
      }
    }
  }
  return next;
}

export function duplicateClip(p: Project, id: string): { project: Project; clipId?: string } {
  const c = p.clips[id];
  if (!c) return { project: p };
  const copy = { ...c, id: uid("c"), start: findFreeStart(p, c.trackId, clipEnd(c), clipDuration(c)) };
  return { project: withClip(p, copy), clipId: copy.id };
}

/** Topmost visible media clip on a video track at time t (for preview). */
export function visualAt(p: Project, t: number): MediaClip | undefined {
  for (const track of p.tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    const hit = clipsOnTrack(p, track.id).find((c) => t >= c.start && t < clipEnd(c));
    if (hit && hit.type === "media") return hit;
  }
  return undefined;
}

export function textsAt(p: Project, t: number): TextClip[] {
  return p.tracks
    .filter((tr) => tr.kind === "text" && !tr.hidden)
    .flatMap((tr) => clipsOnTrack(p, tr.id))
    .filter((c): c is TextClip => c.type === "text" && t >= c.start && t < clipEnd(c));
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
