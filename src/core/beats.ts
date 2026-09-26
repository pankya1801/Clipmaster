/**
 * Beat detection and beat-synced montage editing.
 *
 * Input is a loudness envelope (RMS per hop, from the backend). We compute an
 * onset-strength curve, estimate tempo by autocorrelation (70–180 BPM with a
 * mild preference around 120), then lock a beat grid to the phase that lands
 * on the most onsets.
 */
import { clipDuration, clipsOnTrack, uid } from "./project";
import type { MediaClip, Project } from "./types";

export const ENVELOPE_HOP_SECONDS = 512 / 22050;

export function onsetStrength(env: number[]): number[] {
  const log = env.map((v) => Math.log(1e-4 + v));
  const out = log.map((v, i) => (i === 0 ? 0 : Math.max(0, v - log[i - 1])));
  // Remove slow trends with a local mean, keep the peaks.
  const w = 8;
  return out.map((v, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(out.length - 1, i + w); j++) {
      s += out[j];
      c++;
    }
    return Math.max(0, v - s / c);
  });
}

function smooth(x: number[], sigma = 1.5): number[] {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  return x.map((_, i) => {
    let s = 0;
    for (let j = -r; j <= r; j++) s += (x[i + j] ?? 0) * k[j + r];
    return s;
  });
}

export function estimateBpm(onsetRaw: number[], hop = ENVELOPE_HOP_SECONDS): number {
  const onset = smooth(onsetRaw);
  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / hop;
    let s = 0;
    for (let i = 0; i + lag + 1 < onset.length; i++) {
      const j = i + lag;
      const lo = Math.floor(j);
      const frac = j - lo;
      s += onset[i] * (onset[lo] * (1 - frac) + onset[lo + 1] * frac);
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = s * prior;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

/** Beat times (seconds from envelope start). */
/** Beat times (seconds from envelope start). */
export function detectBeats(env: number[], hop = ENVELOPE_HOP_SECONDS): { bpm: number; beats: number[] } {
  const raw = onsetStrength(env);
  const duration = env.length * hop;
  if (duration < 2) return { bpm: 0, beats: [] };
  const coarse = estimateBpm(raw, hop);
  const onset = smooth(raw, 1);
  const at = (t: number) => {
    const x = t / hop;
    const i = Math.floor(x);
    const f = x - i;
    return (onset[i] ?? 0) * (1 - f) + (onset[i + 1] ?? 0) * f;
  };
  // Comb search: fine tempo around the coarse estimate × phase.
  let best = { score: -Infinity, per: 60 / coarse, ph: 0 };
  for (let bpm = coarse - 5; bpm <= coarse + 5; bpm += 0.1) {
    const per = 60 / bpm;
    for (let ph = 0; ph < per; ph += hop / 2) {
      let s = 0;
      let n = 0;
      for (let t = ph; t < duration; t += per, n++) s += at(t);
      const score = s / Math.max(1, n);
      if (score > best.score) best = { score, per, ph };
    }
  }
  const beats: number[] = [];
  for (let t = best.ph; t < duration; t += best.per) beats.push(Number(t.toFixed(4)));
  return { bpm: Number((60 / best.per).toFixed(1)), beats };
}

export interface MontageOptions {
  /** Cut every N beats (1, 2 or 4). */
  everyBeats: number;
  /** Mute the footage's own audio so only the music plays. */
  muteClips: boolean;
  /** Alternate a punch-in zoom on every other cut. */
  punchIn: boolean;
  /** Short flash on every cut. */
  flash: boolean;
}

/**
 * Re-cut the main video track to the music: each segment between beats takes
 * the next unused piece of footage, cycling through the clips round-robin.
 */
export function beatSyncMontage(
  p: Project,
  musicClipId: string,
  beatsInSource: number[],
  opts: MontageOptions
): { project: Project; cuts: number } {
  const music = p.clips[musicClipId];
  const track = p.tracks.find((t) => t.kind === "video" && clipsOnTrack(p, t.id).some((c) => c.type === "media"));
  if (!music || music.type !== "media" || !track) return { project: p, cuts: 0 };
  const sources = clipsOnTrack(p, track.id).filter((c): c is MediaClip => c.type === "media");
  if (!sources.length) return { project: p, cuts: 0 };

  // Beats on the timeline, within the music clip.
  const beats = beatsInSource
    .filter((b) => b >= music.in && b <= music.out)
    .map((b) => music.start + (b - music.in) / music.speed);
  const step = Math.max(1, Math.round(opts.everyBeats));
  const marks = [music.start, ...beats.filter((_, i) => i % step === 0), music.start + clipDuration(music)];
  const bounds = [...new Set(marks.map((m) => Number(m.toFixed(4))))].sort((a, b) => a - b).filter((m, i, a) => i === 0 || m - a[i - 1] > 0.08);

  const cursor = new Map(sources.map((c) => [c.id, c.in]));
  const clips = { ...p.clips };
  for (const c of sources) delete clips[c.id];
  let k = 0;
  let si = 0;
  for (let b = 0; b < bounds.length - 1; b++) {
    const len = bounds[b + 1] - bounds[b];
    // Find the next source with enough footage left.
    let src: MediaClip | undefined;
    for (let tries = 0; tries < sources.length; tries++) {
      const c = sources[(si + tries) % sources.length];
      const isImage = p.assets[c.assetId]?.kind === "image";
      if (isImage || c.out - cursor.get(c.id)! >= len * c.speed - 1e-6) {
        src = c;
        si = (si + tries + 1) % sources.length;
        break;
      }
    }
    if (!src) break; // footage exhausted
    const isImage = p.assets[src.assetId]?.kind === "image";
    const from = isImage ? 0 : cursor.get(src.id)!;
    const piece: MediaClip = {
      ...src,
      id: uid("c"),
      start: bounds[b],
      in: from,
      out: from + len * src.speed,
      fadeIn: 0,
      fadeOut: 0,
      transIn: opts.flash && k > 0 ? { id: "flash", duration: Math.min(0.15, len / 2) } : undefined,
      transOut: undefined,
      volume: opts.muteClips ? 0 : src.volume,
      keyframes: undefined,
      effects: (src.effects ?? []).filter((e) => e.id !== "punch-in").concat(opts.punchIn && k % 2 === 1 ? [{ id: "punch-in", amount: 0.4 }] : []),
    };
    if (!isImage) cursor.set(src.id, piece.out);
    clips[piece.id] = piece;
    k++;
  }
  return { project: { ...p, clips }, cuts: Math.max(0, k - 1) };
}

/** The music clip to sync to: the longest clip on an audio track. */
export function findMusicClip(p: Project): MediaClip | undefined {
  return p.tracks
    .filter((t) => t.kind === "audio")
    .flatMap((t) => clipsOnTrack(p, t.id))
    .filter((c): c is MediaClip => c.type === "media")
    .sort((a, b) => clipDuration(b) - clipDuration(a))[0];
}
