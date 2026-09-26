import type { CSSProperties } from "react";
import { CaptionTemplate } from "../core/captions";

/** CSS approximation of an ASS caption template for previews. */
export function captionCss(t: CaptionTemplate, fontPx: number): { base: CSSProperties; active: CSSProperties } {
  const outline = t.box ? 0 : Math.max(0, t.outlineWidth * fontPx);
  const shadow = t.shadow ? `${t.shadow / 3}px ${t.shadow / 3}px 0 #000a` : "";
  const glow = t.blur ? `0 0 ${t.blur * 2}px ${t.outline}` : "";
  const base: CSSProperties = {
    fontFamily: `"${t.font}", "Poppins", sans-serif`,
    fontWeight: t.bold || t.font.includes("Bold") ? 800 : 400,
    fontStyle: t.italic ? "italic" : "normal",
    fontSize: fontPx,
    color: t.color,
    textTransform: t.uppercase ? "uppercase" : "none",
    WebkitTextStroke: outline ? `${outline}px ${t.outline}` : undefined,
    paintOrder: "stroke fill",
    textShadow: [shadow, glow].filter(Boolean).join(", ") || undefined,
    background: t.box ? hexA(t.box, 1 - (t.boxAlpha ?? 0)) : undefined,
    padding: t.box ? `${fontPx * 0.12}px ${fontPx * 0.3}px` : undefined,
    borderRadius: t.box ? fontPx * 0.12 : undefined,
    lineHeight: 1.2,
    display: "inline",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
  };
  const active: CSSProperties =
    t.animation === "highlight-box"
      ? { background: t.highlight, borderRadius: fontPx * 0.15, padding: `0 ${fontPx * 0.12}px`, WebkitTextStroke: undefined }
      : { color: t.highlight };
  return { base, active };
}

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
