/**
 * Built-in visuals that need no media files:
 * - generated backgrounds (animated gradients) and overlays (light leaks,
 *   bokeh, confetti, snow, dust, VHS lines) rendered by FFmpeg sources;
 * - stickers (emoji, arrows, badges) rendered to PNG in the app;
 * - shape masks and split-screen layouts for clips;
 * - intro / outro templates.
 * Particle motion is a pure function of time, used both for the FFmpeg
 * expressions and the CSS preview so they match.
 */
import type { Keyframe, Project, Transform } from "./types";

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();

// ---------------------------------------------------------------- particles

export interface Particle {
  /** Start position, 0..1 of the frame. */
  x: number;
  y: number;
  /** Fall speed in frame-heights per second (negative = rise). */
  vy: number;
  /** Sideways sway amplitude (0..1 of width) and frequency (rad/s). */
  sway: number;
  freq: number;
  phase: number;
  /** Size, fraction of frame height. */
  size: number;
  color: string; // #rrggbb
  alpha: number;
}

/** Small deterministic PRNG (mulberry32), so every render is identical. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particle position at time t (wraps around vertically). */
export function particleAt(p: Particle, t: number) {
  const span = 1 + 2 * p.size;
  let y = (p.y + p.vy * t) % span;
  if (y < 0) y += span;
  return { x: p.x + p.sway * Math.sin(p.freq * t + p.phase), y: y - p.size };
}

function particles(seed: number, count: number, make: (r: () => number) => Omit<Particle, "x" | "y" | "phase">): Particle[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({ x: r(), y: r(), phase: r() * Math.PI * 2, ...make(r) }));
}

/** drawbox filters animating particles over a transparent W×H canvas. */
function particleBoxes(ps: Particle[], W: number, H: number): string[] {
  return ps.map((p) => {
    const span = 1 + 2 * p.size;
    const s = Math.max(2, Math.round(p.size * H));
    const y = `(mod(${n(p.y)}+${n(p.vy)}*t+${n(span * 100)}\\,${n(span)})-${n(p.size)})*${H}`;
    const x = `(${n(p.x)}+${n(p.sway)}*sin(${n(p.freq)}*t+${n(p.phase)}))*${W}`;
    return `drawbox=x='${x}':y='${y}':w=${s}:h=${s}:color=${p.color}@${n(p.alpha)}:t=fill:replace=1`;
  });
}

/** CSS radial-gradient dots for the same particles at time t (preview). */
function particleCss(ps: Particle[], t: number, soft = false): string {
  return ps
    .map((p) => {
      const { x, y } = particleAt(p, t);
      const r = Math.max(0.3, p.size * 50);
      const c = hexA(p.color, p.alpha);
      return soft
        ? `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${c} 0, transparent ${r * 2.2}%)`
        : `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${c} 0 ${r}%, transparent ${r * 1.15}%)`;
    })
    .join(",");
}

function hexA(hex: string, a: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length) % xs.length];

const CONFETTI = particles(7, 46, (r) => ({ vy: 0.18 + r() * 0.22, sway: 0.02 + r() * 0.03, freq: 1 + r() * 2, size: 0.008 + r() * 0.008, color: pick(r, CONFETTI_COLORS), alpha: 1 }));
const SNOW = particles(11, 60, (r) => ({ vy: 0.05 + r() * 0.07, sway: 0.01 + r() * 0.02, freq: 0.5 + r(), size: 0.003 + r() * 0.005, color: "#ffffff", alpha: 0.75 + r() * 0.25 }));
const BOKEH = particles(23, 14, (r) => ({ vy: -(0.01 + r() * 0.02), sway: 0.02, freq: 0.3 + r() * 0.3, size: 0.05 + r() * 0.07, color: pick(r, ["#fde68a", "#fca5a5", "#f9a8d4", "#ffffff", "#93c5fd"]), alpha: 0.35 + r() * 0.25 }));
const SPARKLE = particles(31, 26, (r) => ({ vy: -(0.03 + r() * 0.05), sway: 0.01, freq: 2 + r() * 3, size: 0.004 + r() * 0.004, color: pick(r, ["#fff7d6", "#fde68a", "#ffffff"]), alpha: 0.9 }));

// ---------------------------------------------------------------- generators

export interface Generator {
  id: string;
  name: string;
  category: "background" | "overlay";
  /** lavfi source graph for a W×H clip of `dur` seconds (rgba for overlays). */
  source: (W: number, H: number, fps: number, dur: number) => string;
  /** CSS `background` for the preview at clip-local time t. */
  css: (t: number) => string;
  /** Extra CSS for the preview layer (blend mode, blur). */
  style?: Record<string, string>;
}

const grad = (id: string, name: string, colors: string[], type: 0 | 1 | 2 | 3 = 0, speed = 0.015): Generator => ({
  id,
  name,
  category: "background",
  source: (W, H, fps, dur) =>
    `gradients=s=${W}x${H}:r=${fps}:d=${n(dur)}:n=${colors.length}:${colors.map((c, i) => `c${i}=0x${c.slice(1)}`).join(":")}:speed=${speed}:type=${type}:seed=1,format=yuv420p`,
  css: (t) => {
    const a = Math.round((t * speed * 360 * 10) % 360);
    return type === 1 || type === 2
      ? `radial-gradient(circle at ${50 + 20 * Math.sin(t * speed * 20)}% ${50 + 20 * Math.cos(t * speed * 20)}%, ${colors.join(", ")})`
      : `linear-gradient(${a}deg, ${colors.join(", ")})`;
  },
});

const overlay = (id: string, name: string, build: (W: number, H: number) => string[], css: (t: number) => string, style?: Record<string, string>, scaleDown = 1, base = "black"): Generator => ({
  id,
  name,
  category: "overlay",
  source: (W, H, fps, dur) => {
    const w = Math.max(2, Math.round(W / scaleDown / 2) * 2);
    const h = Math.max(2, Math.round(H / scaleDown / 2) * 2);
    const chain = [`color=c=${base}@0:s=${w}x${h}:r=${fps}:d=${n(dur)}`, "format=rgba", ...build(w, h)];
    if (scaleDown > 1) chain.push(`scale=${W}:${H}`);
    return chain.join(",");
  },
  css,
  style,
});

export const GENERATORS: Generator[] = [
  grad("bg-sunset", "Sunset", ["#ff7e5f", "#feb47b", "#6a3093"]),
  grad("bg-ocean", "Ocean", ["#00c6ff", "#0072ff", "#001f54"]),
  grad("bg-aurora", "Aurora", ["#00f5a0", "#00d9f5", "#7b2ff7"], 0, 0.02),
  grad("bg-neon", "Neon night", ["#ff00cc", "#333399", "#0f0c29"], 2),
  grad("bg-peach", "Peach", ["#ffecd2", "#fcb69f", "#ff9a9e"]),
  grad("bg-forest", "Forest", ["#134e5e", "#71b280", "#0b3d2e"]),
  grad("bg-fire", "Fire", ["#f12711", "#f5af19", "#2b0a00"], 1),
  grad("bg-mono", "Studio grey", ["#3a3a40", "#1b1b20", "#0b0b0d"], 1, 0.005),
  grad("bg-candy", "Candy", ["#a18cd1", "#fbc2eb", "#8fd3f4"], 0, 0.02),
  grad("bg-spiral", "Hypno spiral", ["#7f00ff", "#e100ff", "#120024"], 3, 0.03),
  {
    id: "ov-lightleak",
    name: "Light leak",
    category: "overlay",
    source: (W, H, fps, dur) =>
      `gradients=s=${W}x${H}:r=${fps}:d=${n(dur)}:n=3:c0=0xff8c28aa:c1=0xff3c1450:c2=0x00000000:x0=${Math.round(W * 0.25)}:y0=${Math.round(H * 0.3)}:x1=${Math.round(W * 1.05)}:y1=${Math.round(H * 0.9)}:type=1:speed=0.02:seed=3,format=rgba`,
    css: (t) =>
      `radial-gradient(ellipse at ${20 + 60 * (0.5 + 0.5 * Math.sin(t * 0.6))}% ${30 + 20 * Math.cos(t * 0.4)}%, rgba(255,140,40,.55), rgba(255,60,20,.25) 35%, transparent 65%)`,
    style: { mixBlendMode: "screen" },
  },
  overlay("ov-bokeh", "Bokeh lights", (w, h) => [...particleBoxes(BOKEH, w, h), "boxblur=6:2"], (t) => particleCss(BOKEH, t, true), { mixBlendMode: "screen" }, 4, "white"),
  overlay("ov-confetti", "Confetti", (w, h) => particleBoxes(CONFETTI, w, h), (t) => particleCss(CONFETTI, t)),
  overlay("ov-snow", "Snow", (w, h) => particleBoxes(SNOW, w, h), (t) => particleCss(SNOW, t)),
  overlay("ov-sparkle", "Sparkles", (w, h) => [...particleBoxes(SPARKLE, w, h), "gblur=sigma=1"], (t) => particleCss(SPARKLE, t, true), { mixBlendMode: "screen" }, 1, "white"),
  overlay(
    "ov-dust", "Film dust",
    (w, h) => Array.from({ length: 10 }, (_, k) => {
      const s = Math.max(2, Math.round(h * 0.004));
      return `drawbox=x='mod(floor(t*12)*${7919 + k * 31}+${k * 104729}\\,${w})':y='mod(floor(t*12)*${6271 + k * 17}+${k * 7727}\\,${h})':w=${s}:h=${s * (k % 3 ? 1 : 4)}:color=${k % 2 ? "white" : "black"}@0.7:t=fill:replace=1`;
    }),
    (t) => {
      const f = Math.floor(t * 12);
      return Array.from({ length: 10 }, (_, k) => {
        const x = ((f * (7919 + k * 31) + k * 104729) % 1000) / 10;
        const y = ((f * (6271 + k * 17) + k * 7727) % 1000) / 10;
        return `radial-gradient(circle at ${x}% ${y}%, ${k % 2 ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.7)"} 0 .25%, transparent .3%)`;
      }).join(",");
    }
  ),
  overlay(
    "ov-vhs", "VHS lines",
    (w, h) => [`drawgrid=w=${w}:h=4:t=1:c=black@0.35:replace=1`, `drawbox=x=0:y='mod(t*${Math.round(h * 0.35)}\\,${h})':w=${w}:h=${Math.max(2, Math.round(h * 0.04))}:color=white@0.12:t=fill:replace=1`],
    (t) => `linear-gradient(transparent ${((t * 35) % 100).toFixed(1)}%, rgba(255,255,255,.12) ${((t * 35) % 100).toFixed(1)}% ${(((t * 35) % 100) + 4).toFixed(1)}%, transparent ${(((t * 35) % 100) + 4).toFixed(1)}%), repeating-linear-gradient(rgba(0,0,0,.35) 0 1px, transparent 1px 4px)`
  ),
];

export const generatorById = (id?: string) => GENERATORS.find((g) => g.id === id);

// ---------------------------------------------------------------- stickers

export interface Sticker {
  id: string;
  name: string;
  /** Emoji character, or a built-in drawing. */
  emoji?: string;
  draw?: "arrow-right" | "arrow-left" | "arrow-down" | "arrow-curve" | "circle" | "underline" | "burst" | "badge-new" | "badge-wow" | "check" | "cross";
  color?: string;
}

export const STICKERS: Sticker[] = [
  ...["🔥", "😂", "😍", "🤯", "😱", "👍", "👏", "🙌", "💯", "✨", "⭐", "❤️", "💥", "🎉", "👀", "🤔", "😎", "🚀", "💰", "📌", "⚡", "🏆", "✅", "❌"].map((e, i) => ({ id: `emoji-${i}`, name: e, emoji: e })),
  { id: "arrow-right", name: "Arrow →", draw: "arrow-right", color: "#facc15" },
  { id: "arrow-left", name: "Arrow ←", draw: "arrow-left", color: "#facc15" },
  { id: "arrow-down", name: "Arrow ↓", draw: "arrow-down", color: "#f43f5e" },
  { id: "arrow-curve", name: "Curved arrow", draw: "arrow-curve", color: "#ffffff" },
  { id: "circle", name: "Circle it", draw: "circle", color: "#f43f5e" },
  { id: "underline", name: "Underline", draw: "underline", color: "#facc15" },
  { id: "burst", name: "Burst", draw: "burst", color: "#facc15" },
  { id: "badge-new", name: "NEW badge", draw: "badge-new", color: "#ef4444" },
  { id: "badge-wow", name: "WOW badge", draw: "badge-wow", color: "#8b5cf6" },
  { id: "check", name: "Check", draw: "check", color: "#22c55e" },
  { id: "cross", name: "Cross", draw: "cross", color: "#ef4444" },
];

export const stickerById = (id: string) => STICKERS.find((s) => s.id === id);

/** Pop-in (overshoot) then a gentle idle wobble, as transform keyframes. */
export function stickerKeyframes(at: { x: number; y: number }, scale: number, duration: number, wobble = true): Keyframe[] {
  const base: Transform = { x: at.x, y: at.y, scale, rotation: 0, opacity: 1 };
  const keys: Keyframe[] = [
    { ...base, t: 0, scale: scale * 0.2 },
    { ...base, t: 0.18, scale: scale * 1.15 },
    { ...base, t: 0.3, scale },
  ];
  if (wobble) {
    for (let t = 0.8, i = 0; t < duration - 0.2; t += 0.8, i++) keys.push({ ...base, t, rotation: i % 2 ? 354 : 6 });
  }
  return keys;
}

// ---------------------------------------------------------------- masks & layouts

export type MaskShape = "circle" | "rounded";

export const MASKS: { id: MaskShape | undefined; label: string }[] = [
  { id: undefined, label: "None" },
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Circle" },
];

/** geq alpha mask (works on any frame size; 1.5px anti-aliased edge). */
export function maskFilter(shape: MaskShape | undefined): string | null {
  const pass = "lum='lum(X\\,Y)':cb='cb(X\\,Y)':cr='cr(X\\,Y)'";
  if (shape === "circle") return `geq=${pass}:a='alpha(X\\,Y)*clip((min(W\\,H)/2-hypot(X-W/2\\,Y-H/2))*1.5\\,0\\,1)'`;
  if (shape === "rounded") {
    const r = "(min(W\\,H)*0.08)";
    const dx = `max(abs(X-W/2)-(W/2-${r})\\,0)`;
    const dy = `max(abs(Y-H/2)-(H/2-${r})\\,0)`;
    return `geq=${pass}:a='alpha(X\\,Y)*clip((${r}-hypot(${dx}\\,${dy}))*1.5\\,0\\,1)'`;
  }
  return null;
}

/** Preview: CSS clip-path matching maskFilter for a box of w×h pixels. */
export function maskCss(shape: MaskShape | undefined, w: number, h: number): string | undefined {
  if (shape === "circle") return "circle(closest-side)";
  if (shape === "rounded") return `inset(0 round ${Math.round(Math.min(w, h) * 0.08)}px)`;
  return undefined;
}

/** Region of the frame a clip fills (0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LAYOUTS: { id: string; label: string; box?: Box }[] = [
  { id: "full", label: "Full" },
  { id: "top", label: "Top half", box: { x: 0, y: 0, w: 1, h: 0.5 } },
  { id: "bottom", label: "Bottom half", box: { x: 0, y: 0.5, w: 1, h: 0.5 } },
  { id: "left", label: "Left half", box: { x: 0, y: 0, w: 0.5, h: 1 } },
  { id: "right", label: "Right half", box: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  { id: "top-2/3", label: "Top ⅔", box: { x: 0, y: 0, w: 1, h: 2 / 3 } },
  { id: "bottom-1/3", label: "Bottom ⅓", box: { x: 0, y: 2 / 3, w: 1, h: 1 / 3 } },
  { id: "card", label: "Card", box: { x: 0.08, y: 0.2, w: 0.84, h: 0.6 } },
];

/** Pixel size of a layout box (even numbers, for FFmpeg). */
export function boxPixels(b: Box, W: number, H: number) {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { w: even(b.w * W), h: even(b.h * H) };
}

// ---------------------------------------------------------------- intros / outros

export interface IntroTemplate {
  id: string;
  name: string;
  kind: "intro" | "outro";
  /** Background generator id. */
  bg: string;
  /** Optional overlay generator id. */
  overlay?: string;
  /** Text preset id (textPresets.ts) and default text. */
  preset: string;
  text: string;
  duration: number;
}

export const INTROS: IntroTemplate[] = [
  { id: "intro-pop", name: "Pop title", kind: "intro", bg: "bg-candy", overlay: "ov-sparkle", preset: "pop-title", text: "My Video", duration: 3 },
  { id: "intro-cinema", name: "Cinematic", kind: "intro", bg: "bg-mono", overlay: "ov-lightleak", preset: "cinematic-title", text: "A FILM BY YOU", duration: 4 },
  { id: "intro-neon", name: "Neon", kind: "intro", bg: "bg-neon", overlay: "ov-bokeh", preset: "neon-title", text: "LET'S GO", duration: 3 },
  { id: "intro-chapter", name: "Chapter card", kind: "intro", bg: "bg-ocean", preset: "chapter", text: "Chapter 1\nThe beginning", duration: 3 },
  { id: "intro-party", name: "Party", kind: "intro", bg: "bg-sunset", overlay: "ov-confetti", preset: "pop-title", text: "Happy Birthday!", duration: 3 },
  { id: "intro-retro", name: "Retro VHS", kind: "intro", bg: "bg-spiral", overlay: "ov-vhs", preset: "typewriter", text: "PLAY ▶", duration: 3 },
  { id: "outro-subscribe", name: "Subscribe", kind: "outro", bg: "bg-aurora", overlay: "ov-sparkle", preset: "subscribe", text: "SUBSCRIBE", duration: 4 },
  { id: "outro-thanks", name: "Thanks for watching", kind: "outro", bg: "bg-peach", overlay: "ov-bokeh", preset: "pop-title", text: "Thanks for watching!", duration: 3 },
  { id: "outro-follow", name: "Follow me", kind: "outro", bg: "bg-forest", preset: "follow", text: "Follow for more", duration: 3 },
];

export const introById = (id: string) => INTROS.find((t) => t.id === id);

/** Generated assets are stored with this pseudo-path prefix. */
export const GEN_PREFIX = "generated:";
export const generatorOfPath = (path: string) => (path.startsWith(GEN_PREFIX) ? generatorById(path.slice(GEN_PREFIX.length)) : undefined);

/** Ensure the project has an asset for a generator; returns its id. */
export function ensureGeneratorAsset(p: Project, genId: string): { project: Project; assetId: string } {
  const id = `gen_${genId}`;
  if (p.assets[id]) return { project: p, assetId: id };
  const g = generatorById(genId)!;
  return {
    project: {
      ...p,
      assets: { ...p.assets, [id]: { id, path: GEN_PREFIX + genId, name: g.name, kind: "image", duration: 0, width: p.settings.width, height: p.settings.height, hasAudio: false } },
    },
    assetId: id,
  };
}
