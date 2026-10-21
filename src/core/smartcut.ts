/**
 * Smarter Auto Edit building blocks that work from caption word timings:
 * filler-word removal, automatic B-roll, picking the best highlight for a
 * Short, and one-click presets.
 */
import { emphasisScore } from "./autozoom";
import { clipDuration, clipEnd, clipsOnTrack, MIN_CLIP_SECONDS, uid } from "./project";
import type { CaptionWord, Clip, MediaClip, Project } from "./types";
import type { Range } from "./autoedit";

// ---------------------------------------------------------------- fillers

const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm", "eh"]);
/** Only removed when the user opts in: they are often real words. */
const SOFT_FILLERS = [["you", "know"], ["i", "mean"], ["like"], ["basically"], ["literally"], ["so"]];

/** Prompt that nudges whisper to write fillers down instead of skipping them. */
export const FILLER_PROMPT = "Umm, so, uh, I mean, like, you know... Hmm. Uh, okay.";

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Timeline ranges to cut for filler words (and immediate word repeats like
 * "I I"). Soft fillers are only taken when surrounded by short pauses, which
 * is how they sound when used as filler.
 */
export function findFillers(words: CaptionWord[], soft = false): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = bare(words[i].text);
    if (!w) continue;
    if (FILLERS.has(w)) {
      out.push({ start: words[i].start, end: words[i].end });
      continue;
    }
    // Stutter: same word twice in a row, close together ("the the").
    const next = words[i + 1];
    if (next && bare(next.text) === w && next.start - words[i].end < 0.3 && w.length <= 6) {
      out.push({ start: words[i].start, end: next.start });
      continue;
    }
    if (!soft) continue;
    for (const phrase of SOFT_FILLERS) {
      const seq = words.slice(i, i + phrase.length);
      if (seq.length !== phrase.length || !seq.every((s, k) => bare(s.text) === phrase[k])) continue;
      const before = i === 0 ? 1 : words[i].start - words[i - 1].end;
      const lastIdx = i + phrase.length - 1;
      const after = lastIdx + 1 >= words.length ? 1 : words[lastIdx + 1].start - words[lastIdx].end;
      // "like," / ", you know," → punctuated or paused around it.
      const punct = /[,.…]$/.test(words[lastIdx].text) || (i > 0 && /[,.…]$/.test(words[i - 1].text));
      if (punct || (before > 0.15 && after > 0.15)) {
        out.push({ start: words[i].start, end: words[lastIdx].end });
        i = lastIdx;
        break;
      }
    }
  }
  return mergeRanges(out);
}

export function mergeRanges(ranges: Range[], gap = 0.02): Range[] {
  const s = ranges.filter((r) => r.end - r.start > 0.01).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Map a timeline time through removed ranges (null if inside one). */
export function remapTime(t: number, removed: Range[]): number | null {
  let shift = 0;
  for (const r of removed) {
    if (t >= r.end) shift += r.end - r.start;
    else if (t > r.start) return null;
  }
  return t - shift;
}

/**
 * Remove timeline ranges and ripple everything after them closer.
 * `trackIds` limits which tracks are cut; clips on other tracks only move.
 * Captions inside removed ranges are dropped; later ones shift.
 */
export function cutTimeline(p: Project, ranges: Range[], trackIds?: string[]): { project: Project; removed: number } {
  const removed = mergeRanges(ranges);
  if (!removed.length) return { project: p, removed: 0 };
  const clips: Record<string, Clip> = {};
  for (const c of Object.values(p.clips)) {
    const cut = !trackIds || trackIds.includes(c.trackId);
    if (!cut) {
      // Keep untouched tracks in place relative to the content they started with.
      clips[c.id] = { ...c, start: mapClamped(c.start, removed) };
      continue;
    }
    for (const piece of splitAround(c, removed)) clips[piece.id] = piece;
  }
  const captions = p.captions.flatMap((w) => {
    const lost = removed.reduce((acc, r) => acc + Math.max(0, Math.min(w.end, r.end) - Math.max(w.start, r.start)), 0);
    if (lost > (w.end - w.start) / 2) return [];
    const start = mapClamped(w.start, removed);
    return [{ ...w, start, end: Math.max(start + 0.05, mapClamped(w.end, removed)) }];
  });
  return { project: { ...p, clips, captions }, removed: removed.reduce((s, r) => s + r.end - r.start, 0) };
}

/** Like remapTime, but a time inside a removed range snaps to where it was cut. */
export function mapClamped(t: number, removed: Range[]): number {
  const inside = removed.find((r) => t > r.start && t < r.end);
  return remapTime(inside ? inside.start : t, removed) ?? t;
}

function shiftBefore(t: number, removed: Range[]) {
  return removed.filter((r) => r.end <= t).reduce((s, r) => s + r.end - r.start, 0);
}

/** Pieces of a clip that survive the removed ranges, already rippled. */
function splitAround(c: Clip, removed: Range[]): Clip[] {
  const end = clipEnd(c);
  const keep: Range[] = [];
  let t = c.start;
  for (const r of removed) {
    if (r.end <= t || r.start >= end) continue;
    if (r.start > t) keep.push({ start: t, end: r.start });
    t = Math.max(t, r.end);
  }
  if (t < end) keep.push({ start: t, end });
  const pieces = keep.filter((k) => k.end - k.start >= MIN_CLIP_SECONDS);
  return pieces.map((k, i) => {
    const start = k.start - shiftBefore(k.start, removed);
    const id = i === 0 ? c.id : uid("c");
    if (c.type === "text") return { ...c, id, start, duration: k.end - k.start };
    const speed = c.speed;
    return {
      ...c,
      id,
      start,
      in: c.in + (k.start - c.start) * speed,
      out: c.in + (k.end - c.start) * speed,
      fadeIn: i === 0 ? c.fadeIn : 0,
      fadeOut: i === pieces.length - 1 ? c.fadeOut : 0,
      transIn: i === 0 ? c.transIn : undefined,
      transOut: i === pieces.length - 1 ? c.transOut : undefined,
      keyframes: i === 0 ? c.keyframes : undefined,
    } as MediaClip;
  });
}

// ---------------------------------------------------------------- B-roll

export interface BrollOptions {
  /** Seconds each B-roll shot stays on screen. */
  length: number;
  /** Minimum seconds between B-roll shots. */
  every: number;
}

export const DEFAULT_BROLL: BrollOptions = { length: 2.5, every: 7 };

/**
 * Moments to cut away to B-roll: sentence starts after a pause, spaced out.
 * Without captions, falls back to an even rhythm.
 */
export function brollMoments(words: CaptionWord[], duration: number, opts: BrollOptions): number[] {
  const out: number[] = [];
  // Never cover the first seconds: the speaker's face hooks the viewer.
  let next = Math.min(3, duration / 4);
  const starts = words.length
    ? words.filter((w, i) => i > 0 && (w.start - words[i - 1].end > 0.35 || /[.!?]$/.test(words[i - 1].text))).map((w) => w.start)
    : [];
  while (next + opts.length < duration - 1) {
    const cand = starts.find((s) => s >= next && s <= next + opts.every);
    const at = cand ?? (words.length ? undefined : next);
    if (at == null) {
      next += opts.every;
      continue;
    }
    out.push(at);
    next = at + opts.length + opts.every;
  }
  return out;
}

/**
 * Lay B-roll (the given video/image assets, in turn) on a video track above
 * the main one, muted and filling the frame.
 */
export function addBroll(p: Project, assetIds: string[], mainTrackId: string, opts = DEFAULT_BROLL): { project: Project; shots: number } {
  const assets = assetIds.map((id) => p.assets[id]).filter((a) => a && a.kind !== "audio");
  const main = clipsOnTrack(p, mainTrackId);
  if (!assets.length || !main.length) return { project: p, shots: 0 };
  const end = Math.max(...main.map(clipEnd));
  const moments = brollMoments(p.captions, end, opts);
  if (!moments.length) return { project: p, shots: 0 };
  // Reuse an empty video track above the main one, else add one.
  const mainIdx = p.tracks.findIndex((t) => t.id === mainTrackId);
  let track = p.tracks.slice(0, mainIdx).find((t) => t.kind === "video" && !clipsOnTrack(p, t.id).length);
  let tracks = p.tracks;
  if (!track) {
    track = { id: uid("t"), kind: "video", name: "B-roll", muted: true, hidden: false };
    tracks = [...p.tracks.slice(0, mainIdx), track, ...p.tracks.slice(mainIdx)];
  }
  const clips = { ...p.clips };
  const used = new Map<string, number>();
  moments.forEach((at, i) => {
    const a = assets[i % assets.length];
    const offset = used.get(a.id) ?? 0;
    const len = a.kind === "image" ? opts.length : Math.min(opts.length, a.duration);
    if (len < 0.5) return;
    // Walk through long clips so repeated B-roll shows different moments.
    const inPt = a.kind === "image" || offset + len > a.duration ? 0 : offset;
    used.set(a.id, inPt + len);
    const id = uid("c");
    clips[id] = {
      id, type: "media", trackId: track!.id, assetId: a.id, start: at, in: inPt, out: inPt + len,
      speed: 1, volume: 0, fadeIn: 0, fadeOut: 0, effects: a.kind === "image" ? [{ id: "zoom-in", amount: 0.5 }] : [], fit: "fill",
    } as MediaClip;
  });
  return { project: { ...p, tracks, clips }, shots: Object.keys(clips).length - Object.keys(p.clips).length };
}

// ---------------------------------------------------------------- highlights

export interface Highlight extends Range {
  score: number;
  text: string;
}

/**
 * The most engaging stretch of speech between `min` and `max` seconds long,
 * starting and ending on sentence boundaries: dense speech, emphasis words and
 * a strong opening line score highest.
 */
export function pickHighlight(words: CaptionWord[], min = 30, max = 60): Highlight | null {
  if (words.length < 5) return null;
  const isStart = (i: number) => i === 0 || words[i].start - words[i - 1].end > 0.5 || /[.!?]$/.test(words[i - 1].text);
  const isEnd = (i: number) => i === words.length - 1 || /[.!?]$/.test(words[i].text) || words[i + 1].start - words[i].end > 0.5;
  const scores = words.map((_, i) => emphasisScore(words, i));
  let best: Highlight | null = null;
  for (let a = 0; a < words.length; a++) {
    if (!isStart(a)) continue;
    let sum = 0;
    for (let b = a; b < words.length; b++) {
      sum += scores[b];
      const len = words[b].end - words[a].start;
      if (len > max) break;
      if (len < Math.min(min, (words[words.length - 1].end - words[0].start) * 0.9) || !isEnd(b)) continue;
      // Emphasis per minute + speech density, with a bonus for a punchy first 3s.
      const hook = scores.slice(a, a + 8).reduce((s, v, k) => (words[a + k] && words[a + k].start - words[a].start < 3 ? s + v : s), 0);
      const score = (sum / len) * 60 + ((b - a + 1) / len) * 4 + hook * 2;
      if (!best || score > best.score) {
        best = { start: words[a].start, end: words[b].end, score, text: words.slice(a, b + 1).map((w) => w.text).join(" ") };
      }
    }
  }
  return best;
}

/** Keep only [start, end] of the timeline on every track (captions too). */
export function keepOnly(p: Project, keep: Range, padding = 0.15): Project {
  const total = Math.max(0, ...Object.values(p.clips).map(clipEnd), ...p.captions.map((w) => w.end));
  const s = Math.max(0, keep.start - padding);
  const e = Math.min(total, keep.end + padding);
  const cut: Range[] = [];
  if (s > 0) cut.push({ start: 0, end: s });
  if (e < total) cut.push({ start: e, end: total + 1 });
  return cutTimeline(p, cut).project;
}

export function clipsDuration(clips: Clip[]) {
  return clips.reduce((s, c) => s + clipDuration(c), 0);
}

// ---------------------------------------------------------------- presets

export interface AutoEditPreset {
  id: string;
  name: string;
  hint: string;
  mode: "talk" | "music";
  /** Options applied over the dialog's current values. */
  talk?: Partial<{
    removeSilence: boolean; padding: number; minSilence: number; punchIn: boolean; captions: boolean; autoZoom: boolean;
    duck: boolean; transition: "none" | "flash" | "fade-in" | "zoom-pop"; look: string | null; fillers: boolean; softFillers: boolean;
    broll: boolean; highlight: boolean; vertical: boolean;
  }>;
  music?: Partial<{ everyBeats: number; muteClips: boolean; punchIn: boolean; flash: boolean }>;
}

export const AUTO_EDIT_PRESETS: AutoEditPreset[] = [
  {
    id: "talking-head", name: "🎙 Talking head", hint: "Tight cuts, no ums, zooms on key words, captions", mode: "talk",
    talk: { removeSilence: true, padding: 0.1, minSilence: 0.4, punchIn: true, captions: true, autoZoom: true, fillers: true, softFillers: false, transition: "none", broll: false, highlight: false, look: null },
  },
  {
    id: "vlog", name: "🎒 Vlog", hint: "Relaxed cuts, B-roll from your other clips, warm look, music ducking", mode: "talk",
    talk: { removeSilence: true, padding: 0.18, minSilence: 0.6, punchIn: true, captions: true, autoZoom: false, fillers: true, broll: true, duck: true, transition: "fade-in", look: "warm", highlight: false },
  },
  {
    id: "podcast", name: "🎧 Podcast clip", hint: "Finds the best 30–60s, makes it vertical with captions", mode: "talk",
    talk: { removeSilence: true, padding: 0.12, minSilence: 0.5, punchIn: true, captions: true, autoZoom: true, fillers: true, highlight: true, vertical: true, broll: false, transition: "none" },
  },
  {
    id: "montage", name: "🎵 Music montage", hint: "Cuts your clips to the beat of a song", mode: "music",
    music: { everyBeats: 2, muteClips: true, punchIn: true, flash: false },
  },
];
