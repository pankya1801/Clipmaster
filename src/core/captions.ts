/**
 * Caption templates rendered through ASS subtitles (libass in FFmpeg), so the
 * export gets real outlines, boxes, word highlighting and pop animations.
 */
import type { CaptionSettings, CaptionWord } from "./types";

export type CaptionAnimation =
  | "none" // whole line, static
  | "fade" // line fades in/out
  | "pop" // line pops in
  | "karaoke" // colour sweeps across words as they are spoken
  | "highlight" // active word coloured
  | "highlight-box" // active word gets a coloured box
  | "word" // one word at a time
  | "reveal"; // words appear as they are spoken

export interface CaptionTemplate {
  id: string;
  name: string;
  font: string;
  /** Font size as a fraction of output height. */
  size: number;
  bold: boolean;
  italic?: boolean;
  uppercase: boolean;
  color: string; // #rrggbb
  highlight: string; // active word / karaoke colour
  outline: string;
  outlineWidth: number; // fraction of font size
  shadow: number; // px at 1080p
  /** Opaque box behind the text (ASS BorderStyle 3). */
  box?: string;
  boxAlpha?: number; // 0 opaque .. 1 transparent
  blur?: number; // glow
  position: "bottom" | "center" | "top";
  animation: CaptionAnimation;
  maxWords: number;
}

const T = (t: Partial<CaptionTemplate> & Pick<CaptionTemplate, "id" | "name">): CaptionTemplate => ({
  font: "Montserrat ExtraBold",
  size: 0.055,
  bold: true,
  uppercase: false,
  color: "#ffffff",
  highlight: "#ffe600",
  outline: "#000000",
  outlineWidth: 0.08,
  shadow: 0,
  position: "bottom",
  animation: "none",
  maxWords: 6,
  ...t,
  // Montserrat ExtraBold runs narrow; give templates using it a size boost.
  ...(t.font ? {} : { size: (t.size ?? 0.055) * 1.2 }),
});

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  T({ id: "classic", name: "Classic", animation: "fade" }),
  T({ id: "minimal", name: "Minimal", font: "Poppins", bold: false, size: 0.042, outlineWidth: 0, shadow: 3, maxWords: 8 }),
  T({ id: "streaming", name: "Streaming", font: "Poppins", size: 0.045, outlineWidth: 0, box: "#000000", boxAlpha: 0.35, maxWords: 8 }),
  T({ id: "boxed", name: "Boxed", box: "#000000", boxAlpha: 0, outlineWidth: 0.2, maxWords: 5, animation: "pop" }),
  T({ id: "bold-yellow", name: "Bold Yellow", uppercase: true, size: 0.07, outlineWidth: 0.12, animation: "highlight", maxWords: 3 }),
  T({ id: "bold-green", name: "Bold Green", uppercase: true, size: 0.07, outlineWidth: 0.12, highlight: "#39ff14", animation: "highlight", maxWords: 3 }),
  T({ id: "beast", name: "Beast", font: "Bebas Neue", uppercase: true, size: 0.1, outlineWidth: 0.1, shadow: 6, highlight: "#ff2d2d", animation: "highlight", maxWords: 2, position: "center" }),
  T({ id: "highlight-box", name: "Highlight Box", uppercase: true, size: 0.065, highlight: "#7c3aed", animation: "highlight-box", maxWords: 3 }),
  T({ id: "karaoke-blue", name: "Karaoke Blue", color: "#ffffff", highlight: "#00b7ff", animation: "karaoke", maxWords: 6 }),
  T({ id: "karaoke-pink", name: "Karaoke Pink", color: "#ffffff", highlight: "#ff3ea5", animation: "karaoke", maxWords: 6 }),
  T({ id: "one-word", name: "One Word", uppercase: true, size: 0.09, outlineWidth: 0.1, animation: "word", maxWords: 1, position: "center" }),
  T({ id: "one-word-yellow", name: "One Word Yellow", uppercase: true, size: 0.09, color: "#ffe600", outlineWidth: 0.1, animation: "word", maxWords: 1, position: "center" }),
  T({ id: "neon-cyan", name: "Neon Cyan", color: "#b8f7ff", outline: "#00c8ff", outlineWidth: 0.1, blur: 4, highlight: "#fff45c", animation: "highlight", maxWords: 4 }),
  T({ id: "neon-pink", name: "Neon Pink", color: "#ffd6f5", outline: "#ff2bd6", outlineWidth: 0.1, blur: 4, highlight: "#ffffff", animation: "highlight", maxWords: 4 }),
  T({ id: "retro", name: "Retro", font: "Bebas Neue", size: 0.095, color: "#ffb000", outline: "#5a1e00", outlineWidth: 0.12, shadow: 5, uppercase: true, animation: "pop", maxWords: 4 }),
  T({ id: "comic", name: "Comic", font: "Bangers", size: 0.1, color: "#ffe600", outline: "#000000", outlineWidth: 0.16, shadow: 4, animation: "pop", maxWords: 4 }),
  T({ id: "cinema", name: "Cinema", font: "DM Serif Display", bold: false, italic: true, size: 0.045, outlineWidth: 0, shadow: 2, animation: "fade", maxWords: 9 }),
  T({ id: "news", name: "News", font: "Poppins", size: 0.045, box: "#1d4ed8", boxAlpha: 0, outlineWidth: 0.25, maxWords: 8 }),
  T({ id: "podcast", name: "Podcast", size: 0.06, highlight: "#22d3ee", animation: "highlight", maxWords: 5, position: "center" }),
  T({ id: "gaming", name: "Gaming", font: "Bangers", uppercase: true, size: 0.11, color: "#ffffff", outline: "#16a34a", outlineWidth: 0.14, highlight: "#a3e635", animation: "word", maxWords: 1 }),
  T({ id: "elegant", name: "Elegant", font: "DM Serif Display", size: 0.05, bold: false, outlineWidth: 0, shadow: 3, animation: "reveal", maxWords: 7 }),
  T({ id: "top-title", name: "Top Title", position: "top", box: "#000000", boxAlpha: 0.2, outlineWidth: 0.2, maxWords: 6, animation: "pop" }),
  T({ id: "center-big", name: "Center Big", uppercase: true, size: 0.085, position: "center", outlineWidth: 0.1, shadow: 4, animation: "pop", maxWords: 3 }),
  T({ id: "pastel", name: "Pastel", color: "#3b0764", box: "#fbcfe8", boxAlpha: 0, outlineWidth: 0.22, animation: "pop", maxWords: 4 }),
  T({ id: "typewriter", name: "Typewriter", font: "Courier Prime", bold: false, size: 0.06, outlineWidth: 0.06, animation: "reveal", maxWords: 8 }),
];

export const captionTemplate = (id: string) => CAPTION_TEMPLATES.find((t) => t.id === id) ?? CAPTION_TEMPLATES[0];

export interface CaptionLine {
  start: number;
  end: number;
  words: CaptionWord[];
}

/** Group words into on-screen lines (max words, break on pauses/punctuation). */
export function groupCaptionLines(words: CaptionWord[], maxWords: number, maxGap = 0.7): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  const sorted = [...words].filter((w) => w.text.trim()).sort((a, b) => a.start - b.start);
  for (const w of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= maxWords || w.start - prev.end > maxGap)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text) && cur.length >= Math.min(2, maxWords)) flush();
  }
  flush();
  // Keep each line on screen until the next begins (small gaps only).
  for (let i = 0; i < lines.length - 1; i++) {
    const gap = lines[i + 1].start - lines[i].end;
    if (gap > 0 && gap < maxGap) lines[i].end = lines[i + 1].start;
  }
  return lines;
}

/** #rrggbb + alpha (0 opaque..1 transparent) → ASS &HAABBGGRR */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  const hx = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `&H${hx(a)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export function escapeAss(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
}

export function buildAss(words: CaptionWord[], settings: CaptionSettings, W: number, H: number): string {
  const t = captionTemplate(settings.templateId);
  const size = Math.round(t.size * H * settings.scale);
  const outline = t.box ? Math.max(4, Math.round(size * t.outlineWidth)) : Math.round(size * t.outlineWidth);
  const align = t.position === "top" ? 8 : t.position === "center" ? 5 : 2;
  const marginV = Math.round(H * (t.position === "center" ? 0 : 0.1));
  const shadow = Math.round((t.shadow * H) / 1080);

  const style = [
    "Default",
    t.font,
    size,
    assColor(t.color),
    assColor(t.highlight), // SecondaryColour is the karaoke "unsung" colour; swapped below
    assColor(t.box ?? t.outline, t.box ? t.boxAlpha ?? 0 : 0),
    assColor("#000000", 0.4),
    t.bold ? -1 : 0,
    t.italic ? -1 : 0,
    0,
    0,
    100,
    100,
    0,
    0,
    t.box ? 3 : 1,
    outline,
    shadow,
    align,
    Math.round(W * 0.06),
    Math.round(W * 0.06),
    marginV,
    1,
  ].join(",");

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${style}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];
  const pos = settings.y != null ? `\\an5\\pos(${Math.round(W / 2)},${Math.round(H * settings.y)})` : "";
  const glow = t.blur ? `\\blur${t.blur}` : "";
  const word = (w: CaptionWord) => escapeAss(t.uppercase ? w.text.toUpperCase() : w.text);
  const ev = (start: number, end: number, text: string) =>
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,{${pos}${glow}}${text}`);
  const pop = "{\\fscx70\\fscy70\\t(0,120,\\fscx108\\fscy108)\\t(120,200,\\fscx100\\fscy100)}";
  const hl = assColor(t.highlight);

  for (const line of groupCaptionLines(words, settings.maxWords ?? t.maxWords)) {
    const plain = line.words.map(word).join(" ");
    switch (t.animation) {
      case "none":
        ev(line.start, line.end, plain);
        break;
      case "fade":
        ev(line.start, line.end, `{\\fad(120,120)}${plain}`);
        break;
      case "pop":
        ev(line.start, line.end, `${pop}${plain}`);
        break;
      case "karaoke": {
        // \kf sweeps from SecondaryColour to PrimaryColour, so swap colours inline.
        const parts = line.words.map((w, i) => {
          const next = line.words[i + 1]?.start ?? w.end;
          const cs = Math.max(1, Math.round((Math.max(w.end, next) - w.start) * 100));
          return `{\\kf${cs}}${word(w)}`;
        });
        const lead = Math.max(0, Math.round((line.words[0].start - line.start) * 100));
        ev(line.start, line.end, `{\\1c${hl}\\2c${assColor(t.color)}${lead ? `\\k${lead}` : ""}}${parts.join(" ")}`);
        break;
      }
      case "highlight":
      case "highlight-box":
        line.words.forEach((w, i) => {
          const end = i < line.words.length - 1 ? line.words[i + 1].start : line.end;
          const text = line.words
            .map((o, j) =>
              j === i
                ? t.animation === "highlight"
                  ? `{\\c${hl}\\fscx112\\fscy112}${word(o)}{\\r}`
                  : `{\\3c${hl}\\bord${Math.round(size * 0.18)}\\shad0}${word(o)}{\\r}`
                : word(o)
            )
            .join(" ");
          ev(i === 0 ? line.start : w.start, end, (i === 0 ? pop : "") + text);
        });
        break;
      case "word":
        line.words.forEach((w, i) => {
          const end = i < line.words.length - 1 ? line.words[i + 1].start : line.end;
          ev(w.start, Math.max(end, w.start + 0.05), `${pop}${word(w)}`);
        });
        break;
      case "reveal":
        line.words.forEach((w, i) => {
          const end = i < line.words.length - 1 ? line.words[i + 1].start : line.end;
          const shown = line.words.slice(0, i + 1).map(word).join(" ");
          const hidden = line.words.slice(i + 1).map(word).join(" ");
          ev(w.start, Math.max(end, w.start + 0.05), hidden ? `${shown} {\\alpha&HFF&}${hidden}` : shown);
        });
        break;
    }
  }
  return [...header, ...events, ""].join("\n");
}

/** Parse SRT (word-level or sentence-level) into caption words. */
export function parseSrt(srt: string): CaptionWord[] {
  const words: CaptionWord[] = [];
  const blocks = srt.replace(/\r/g, "").split(/\n\s*\n/);
  const ts = (s: string) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 10 ** m[4].length : NaN;
  };
  for (const b of blocks) {
    const lines = b.trim().split("\n");
    const tl = lines.findIndex((l) => l.includes("-->"));
    if (tl < 0) continue;
    const [a, z] = lines[tl].split("-->");
    const start = ts(a);
    const end = ts(z);
    const text = lines.slice(tl + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    // Spread multi-word cues evenly (weighted by length) so highlighting still works.
    const parts = text.split(/\s+/);
    const total = parts.reduce((s, p) => s + p.length + 1, 0);
    let t = start;
    for (const p of parts) {
      const d = ((end - start) * (p.length + 1)) / total;
      words.push({ text: p, start: t, end: t + d });
      t += d;
    }
  }
  // whisper.cpp word-level output often attaches punctuation as separate tokens.
  const merged: CaptionWord[] = [];
  for (const w of words) {
    if (/^[.,!?;:]+$/.test(w.text) && merged.length) {
      merged[merged.length - 1] = { ...merged[merged.length - 1], text: merged[merged.length - 1].text + w.text, end: w.end };
    } else merged.push(w);
  }
  return merged;
}

export function toSrt(words: CaptionWord[], maxWords = 7): string {
  const t = (v: number) => {
    const ms = Math.round(v * 1000);
    const pad = (n: number, l = 2) => String(n).padStart(l, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return groupCaptionLines(words, maxWords)
    .map((l, i) => `${i + 1}\n${t(l.start)} --> ${t(l.end)}\n${l.words.map((w) => w.text).join(" ")}\n`)
    .join("\n");
}
