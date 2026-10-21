/** Stock footage: search Pexels / Pixabay, download, and add to the edit. */
import { addAsset, placeAsset, uid, updateClip } from "../core/project";
import { brollCues, orientationOf, parseResults, searchUrl, StockItem, StockKind, StockProvider, stockFileName } from "../core/stock";
import type { MediaAsset, Project } from "../core/types";
import { useEditor } from "../store";
import { freeTopVideoTrack } from "./actions";
import { invoke, isTauri, probe, thumbnail } from "./backend";

const S = () => useEditor.getState();

export interface StockKeys {
  pexels: string;
  pixabay: string;
}

export function loadStockKeys(): StockKeys {
  try {
    return { pexels: "", pixabay: "", ...JSON.parse(localStorage.getItem("cm.stock") ?? "{}") };
  } catch {
    return { pexels: "", pixabay: "" };
  }
}

export function saveStockKeys(k: StockKeys) {
  try {
    localStorage.setItem("cm.stock", JSON.stringify(k));
  } catch {
    /* storage unavailable */
  }
}

export const hasStockKey = () => {
  const k = loadStockKeys();
  return !!(k.pexels || k.pixabay);
};

/** Short side of the project, so downloads aren't bigger than needed. */
const targetSize = () => Math.min(S().project.settings.width, S().project.settings.height);

export async function searchStock(provider: StockProvider, kind: StockKind, query: string, page = 1, orientation?: "landscape" | "portrait" | "square"): Promise<StockItem[]> {
  if (!isTauri) throw new Error("Stock search needs the desktop app.");
  const key = loadStockKeys()[provider];
  if (!key) throw new Error(`Add your free ${provider === "pexels" ? "Pexels" : "Pixabay"} API key in Settings → Stock first.`);
  if (!query.trim()) return [];
  const req = searchUrl(provider, kind, query, key, { page, orientation, perPage: 24 });
  const json = JSON.parse(await invoke<string>("stock_search", req));
  return parseResults(provider, kind, json, targetSize());
}

/** Download a stock item (once) and add it to the media library. */
export async function importStock(item: StockItem): Promise<MediaAsset> {
  const existing = Object.values(S().project.assets).find((a) => a.credit?.pageUrl === item.pageUrl && a.path);
  if (existing) return existing;
  const path = await invoke<string>("stock_download", { url: item.url, name: stockFileName(item) });
  const name = `${item.provider === "pexels" ? "Pexels" : "Pixabay"} · ${item.author}`;
  const info = await probe(path, name);
  const asset: MediaAsset = { id: uid("a"), path, name, ...info, credit: { provider: item.provider, author: item.author, pageUrl: item.pageUrl } };
  S().commit((p) => addAsset(p, asset));
  thumbnail(asset.path, asset.kind, Math.min(1, asset.duration / 2)).then((url) => S().setThumb(asset.id, url));
  return asset;
}

/** Add a stock clip as B-roll at the playhead (on top, muted, filling the frame). */
export async function addStockAtPlayhead(item: StockItem, length = 4): Promise<string> {
  const asset = await importStock(item);
  const at = S().playhead;
  const len = asset.kind === "video" ? Math.min(length, asset.duration) : length;
  const r = placeOnTop(S().project, asset.id, at, len);
  if (!r.clipId) throw new Error("Couldn't place the clip.");
  S().commit(() => r.project);
  S().select([r.clipId]);
  return `Added ${asset.name}.`;
}

function placeOnTop(p0: Project, assetId: string, at: number, len: number): { project: Project; clipId?: string } {
  const tr = freeTopVideoTrack(p0, at, len);
  const r = placeAsset(tr.project, assetId, tr.trackId, at);
  if (!r.clipId) return r;
  const a = r.project.assets[assetId];
  const patch = a.kind === "video" ? { out: Math.min(a.duration, len), volume: 0, fit: "fill" as const } : { out: len, fit: "fill" as const };
  return { project: updateClip(r.project, r.clipId, patch), clipId: r.clipId };
}

/**
 * Automatic stock B-roll: find what is being talked about in the captions
 * and cover those moments with matching stock clips.
 */
export async function autoStockBroll(onProgress: (msg: string) => void, opts: { every?: number; length?: number; max?: number } = {}): Promise<string> {
  const { project } = S();
  if (!project.captions.length) throw new Error("Add captions first (✨ Auto captions). Stock B-roll follows what is said.");
  const keys = loadStockKeys();
  const providers = (["pexels", "pixabay"] as StockProvider[]).filter((p) => keys[p]);
  if (!providers.length) throw new Error("Add a free Pexels or Pixabay API key in Settings → Stock first.");
  const orientation = orientationOf(project.settings.width, project.settings.height);
  const cues = brollCues(project.captions, { every: opts.every ?? 8, length: opts.length ?? 3, max: opts.max ?? 8 });
  if (!cues.length) throw new Error("Couldn't find good moments for B-roll.");
  // With an AI key, ask for visual search phrases ("aerial snowy mountains").
  const { hasLlm, refineBrollQueries } = await import("./ai");
  if (hasLlm()) {
    onProgress("Choosing B-roll shots…");
    const refined = await refineBrollQueries(cues);
    refined.forEach((q, i) => (cues[i] = { ...cues[i], query: q }));
  }
  const used = new Set<string>();
  let added = 0;
  for (const [i, cue] of cues.entries()) {
    onProgress(`Finding “${cue.query}” (${i + 1}/${cues.length})…`);
    let item: StockItem | undefined;
    for (const prov of providers) {
      const query = async (q: string) => (await searchStock(prov, "video", q, 1, orientation === "square" ? undefined : orientation).catch(() => [] as StockItem[]))
        .filter((x) => !used.has(x.pageUrl) && x.duration >= cue.end - cue.start);
      let found = await query(cue.query);
      if (!found.length && cue.query.includes(" ")) found = await query(cue.query.split(" ").slice(-2).join(" "));
      if (!found.length && cue.query.includes(" ")) found = await query(cue.query.split(" ").pop()!);
      item = found[0];
      if (item) break;
    }
    if (!item) continue;
    used.add(item.pageUrl);
    onProgress(`Downloading “${cue.query}” (${i + 1}/${cues.length})…`);
    try {
      const asset = await importStock(item);
      const r = placeOnTop(S().project, asset.id, cue.start, cue.end - cue.start);
      if (r.clipId) {
        S().commit(() => r.project);
        added++;
      }
    } catch {
      /* skip this one */
    }
  }
  if (!added) throw new Error("No matching stock clips found.");
  return `Added ${added} stock B-roll clip${added > 1 ? "s" : ""}. Credits: Media tab → Copy stock credits.`;
}

/** Credit lines for the stock media used in the project (for the video description). */
export function stockCredits(p: Project): string {
  const used = new Set(Object.values(p.clips).flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
  const lines = Object.values(p.assets)
    .filter((a) => a.credit && used.has(a.id))
    .map((a) => `${a.credit!.author} on ${a.credit!.provider === "pexels" ? "Pexels" : "Pixabay"}: ${a.credit!.pageUrl}`);
  return [...new Set(lines)].join("\n");
}
