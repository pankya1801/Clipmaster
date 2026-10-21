/**
 * Stock footage and photos from Pexels and Pixabay (free API keys). This file
 * turns their API responses into one shape and picks search words for
 * automatic B-roll; the network calls go through the Rust backend.
 */
import type { CaptionWord } from "./types";

export type StockProvider = "pexels" | "pixabay";
export type StockKind = "video" | "photo";

export interface StockItem {
  provider: StockProvider;
  id: string;
  kind: StockKind;
  /** Small preview image. */
  thumb: string;
  /** File to download (picked near the wanted size). */
  url: string;
  width: number;
  height: number;
  /** Seconds (videos). */
  duration: number;
  author: string;
  /** Page on the provider's site, for credit. */
  pageUrl: string;
}

export type Orientation = "landscape" | "portrait" | "square";

export function orientationOf(w: number, h: number): Orientation {
  return w > h * 1.1 ? "landscape" : h > w * 1.1 ? "portrait" : "square";
}

/** Hosts the backend may contact for stock search and downloads. */
export const STOCK_HOSTS = ["api.pexels.com", "videos.pexels.com", "images.pexels.com", "player.vimeo.com", "pixabay.com", "cdn.pixabay.com"];

export function searchUrl(provider: StockProvider, kind: StockKind, query: string, key: string, opts: { perPage?: number; page?: number; orientation?: Orientation } = {}) {
  const q = encodeURIComponent(query.trim());
  const per = opts.perPage ?? 24;
  const page = opts.page ?? 1;
  if (provider === "pexels") {
    const o = opts.orientation ? `&orientation=${opts.orientation}` : "";
    const base = kind === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    return { url: `${base}?query=${q}&per_page=${per}&page=${page}${o}`, headers: { Authorization: key } };
  }
  const o = opts.orientation === "portrait" ? "&orientation=vertical" : opts.orientation === "landscape" ? "&orientation=horizontal" : "";
  const base = kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
  return { url: `${base}?key=${encodeURIComponent(key)}&q=${q}&per_page=${Math.max(3, per)}&page=${page}&safesearch=true${kind === "photo" ? "&image_type=photo" : ""}${o}`, headers: {} };
}

/** The rendition whose short side is closest to `target` without going far below it. */
function pick<T extends { width: number; height: number }>(files: T[], target: number): T | undefined {
  const ok = files.filter((f) => f.width > 0 && f.height > 0);
  if (!ok.length) return files[0];
  const score = (f: T) => {
    const s = Math.min(f.width, f.height);
    return s >= target ? s - target : (target - s) * 3;
  };
  return [...ok].sort((a, b) => score(a) - score(b))[0];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseResults(provider: StockProvider, kind: StockKind, json: any, target = 1080): StockItem[] {
  if (provider === "pexels" && kind === "video") {
    return (json?.videos ?? []).flatMap((v: any) => {
      const files = (v.video_files ?? []).filter((f: any) => f.file_type === "video/mp4" && f.link);
      const f = pick(files as { width: number; height: number; link: string }[], target);
      if (!f) return [];
      return [{ provider, kind, id: String(v.id), thumb: v.image, url: f.link, width: f.width || v.width, height: f.height || v.height, duration: v.duration ?? 0, author: v.user?.name ?? "Pexels", pageUrl: v.url }];
    });
  }
  if (provider === "pexels") {
    return (json?.photos ?? []).map((p: any) => {
      const src = p.src ?? {};
      const url = target > 1400 ? src.original : src.large2x ?? src.original;
      return { provider, kind, id: String(p.id), thumb: src.medium ?? src.tiny, url, width: p.width, height: p.height, duration: 0, author: p.photographer ?? "Pexels", pageUrl: p.url };
    });
  }
  if (kind === "video") {
    return (json?.hits ?? []).flatMap((h: any) => {
      const files = ["large", "medium", "small", "tiny"].map((k) => h.videos?.[k]).filter((f: any) => f?.url);
      const f = pick(files as { width: number; height: number; url: string; thumbnail?: string }[], target);
      if (!f) return [];
      const thumb = h.videos?.medium?.thumbnail ?? h.videos?.small?.thumbnail ?? f.thumbnail ?? "";
      return [{ provider, kind, id: String(h.id), thumb, url: f.url, width: f.width, height: f.height, duration: h.duration ?? 0, author: h.user ?? "Pixabay", pageUrl: h.pageURL }];
    });
  }
  return (json?.hits ?? []).map((h: any) => ({
    provider, kind, id: String(h.id), thumb: h.webformatURL ?? h.previewURL, url: h.largeImageURL ?? h.webformatURL,
    width: h.imageWidth, height: h.imageHeight, duration: 0, author: h.user ?? "Pixabay", pageUrl: h.pageURL,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function stockFileName(item: StockItem): string {
  const ext = item.kind === "video" ? "mp4" : (item.url.split("?")[0].match(/\.(jpe?g|png|webp)$/i)?.[1] ?? "jpg").toLowerCase();
  return `${item.provider}-${item.kind}-${item.id}-${Math.min(item.width, item.height)}.${ext}`;
}

// ---------------------------------------------------------------- auto B-roll

const STOP = new Set(
  ("a an the and or but if then so to of in on at by for with from up down out over under about into than too very just also not no yes " +
    "i me my we our you your he him his she her it its they them their this that these those there here what which who whom whose when where why how " +
    "is am are was were be been being have has had do does did doing will would can could should may might must shall " +
    "get got go going gonna wanna make made take took come came know think like really thing things stuff way lot lots kind sort actually basically " +
    "literally right okay ok yeah um uh uhm hmm well oh hey hi guys today now time day let lets let's say said tell see look want need use used one two " +
    "some any all every each more most much many other another same own something anything everything nothing someone people").split(/\s+/)
);

export interface BrollCue {
  /** Timeline seconds. */
  start: number;
  end: number;
  query: string;
}

const clean = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "").replace(/^'+|'+$/g, "");

/**
 * Pick moments for stock B-roll from the captions: one cue per `every`
 * seconds, each with the most telling word (or pair of words) said there.
 */
export function brollCues(words: CaptionWord[], opts: { every?: number; length?: number; max?: number; skipStart?: number } = {}): BrollCue[] {
  const every = opts.every ?? 8;
  const length = opts.length ?? 3;
  const skip = opts.skipStart ?? 2;
  if (!words.length) return [];
  const freq = new Map<string, number>();
  for (const w of words) {
    const c = clean(w.text);
    if (c.length > 2 && !STOP.has(c)) freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  const cues: BrollCue[] = [];
  const end = words[words.length - 1].end;
  const used = new Set<string>();
  for (let t = Math.max(skip, words[0].start); t + 1 < end && cues.length < (opts.max ?? 20); t += every) {
    const win = words.filter((w) => w.start >= t && w.start < t + every);
    let best: { q: string; score: number; at: number } | undefined;
    for (let i = 0; i < win.length; i++) {
      const c = clean(win[i].text);
      if (c.length < 3 || STOP.has(c) || /^\d+$/.test(c)) continue;
      // Longer, rarer words describe things better; repeats across the video less so.
      let score = c.length + (used.has(c) ? -10 : 0) - Math.min(4, (freq.get(c) ?? 1) - 1);
      let q = c;
      const next = win[i + 1] && clean(win[i + 1].text);
      if (next && next.length > 2 && !STOP.has(next)) {
        q = `${c} ${next}`;
        score += 3;
      }
      if (!best || score > best.score) best = { q, score, at: win[i].start };
    }
    if (!best) continue;
    used.add(best.q.split(" ")[0]);
    const s = Math.max(t, best.at - 0.2);
    cues.push({ start: Math.round(s * 100) / 100, end: Math.round(Math.min(end, s + length) * 100) / 100, query: best.q });
  }
  return cues;
}
