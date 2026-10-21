/** Brand kit: your logo, fonts and colours applied to the whole edit in one click. */
import { addAsset, addTrack, placeAsset, projectDuration, updateClip } from "../core/project";
import type { Clip, Project } from "../core/types";
import { useEditor } from "../store";
import { isTauri, probe } from "./backend";

const S = () => useEditor.getState();

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface BrandKit {
  logoPath: string;
  logoCorner: Corner;
  logoSize: number;
  logoOpacity: number;
  font: string;
  primary: string;
  accent: string;
}

export const BRAND_FONTS = ["Montserrat ExtraBold", "Poppins", "Bebas Neue", "Bangers", "DM Serif Display", "Courier Prime"];

export const DEFAULT_BRAND: BrandKit = { logoPath: "", logoCorner: "top-right", logoSize: 0.12, logoOpacity: 0.85, font: "Montserrat ExtraBold", primary: "#ffffff", accent: "#8b5cf6" };

export function loadBrand(): BrandKit {
  try {
    return { ...DEFAULT_BRAND, ...JSON.parse(localStorage.getItem("cm.brand") ?? "{}") };
  } catch {
    return { ...DEFAULT_BRAND };
  }
}
export function saveBrand(b: BrandKit) {
  try {
    localStorage.setItem("cm.brand", JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
}

export async function pickLogo(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, filters: [{ name: "Logo", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }] });
  return typeof r === "string" ? r : null;
}

export const LOGO_ASSET = "brand_logo";

/** Logo position (centre, 0..1) inside a safe margin. */
export function cornerPos(c: Corner, size: number, W: number, H: number) {
  const m = 0.04;
  const half = size / 2;
  const hy = (size * W) / H / 2;
  return {
    x: c.endsWith("left") ? m + half : 1 - m - half,
    y: c.startsWith("top") ? m + hy : 1 - m - hy,
  };
}

/** Pure: restyle text clips and captions with the brand. */
export function brandProject(p: Project, b: BrandKit): Project {
  const clips: Record<string, Clip> = {};
  for (const c of Object.values(p.clips)) clips[c.id] = c.type === "text" ? { ...c, color: b.primary, accent: b.accent } : c;
  return { ...p, clips, captionSettings: { ...p.captionSettings, brand: { font: b.font, color: b.primary, highlight: b.accent } } };
}

export async function applyBrand(b: BrandKit): Promise<string> {
  let p = brandProject(S().project, b);
  // Replace any previous logo watermark.
  const old = Object.values(p.clips).filter((c) => c.type === "media" && c.assetId === LOGO_ASSET);
  if (old.length) p = { ...p, clips: Object.fromEntries(Object.entries(p.clips).filter(([, c]) => !old.includes(c))) };
  let msg = "Brand fonts and colours applied to text and captions.";
  const total = projectDuration(p);
  if (b.logoPath && total > 0) {
    const info = await probe(b.logoPath, b.logoPath.split(/[\\/]/).pop() ?? "logo");
    p = addAsset(p, { id: LOGO_ASSET, path: b.logoPath, name: "Brand logo", ...info, kind: "image" });
    const before = new Set(p.tracks.map((t) => t.id));
    p = addTrack(p, "video");
    const trackId = p.tracks.find((t) => !before.has(t.id))!.id;
    const r = placeAsset(p, LOGO_ASSET, trackId, 0);
    if (r.clipId) {
      const pos = cornerPos(b.logoCorner, b.logoSize, p.settings.width, p.settings.height);
      p = updateClip(r.project, r.clipId, { out: total, transform: { ...pos, scale: b.logoSize, rotation: 0, opacity: b.logoOpacity } });
      msg = "Brand applied: logo watermark, fonts and colours.";
    }
  }
  S().commit(() => p);
  return msg;
}
