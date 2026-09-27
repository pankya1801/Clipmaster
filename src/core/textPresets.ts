/**
 * Animated text & lower-third templates (motion graphics), rendered through
 * ASS subtitles (libass) on export, with a CSS approximation for preview.
 * Multi-line text: first line is the title, following lines the subtitle.
 */
import { assColor, assTime, escapeAss } from "./captions";
import { clipEnd } from "./project";
import type { TextClip } from "./types";

export type PresetAnim = "pop" | "slide-up" | "fade" | "typewriter" | "slide-left" | "glow";

export interface TextPreset {
  id: string;
  name: string;
  category: "Titles" | "Lower thirds" | "Social";
  /** Default text inserted when the template is added. */
  sample: string;
  font: string;
  bold: boolean;
  italic?: boolean;
  uppercase?: boolean;
  color: string;
  accent: string;
  /** Default anchor (0..1) and font size as a fraction of frame height. */
  x: number;
  y: number;
  size: number;
  align: "center" | "left";
  anim: PresetAnim;
  /** Visual treatment. */
  look: "outline" | "box" | "bar" | "banner" | "plain" | "glow";
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: "pop-title", name: "Pop Title", category: "Titles", sample: "Big Announcement", font: "Montserrat ExtraBold", bold: false, uppercase: true, color: "#ffffff", accent: "#8b5cf6", x: 0.5, y: 0.45, size: 0.135, align: "center", anim: "pop", look: "outline" },
  { id: "slide-title", name: "Slide Up", category: "Titles", sample: "Welcome back", font: "Montserrat ExtraBold", bold: false, color: "#ffffff", accent: "#22d3ee", x: 0.5, y: 0.5, size: 0.12, align: "center", anim: "slide-up", look: "outline" },
  { id: "cinematic-title", name: "Cinematic", category: "Titles", sample: "Chapter One", font: "DM Serif Display", bold: false, color: "#f5f0e6", accent: "#f5f0e6", x: 0.5, y: 0.5, size: 0.128, align: "center", anim: "fade", look: "plain" },
  { id: "typewriter", name: "Typewriter", category: "Titles", sample: "Once upon a time…", font: "Courier Prime", bold: false, color: "#ffffff", accent: "#ffffff", x: 0.5, y: 0.5, size: 0.09, align: "center", anim: "typewriter", look: "outline" },
  { id: "neon-title", name: "Neon Glow", category: "Titles", sample: "Night Mode", font: "Bangers", bold: false, color: "#fdf4ff", accent: "#ff2bd6", x: 0.5, y: 0.45, size: 0.165, align: "center", anim: "glow", look: "glow" },
  { id: "quote", name: "Quote", category: "Titles", sample: "“Stay hungry, stay foolish.”", font: "DM Serif Display", bold: false, italic: true, color: "#ffffff", accent: "#ffffff", x: 0.5, y: 0.5, size: 0.098, align: "center", anim: "fade", look: "plain" },
  { id: "lower-third", name: "Lower Third", category: "Lower thirds", sample: "Alex Rivera\nFounder, Clipmaster", font: "Montserrat ExtraBold", bold: false, color: "#ffffff", accent: "#8b5cf6", x: 0.07, y: 0.78, size: 0.083, align: "left", anim: "slide-left", look: "bar" },
  { id: "lower-third-box", name: "Name Box", category: "Lower thirds", sample: "Jordan Lee\nTravel Creator", font: "Poppins", bold: true, color: "#111111", accent: "#ffffff", x: 0.07, y: 0.8, size: 0.075, align: "left", anim: "slide-left", look: "box" },
  { id: "chapter", name: "Chapter Tag", category: "Lower thirds", sample: "Part 1 — The Setup", font: "Poppins", bold: true, uppercase: true, color: "#ffffff", accent: "#f59e0b", x: 0.06, y: 0.1, size: 0.06, align: "left", anim: "slide-left", look: "bar" },
  { id: "breaking", name: "Breaking Banner", category: "Lower thirds", sample: "BREAKING\nWe just hit 10,000 subscribers", font: "Montserrat ExtraBold", bold: false, uppercase: true, color: "#ffffff", accent: "#dc2626", x: 0.05, y: 0.82, size: 0.075, align: "left", anim: "slide-left", look: "banner" },
  { id: "subscribe", name: "Subscribe", category: "Social", sample: "SUBSCRIBE", font: "Montserrat ExtraBold", bold: false, uppercase: true, color: "#ffffff", accent: "#ff0000", x: 0.5, y: 0.82, size: 0.09, align: "center", anim: "pop", look: "box" },
  { id: "follow", name: "Follow Me", category: "Social", sample: "@yourhandle", font: "Poppins", bold: true, color: "#ffffff", accent: "#ec4899", x: 0.5, y: 0.85, size: 0.083, align: "center", anim: "slide-up", look: "box" },
];

export const textPreset = (id?: string) => TEXT_PRESETS.find((p) => p.id === id);

const r = Math.round;

/** ASS events for one preset text clip. */
function presetEvents(c: TextClip, p: TextPreset, W: number, H: number, scale: number): string[] {
  const start = assTime(c.start);
  const end = assTime(clipEnd(c));
  const durMs = r(c.duration * 1000);
  const [title, ...rest] = (p.uppercase ? c.text.toUpperCase() : c.text).split("\n");
  const sub = rest.join(" ");
  const fs = r(c.fontSize * scale);
  const x = r(c.x * W);
  const y = r(c.y * H);
  const an = p.align === "left" ? 7 : 5;
  const col = assColor(c.color);
  const acc = assColor(c.accent ?? p.accent);
  const out: string[] = [];
  const ev = (layer: number, style: string, text: string) => out.push(`Dialogue: ${layer},${start},${end},${style},,0,0,0,,${text}`);
  const fadeOut = `\\fad(0,${Math.min(300, durMs / 3)})`;
  const inMs = Math.min(450, durMs / 3);

  let anim = "";
  switch (p.anim) {
    case "pop":
      anim = `\\pos(${x},${y})\\fscx20\\fscy20\\t(0,${r(inMs * 0.6)},\\fscx112\\fscy112)\\t(${r(inMs * 0.6)},${r(inMs)},\\fscx100\\fscy100)${fadeOut}`;
      break;
    case "slide-up":
      anim = `\\move(${x},${y + r(H * 0.06)},${x},${y},0,${r(inMs)})\\fad(${r(inMs)},${Math.min(300, durMs / 3)})`;
      break;
    case "fade":
      anim = `\\pos(${x},${y})\\fad(${r(Math.min(600, durMs / 3))},${r(Math.min(600, durMs / 3))})\\t(0,${durMs},\\fscx106\\fscy106)`;
      break;
    case "slide-left":
      anim = `\\move(${x - r(W * 0.25)},${y},${x},${y},0,${r(inMs)})${fadeOut}`;
      break;
    case "glow":
      anim = `\\pos(${x},${y})\\fad(250,250)\\blur8\\t(0,${r(durMs / 2)},\\blur3)\\t(${r(durMs / 2)},${durMs},\\blur8)`;
      break;
    case "typewriter":
      anim = `\\pos(${x},${y})${fadeOut}`;
      break;
  }

  const style = p.look === "box" ? "Box" : p.look === "glow" ? "Glow" : "Text";
  const font = `\\fn${p.font}\\fs${fs}${p.bold ? "\\b1" : "\\b0"}${p.italic ? "\\i1" : ""}\\an${an}\\1c${col}`;
  let titleText = escapeAss(title);
  if (p.anim === "typewriter") {
    const chars = [...title];
    const per = Math.max(3, r(Math.min(durMs * 0.6, chars.length * 70) / chars.length / 10));
    titleText = chars.map((ch) => `{\\ko${per}}${escapeAss(ch)}`).join("");
  }
  const lookTags =
    p.look === "box" ? `\\3c${acc}\\bord${r(fs * 0.35)}\\shad0` : p.look === "glow" ? `\\3c${acc}\\bord${r(fs * 0.08)}` : p.look === "plain" ? "\\bord0\\shad2" : `\\3c&H000000&\\bord${r(fs * 0.08)}\\shad0`;

  if (p.look === "bar" || p.look === "banner") {
    // Accent shape drawn behind the text, sliding in with it.
    const barH = r(fs * (sub ? 2.35 : 1.35));
    const barW = p.look === "banner" ? r(W - x * 2 + W * 0.05) : r(fs * 0.22);
    const move = `\\move(${x - r(W * 0.25) - r(fs * 0.4)},${y - r(fs * 0.15)},${x - r(fs * 0.4)},${y - r(fs * 0.15)},0,${r(inMs * 0.8)})`;
    ev(0, "Shape", `{\\an7${move}\\p1\\1c${acc}\\bord0\\shad0${fadeOut}}m 0 0 l ${barW} 0 ${barW} ${barH} 0 ${barH}{\\p0}`);
  }
  const titleTags = `{${font}${lookTags}${anim}${p.anim === "typewriter" ? "\\2a&HFF&" : ""}}`;
  if (sub) {
    const subFs = r(fs * 0.7);
    ev(1, style, `${titleTags}${titleText}\\N{\\fs${subFs}\\b0}${escapeAss(sub)}`);
  } else {
    ev(1, style, `${titleTags}${titleText}`);
  }
  return out;
}

/** ASS document for all preset text clips (null when there are none). */
export function buildTextAss(clips: TextClip[], W: number, H: number, projectH: number): string | null {
  const withPreset = clips.filter((c) => textPreset(c.preset) && c.text.trim());
  if (!withPreset.length) return null;
  const scale = H / projectH;
  const style = (name: string, borderStyle: number) =>
    `Style: ${name},Montserrat ExtraBold,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,${borderStyle},2,0,5,0,0,0,1`;
  const events = withPreset.flatMap((c) => presetEvents(c, textPreset(c.preset)!, W, H, scale));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Text", 1),
    style("Box", 3),
    style("Glow", 1),
    style("Shape", 1),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** CSS approximation of a preset at clip-local time t (for the live preview). */
export function presetPreview(p: TextPreset, t: number, dur: number): { opacity: number; transform: string; filter?: string; reveal?: number } {
  const inT = Math.min(0.45, dur / 3);
  const outT = Math.min(0.3, dur / 3);
  const k = Math.min(1, t / inT);
  const e = 1 - Math.pow(1 - k, 3);
  let opacity = t > dur - outT ? Math.max(0, (dur - t) / outT) : 1;
  let transform = "";
  let filter: string | undefined;
  let reveal: number | undefined;
  switch (p.anim) {
    case "pop":
      transform = `scale(${k < 0.6 ? 0.2 + (1.12 - 0.2) * (k / 0.6) : 1.12 - 0.12 * ((k - 0.6) / 0.4)})`;
      break;
    case "slide-up":
      transform = `translateY(${(1 - e) * 60}%)`;
      opacity *= k;
      break;
    case "slide-left":
      transform = `translateX(${-(1 - e) * 120}%)`;
      break;
    case "fade": {
      const f = Math.min(0.6, dur / 3);
      opacity = Math.min(t / f, (dur - t) / f, 1);
      transform = `scale(${1 + 0.06 * (t / dur)})`;
      break;
    }
    case "glow":
      filter = `drop-shadow(0 0 ${6 + 10 * Math.abs(Math.sin((t / dur) * Math.PI))}px ${p.accent})`;
      break;
    case "typewriter":
      reveal = Math.min(1, t / Math.max(0.3, dur * 0.6));
      break;
  }
  return { opacity: Math.max(0, opacity), transform, filter, reveal };
}
