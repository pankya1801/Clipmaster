import type { Sticker } from "../core/visuals";

/** Draw a sticker onto a square transparent canvas and return a PNG data URL. */
export function renderSticker(s: Sticker, size = 512): string {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  const c = s.color ?? "#facc15";
  const u = size / 100;
  g.lineCap = "round";
  g.lineJoin = "round";
  // Dark outline first, then the colour, so stickers read on any footage.
  const stroke = (draw: () => void, width: number) => {
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.lineWidth = width + 4 * u;
    g.beginPath();
    draw();
    g.stroke();
    g.strokeStyle = c;
    g.lineWidth = width;
    g.beginPath();
    draw();
    g.stroke();
  };
  const arrow = (angle: number) => {
    g.save();
    g.translate(50 * u, 50 * u);
    g.rotate(angle);
    g.translate(-50 * u, -50 * u);
    stroke(() => {
      g.moveTo(14 * u, 50 * u);
      g.lineTo(80 * u, 50 * u);
      g.moveTo(58 * u, 28 * u);
      g.lineTo(82 * u, 50 * u);
      g.lineTo(58 * u, 72 * u);
    }, 11 * u);
    g.restore();
  };
  const badge = (text: string) => {
    g.fillStyle = c;
    g.strokeStyle = "#fff";
    g.lineWidth = 4 * u;
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const r = (i % 2 ? 36 : 46) * u;
      const a = (i / 24) * Math.PI * 2;
      g.lineTo(50 * u + Math.cos(a) * r, 50 * u + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#fff";
    g.font = `900 ${22 * u}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 50 * u, 52 * u);
  };
  if (s.emoji) {
    g.font = `${80 * u}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s.emoji, 50 * u, 54 * u);
  } else if (s.draw === "arrow-right") arrow(0);
  else if (s.draw === "arrow-left") arrow(Math.PI);
  else if (s.draw === "arrow-down") arrow(Math.PI / 2);
  else if (s.draw === "arrow-curve") {
    stroke(() => {
      g.moveTo(18 * u, 75 * u);
      g.quadraticCurveTo(25 * u, 25 * u, 78 * u, 30 * u);
      g.moveTo(62 * u, 16 * u);
      g.lineTo(80 * u, 30 * u);
      g.lineTo(64 * u, 46 * u);
    }, 8 * u);
  } else if (s.draw === "circle") {
    stroke(() => g.ellipse(50 * u, 50 * u, 42 * u, 34 * u, -0.15, 0.2, Math.PI * 2.1), 6 * u);
  } else if (s.draw === "underline") {
    stroke(() => {
      g.moveTo(8 * u, 55 * u);
      g.quadraticCurveTo(50 * u, 45 * u, 92 * u, 52 * u);
    }, 8 * u);
  } else if (s.draw === "burst") {
    g.fillStyle = c;
    g.beginPath();
    for (let i = 0; i < 32; i++) {
      const r = (i % 2 ? 22 : 48) * u;
      const a = (i / 32) * Math.PI * 2;
      g.lineTo(50 * u + Math.cos(a) * r, 50 * u + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  } else if (s.draw === "badge-new") badge("NEW");
  else if (s.draw === "badge-wow") badge("WOW");
  else if (s.draw === "check") {
    stroke(() => {
      g.moveTo(18 * u, 52 * u);
      g.lineTo(40 * u, 74 * u);
      g.lineTo(84 * u, 26 * u);
    }, 13 * u);
  } else if (s.draw === "cross") {
    stroke(() => {
      g.moveTo(22 * u, 22 * u);
      g.lineTo(78 * u, 78 * u);
      g.moveTo(78 * u, 22 * u);
      g.lineTo(22 * u, 78 * u);
    }, 13 * u);
  }
  return cv.toDataURL("image/png");
}

const cache = new Map<string, string>();
/** Small cached thumbnail for the sticker grid. */
export function stickerThumb(s: Sticker): string {
  let url = cache.get(s.id);
  if (!url) {
    url = renderSticker(s, 96);
    cache.set(s.id, url);
  }
  return url;
}
