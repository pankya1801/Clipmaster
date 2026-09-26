/**
 * Auto Edit: one-click rough cut for talking-head / vlog footage.
 *  1. Remove silences from the main track (jump cuts), rippling clips together.
 *  2. Optionally alternate a punch-in zoom on every other cut to hide jumps.
 *  3. Optionally add a short transition at each cut and a colour look.
 * Captions are handled by the caller (transcription is async / backend work).
 */
import { clipDuration, clipsOnTrack, uid } from "./project";
import type { MediaClip, Project } from "./types";

export interface Range {
  start: number;
  end: number;
}

export interface AutoEditOptions {
  removeSilence: boolean;
  /** Keep this much audio around speech (seconds). */
  padding: number;
  /** Ignore kept pieces shorter than this (seconds). */
  minKeep: number;
  punchIn: boolean;
  transition: "none" | "flash" | "fade-in" | "zoom-pop";
  look: string | null; // effect id, e.g. "cinematic"
}

export const DEFAULT_AUTO_EDIT: AutoEditOptions = {
  removeSilence: true,
  padding: 0.12,
  minKeep: 0.3,
  punchIn: true,
  transition: "none",
  look: null,
};

/** Parse `silencedetect` stderr into silent ranges (source time). */
export function parseSilenceDetect(stderr: string, mediaDuration: number): Range[] {
  const out: Range[] = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start != null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start != null) out.push({ start, end: mediaDuration });
  return out;
}

/** Portions of [from, to] that are not silent, padded and filtered. */
export function keptRanges(from: number, to: number, silences: Range[], padding: number, minKeep: number): Range[] {
  const cuts = silences
    .map((s) => ({ start: s.start + padding, end: s.end - padding }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const kept: Range[] = [];
  let t = from;
  for (const c of cuts) {
    if (c.end <= t || c.start >= to) continue;
    if (c.start > t) kept.push({ start: t, end: Math.min(c.start, to) });
    t = Math.max(t, c.end);
  }
  if (t < to) kept.push({ start: t, end: to });
  return kept.filter((k) => k.end - k.start >= minKeep);
}

/** The track Auto Edit works on: the first video track with audio clips, else the first audio track. */
export function mainTrackId(p: Project): string | undefined {
  const hasSpeech = (id: string) =>
    clipsOnTrack(p, id).some((c) => c.type === "media" && p.assets[c.assetId]?.hasAudio && p.assets[c.assetId]?.kind !== "image");
  return p.tracks.find((t) => t.kind === "video" && hasSpeech(t.id))?.id ?? p.tracks.find((t) => t.kind === "audio" && hasSpeech(t.id))?.id;
}

export function applyAutoEdit(
  p: Project,
  silencesByAsset: Record<string, Range[]>,
  opts: AutoEditOptions
): { project: Project; removedSeconds: number; cuts: number } {
  const trackId = mainTrackId(p);
  if (!trackId) return { project: p, removedSeconds: 0, cuts: 0 };
  const source = clipsOnTrack(p, trackId);
  const clips = { ...p.clips };
  for (const c of source) delete clips[c.id];

  let t = source[0]?.start ?? 0;
  let removed = 0;
  let cuts = 0;
  let k = 0;
  for (const c of source) {
    if (c.type !== "media") continue;
    const asset = p.assets[c.assetId];
    const pieces =
      opts.removeSilence && asset?.hasAudio && asset.kind !== "image"
        ? keptRanges(c.in, c.out, silencesByAsset[c.assetId] ?? [], opts.padding, opts.minKeep)
        : [{ start: c.in, end: c.out }];
    removed += clipDuration(c) - pieces.reduce((s, r) => s + (r.end - r.start) / c.speed, 0);
    pieces.forEach((r, i) => {
      const piece: MediaClip = {
        ...c,
        id: i === 0 ? c.id : uid("c"),
        start: t,
        in: r.start,
        out: r.end,
        fadeIn: i === 0 ? c.fadeIn : 0,
        fadeOut: i === pieces.length - 1 ? c.fadeOut : 0,
        transIn: i === 0 ? c.transIn : undefined,
        transOut: i === pieces.length - 1 ? c.transOut : undefined,
        effects: [...(c.effects ?? [])],
      };
      if (k > 0 && opts.transition !== "none") piece.transIn = { id: opts.transition, duration: opts.transition === "flash" ? 0.15 : 0.25 };
      piece.effects = piece.effects.filter((e) => e.id !== "punch-in");
      if (opts.punchIn && k % 2 === 1) piece.effects.push({ id: "punch-in", amount: 0.5 });
      if (opts.look && !piece.effects.some((e) => e.id === opts.look)) piece.effects.push({ id: opts.look, amount: 0.7 });
      clips[piece.id] = piece;
      t += clipDuration(piece);
      k++;
    });
    cuts += Math.max(0, pieces.length - 1);
  }

  // Keep other tracks' timing relative: shift captions that fall inside removed time is
  // not possible without transcripts, so captions are cleared and should be regenerated.
  return {
    project: { ...p, clips, captions: removed > 0.01 ? [] : p.captions },
    removedSeconds: removed,
    cuts,
  };
}
