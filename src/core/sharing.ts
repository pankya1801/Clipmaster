/**
 * Shareable templates: save an edit (cuts, timing, effects, text, captions
 * style) without the media, then reuse it with new clips. Every media asset
 * becomes a numbered slot; generated visuals and stickers stay built in.
 */
import { GEN_PREFIX } from "./visuals";
import type { Clip, MediaAsset, Project } from "./types";

export const TEMPLATE_VERSION = 1;

export interface TemplateSlot {
  id: string;
  /** What to put here. */
  kind: MediaAsset["kind"];
  /** Seconds of the original media the edit uses (from its clips). */
  needs: number;
  label: string;
}

export interface ShareTemplate {
  clipmasterTemplate: typeof TEMPLATE_VERSION;
  name: string;
  slots: TemplateSlot[];
  /** Project with slot assets emptied (paths blank). */
  project: Project;
}

const builtIn = (a: MediaAsset) => a.path.startsWith(GEN_PREFIX) || a.id.startsWith("stk_");

/** Turn a project into a template: user media → slots, in timeline order. */
export function makeTemplate(p: Project, name = p.name): ShareTemplate {
  const firstUse = new Map<string, number>();
  const needs = new Map<string, number>();
  for (const c of Object.values(p.clips)) {
    if (c.type !== "media") continue;
    firstUse.set(c.assetId, Math.min(firstUse.get(c.assetId) ?? Infinity, c.start));
    needs.set(c.assetId, Math.max(needs.get(c.assetId) ?? 0, c.out));
  }
  const user = Object.values(p.assets)
    .filter((a) => !builtIn(a) && firstUse.has(a.id))
    .sort((a, b) => firstUse.get(a.id)! - firstUse.get(b.id)!);
  const slots: TemplateSlot[] = user.map((a, i) => ({
    id: a.id,
    kind: a.kind,
    needs: Math.round((needs.get(a.id) ?? 0) * 100) / 100,
    label: `${a.kind === "audio" ? "Music" : a.kind === "image" ? "Photo" : "Clip"} ${i + 1}`,
  }));
  const assets = Object.fromEntries(
    Object.entries(p.assets)
      .filter(([id]) => builtIn(p.assets[id]) || slots.some((s) => s.id === id))
      .map(([id, a]) => [id, builtIn(a) ? a : { ...a, path: "", name: slots.find((s) => s.id === id)!.label }])
  );
  // Keep only clips that use slots or built-ins; drop unused assets.
  const project: Project = { ...p, name, assets, captions: [] };
  return { clipmasterTemplate: TEMPLATE_VERSION, name, slots, project };
}

export function isTemplate(x: unknown): x is ShareTemplate {
  return !!x && typeof x === "object" && (x as ShareTemplate).clipmasterTemplate === TEMPLATE_VERSION && Array.isArray((x as ShareTemplate).slots);
}

/**
 * Fill a template's slots with new media. Clips are kept; if a new clip is
 * shorter than the template needs, its clips are shortened to fit.
 */
export function fillTemplate(t: ShareTemplate, media: Record<string, MediaAsset>): { project: Project; missing: string[] } {
  const missing = t.slots.filter((s) => !media[s.id]).map((s) => s.label);
  const assets = { ...t.project.assets };
  for (const s of t.slots) {
    const m = media[s.id];
    if (m) assets[s.id] = { ...m, id: s.id };
  }
  const clips = Object.fromEntries(
    Object.entries(t.project.clips).flatMap(([id, c]): [string, Clip][] => {
      if (c.type !== "media") return [[id, c]];
      const a = assets[c.assetId];
      if (!a || !a.path) return [];
      if (a.kind === "image" || c.out <= a.duration + 1e-6) return [[id, c]];
      // Shorter media: slide the window back, then trim if still too long.
      const len = c.out - c.in;
      const inPt = Math.max(0, a.duration - len);
      return [[id, { ...c, in: inPt, out: Math.min(a.duration, inPt + len) }]];
    })
  );
  return { project: { ...t.project, assets, clips }, missing };
}
