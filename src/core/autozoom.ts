/**
 * Auto-zoom on emphasis: uses caption word timings to find key moments
 * (sentence starts after a pause, exclamations, ALL-CAPS and "hook" words)
 * and adds zoom keyframes to the main video clips at those moments,
 * alternating a quick punch-in with a slow push-in so it doesn't feel robotic.
 */
import { mainTrackId } from "./autoedit";
import { upsertKeyframe } from "./keyframes";
import { clipDuration, clipsOnTrack, IDENTITY_TRANSFORM } from "./project";
import type { CaptionWord, Keyframe, MediaClip, Project } from "./types";

const HOOK_WORDS = new Set(
  "never always secret free best worst money now stop why how huge crazy insane important biggest first only must mistake truth actually literally everyone nobody".split(" ")
);

export interface ZoomMoment {
  start: number;
  end: number;
  style: "punch" | "push";
  word: string;
}

export function emphasisScore(words: CaptionWord[], i: number): number {
  const w = words[i];
  const clean = w.text.replace(/[^\p{L}\p{N}!?]/gu, "");
  const bare = clean.replace(/[!?]/g, "").toLowerCase();
  let s = 0;
  const prev = words[i - 1];
  if (!prev || w.start - prev.end > 0.45 || /[.!?]$/.test(prev.text)) s += 1;
  if (/!$/.test(w.text)) s += 2;
  if (clean.length >= 2 && clean === clean.toUpperCase() && /\p{L}/u.test(clean)) s += 2;
  if (HOOK_WORDS.has(bare)) s += 1.5;
  if (bare.length >= 9) s += 0.5;
  return s;
}

/** Pick zoom moments: strongest words first, at least `minGap` seconds apart. */
export function pickZoomMoments(words: CaptionWord[], minGap = 3, threshold = 1.5): ZoomMoment[] {
  const scored = words.map((_, i) => ({ i, s: emphasisScore(words, i) })).filter((x) => x.s >= threshold);
  scored.sort((a, b) => b.s - a.s || words[a.i].start - words[b.i].start);
  const chosen: number[] = [];
  for (const { i } of scored) {
    if (chosen.every((j) => Math.abs(words[j].start - words[i].start) >= minGap)) chosen.push(i);
  }
  chosen.sort((a, b) => words[a].start - words[b].start);
  return chosen.map((i, k) => {
    const w = words[i];
    const hold = Math.min(2, Math.max(0.9, w.end - w.start + 0.7));
    return { start: w.start, end: w.start + hold, style: k % 2 === 0 ? "punch" : "push", word: w.text };
  });
}

/** Add zoom keyframes to the main track's clips. Clips with hand-made keyframes are left alone. */
export function applyAutoZoom(p: Project, strength = 1): { project: Project; zooms: number } {
  const trackId = mainTrackId(p);
  if (!trackId || !p.captions.length) return { project: p, zooms: 0 };
  const moments = pickZoomMoments(p.captions);
  const clips = { ...p.clips };
  let zooms = 0;
  for (const c of clipsOnTrack(p, trackId)) {
    if (c.type !== "media" || c.keyframes?.length) continue;
    const dur = clipDuration(c);
    const base = c.transform ?? IDENTITY_TRANSFORM;
    const mine = moments.filter((m) => m.start >= c.start && m.start < c.start + dur - 0.3);
    if (!mine.length) continue;
    let keys: Keyframe[] = upsertKeyframe([], 0, base);
    for (const m of mine) {
      const t0 = m.start - c.start;
      const t1 = Math.min(dur, m.end - c.start);
      const peak = { ...base, scale: base.scale * (1 + (m.style === "punch" ? 0.16 : 0.1) * strength) };
      keys = upsertKeyframe(keys, Math.max(0, t0 - 0.04), base);
      keys = upsertKeyframe(keys, Math.min(t1, t0 + (m.style === "punch" ? 0.12 : 0.9)), peak);
      keys = upsertKeyframe(keys, t1, peak);
      keys = upsertKeyframe(keys, Math.min(dur, t1 + 0.3), base);
      zooms++;
    }
    clips[c.id] = { ...c, keyframes: keys } as MediaClip;
  }
  return { project: { ...p, clips }, zooms };
}
