/**
 * Effect & transition catalogue.
 *
 * Each effect builds an FFmpeg filter chain for export (clip-relative time,
 * frame already scaled to the output size) and a CSS approximation used by
 * the live preview. `amount` is 0..1.
 */

export type EffectCategory = "color" | "stylize" | "motion";

export interface EffectContext {
  W: number;
  H: number;
  fps: number;
  /** Clip duration on the timeline, seconds. */
  duration: number;
}

export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  filter: (a: number, ctx: EffectContext) => string;
  /** CSS `filter` / `transform` approximation for preview. */
  css?: (a: number) => { filter?: string; transform?: string };
}

const f = (v: number) => Number(v.toFixed(4)).toString();
const mix = (a: number, from: number, to: number) => from + (to - from) * a;

export const EFFECTS: EffectDef[] = [
  // ---------- Color & grading ----------
  { id: "brighten", name: "Brighten", category: "color", filter: (a) => `eq=brightness=${f(0.25 * a)}`, css: (a) => ({ filter: `brightness(${f(1 + 0.5 * a)})` }) },
  { id: "contrast", name: "Contrast", category: "color", filter: (a) => `eq=contrast=${f(1 + 0.6 * a)}`, css: (a) => ({ filter: `contrast(${f(1 + 0.6 * a)})` }) },
  { id: "saturate", name: "Saturate", category: "color", filter: (a) => `eq=saturation=${f(1 + 1.2 * a)}`, css: (a) => ({ filter: `saturate(${f(1 + 1.2 * a)})` }) },
  { id: "vivid", name: "Vivid", category: "color", filter: (a) => `eq=saturation=${f(1 + 0.5 * a)}:contrast=${f(1 + 0.15 * a)},unsharp=5:5:${f(0.6 * a)}`, css: (a) => ({ filter: `saturate(${f(1 + 0.5 * a)}) contrast(${f(1 + 0.15 * a)})` }) },
  { id: "warm", name: "Warm", category: "color", filter: (a) => `colortemperature=temperature=${Math.round(mix(a, 6500, 3800))}`, css: (a) => ({ filter: `sepia(${f(0.25 * a)}) saturate(${f(1 + 0.2 * a)})` }) },
  { id: "cool", name: "Cool", category: "color", filter: (a) => `colortemperature=temperature=${Math.round(mix(a, 6500, 11000))}`, css: (a) => ({ filter: `hue-rotate(${f(-12 * a)}deg) saturate(${f(1 - 0.1 * a)})` }) },
  { id: "cinematic", name: "Cinematic (teal & orange)", category: "color", filter: (a) => `colorbalance=rs=${f(-0.12 * a)}:bs=${f(0.15 * a)}:rh=${f(0.15 * a)}:bh=${f(-0.12 * a)},eq=contrast=${f(1 + 0.12 * a)}`, css: (a) => ({ filter: `contrast(${f(1 + 0.12 * a)}) saturate(${f(1 + 0.15 * a)})` }) },
  { id: "vintage", name: "Vintage", category: "color", filter: (a) => `curves=preset=vintage,eq=saturation=${f(1 - 0.3 * a)}`, css: (a) => ({ filter: `sepia(${f(0.45 * a)}) contrast(${f(1 - 0.1 * a)})` }) },
  { id: "cross", name: "Cross process", category: "color", filter: () => `curves=preset=cross_process`, css: (a) => ({ filter: `hue-rotate(${f(15 * a)}deg) saturate(${f(1 + 0.4 * a)})` }) },
  { id: "matte", name: "Matte fade", category: "color", filter: (a) => `curves=all='0/${f(0.14 * a)} 1/${f(1 - 0.06 * a)}',eq=saturation=${f(1 - 0.15 * a)}`, css: (a) => ({ filter: `contrast(${f(1 - 0.2 * a)}) brightness(${f(1 + 0.05 * a)})` }) },
  { id: "bw", name: "Black & white", category: "color", filter: (a) => `hue=s=${f(1 - a)}`, css: (a) => ({ filter: `grayscale(${f(a)})` }) },
  { id: "noir", name: "Noir", category: "color", filter: (a) => `hue=s=0,eq=contrast=${f(1 + 0.6 * a)}:brightness=${f(-0.05 * a)}`, css: (a) => ({ filter: `grayscale(1) contrast(${f(1 + 0.6 * a)})` }) },
  { id: "sepia", name: "Sepia", category: "color", filter: (a) => `colorchannelmixer=${sepiaMatrix(a)}`, css: (a) => ({ filter: `sepia(${f(a)})` }) },
  { id: "hue", name: "Hue shift", category: "color", filter: (a) => `hue=h=${f(180 * a)}`, css: (a) => ({ filter: `hue-rotate(${f(180 * a)}deg)` }) },

  // ---------- Stylize ----------
  { id: "vignette", name: "Vignette", category: "stylize", filter: (a) => `vignette=angle=${f(0.2 + 0.5 * a)}` },
  { id: "sharpen", name: "Sharpen", category: "stylize", filter: (a) => `unsharp=5:5:${f(1.5 * a)}`, css: (a) => ({ filter: `contrast(${f(1 + 0.05 * a)})` }) },
  { id: "blur", name: "Blur", category: "stylize", filter: (a) => `gblur=sigma=${f(0.5 + 12 * a)}`, css: (a) => ({ filter: `blur(${f(0.5 + 6 * a)}px)` }) },
  { id: "grain", name: "Film grain", category: "stylize", filter: (a) => `noise=alls=${Math.round(4 + 26 * a)}:allf=t+u` },
  { id: "film", name: "Old film", category: "stylize", filter: (a) => `curves=preset=vintage,noise=alls=${Math.round(10 + 20 * a)}:allf=t+u,vignette=angle=0.6`, css: (a) => ({ filter: `sepia(${f(0.5 * a)}) contrast(1.1)` }) },
  { id: "rgbsplit", name: "RGB split", category: "stylize", filter: (a) => `rgbashift=rh=${-Math.round(2 + 10 * a)}:bh=${Math.round(2 + 10 * a)}` },
  { id: "glitch", name: "Glitch", category: "stylize", filter: (a) => `rgbashift=rh=${Math.round(4 + 16 * a)}:bv=${-Math.round(2 + 8 * a)}:enable='gt(mod(n\\,12)\\,8)',noise=alls=${Math.round(10 * a)}:allf=t` },
  { id: "mirror", name: "Mirror", category: "stylize", filter: () => `hflip`, css: () => ({ transform: "scaleX(-1)" }) },
  { id: "flip", name: "Flip vertical", category: "stylize", filter: () => `vflip`, css: () => ({ transform: "scaleY(-1)" }) },
  { id: "pixelate", name: "Pixelate", category: "stylize", filter: (a, c) => `scale=${Math.max(8, Math.round(c.W / (6 + 30 * a)))}:-2:flags=neighbor,scale=${c.W}:${c.H}:flags=neighbor`, css: (a) => ({ filter: `blur(${f(2 * a)}px)` }) },
  { id: "sketch", name: "Sketch", category: "stylize", filter: () => `edgedetect=mode=colormix:high=0.2`, css: () => ({ filter: "grayscale(1) contrast(2)" }) },
  { id: "negative", name: "Negative", category: "stylize", filter: () => `negate`, css: () => ({ filter: "invert(1)" }) },
  { id: "letterbox", name: "Cinema bars", category: "stylize", filter: (a, c) => { const h = Math.round(c.H * (0.06 + 0.08 * a)); return `drawbox=x=0:y=0:w=iw:h=${h}:color=black:t=fill,drawbox=x=0:y=ih-${h}:w=iw:h=${h}:color=black:t=fill`; } },

  // ---------- Motion ----------
  { id: "zoom-in", name: "Slow zoom in", category: "motion", filter: (a, c) => zoompan(`1+${f(0.25 * a)}*in_time/${f(c.duration)}`, c), css: () => ({ transform: "scale(1.08)" }) },
  { id: "zoom-out", name: "Slow zoom out", category: "motion", filter: (a, c) => zoompan(`${f(1 + 0.25 * a)}-${f(0.25 * a)}*in_time/${f(c.duration)}`, c), css: () => ({ transform: "scale(1.08)" }) },
  { id: "punch-in", name: "Punch-in zoom", category: "motion", filter: (a, c) => `crop=iw/${f(1 + 0.25 * a)}:ih/${f(1 + 0.25 * a)},scale=${c.W}:${c.H}`, css: (a) => ({ transform: `scale(${f(1 + 0.25 * a)})` }) },
  { id: "shake", name: "Camera shake", category: "motion", filter: (a, c) => { const m = Math.round(8 + 30 * a); return `scale=${c.W + 2 * m}:${c.H + 2 * m},crop=${c.W}:${c.H}:x='${m}+${m}*sin(t*37)':y='${m}+${m}*cos(t*29)'`; } },
  { id: "pan", name: "Ken Burns pan", category: "motion", filter: (a, c) => `scale=${Math.round(c.W * (1.1 + 0.2 * a))}:-2,crop=${c.W}:${c.H}:x='(iw-ow)*t/${f(c.duration)}':y='(ih-oh)/2'`, css: () => ({ transform: "scale(1.1)" }) },
];

function zoompan(z: string, c: EffectContext) {
  return `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${c.W}x${c.H}:fps=${c.fps}`;
}

function sepiaMatrix(a: number) {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const sep = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const m = id.map((v, i) => f(mix(a, v, sep[i])));
  return `rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`;
}

// ---------- Transitions (clip in / out animations) ----------

export type TransitionSide = "in" | "out";

export interface TransitionDef {
  id: string;
  name: string;
  side: TransitionSide;
}

export const TRANSITIONS: TransitionDef[] = [
  { id: "fade-in", name: "Fade in", side: "in" },
  { id: "dissolve", name: "Cross dissolve", side: "in" },
  { id: "flash", name: "Flash", side: "in" },
  { id: "slide-left", name: "Slide from right", side: "in" },
  { id: "slide-right", name: "Slide from left", side: "in" },
  { id: "slide-up", name: "Slide up", side: "in" },
  { id: "slide-down", name: "Slide down", side: "in" },
  { id: "zoom-pop", name: "Zoom pop", side: "in" },
  { id: "blur-in", name: "Blur in", side: "in" },
  { id: "fade-out", name: "Fade out", side: "out" },
  { id: "dip-white", name: "Dip to white", side: "out" },
];

export const effectById = (id: string) => EFFECTS.find((e) => e.id === id);
export const transitionById = (id: string) => TRANSITIONS.find((t) => t.id === id);
export const ALL_EFFECT_COUNT = EFFECTS.length + TRANSITIONS.length;

/**
 * Clip-relative filters for in/out transitions (applied before the clip is
 * shifted onto the timeline). Slides are handled by the overlay position.
 */
export function transitionFilters(
  tin: { id: string; duration: number } | undefined,
  tout: { id: string; duration: number } | undefined,
  dur: number,
  ctx: { W: number; H: number; fps: number }
): string[] {
  const out: string[] = [];
  if (tin) {
    const d = f(Math.min(tin.duration, dur));
    if (tin.id === "fade-in" || tin.id === "dissolve") out.push(`fade=t=in:st=0:d=${d}:alpha=1`);
    if (tin.id === "flash") out.push(`eq=brightness='if(lt(t,${d}),0.8*(1-t/${d}),0)':eval=frame`);
    if (tin.id === "blur-in") out.push(`gblur=sigma=20:enable='lt(t,${d})',fade=t=in:st=0:d=${d}:alpha=1`);
    if (tin.id === "zoom-pop")
      out.push(`zoompan=z='if(lt(in_time,${d}),1.35-0.35*in_time/${d},1)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${ctx.W}x${ctx.H}:fps=${ctx.fps}`);
  }
  if (tout) {
    const d = Math.min(tout.duration, dur);
    const st = f(Math.max(0, dur - d));
    if (tout.id === "fade-out") out.push(`fade=t=out:st=${st}:d=${f(d)}:alpha=1`);
    if (tout.id === "dip-white") out.push(`eq=brightness='if(gt(t,${st}),0.9*(t-${st})/${f(d)},0)':eval=frame`);
  }
  return out;
}

/** Overlay x/y expressions for slide-in transitions (absolute timeline time). */
export function slideOverlay(tin: { id: string; duration: number } | undefined, start: number): { x: string; y: string } {
  if (!tin || !tin.id.startsWith("slide-")) return { x: "0", y: "0" };
  const d = f(tin.duration);
  const s = f(start);
  const p = `min(1,(t-${s})/${d})`;
  const ease = `(1-pow(1-${p},3))`;
  switch (tin.id) {
    case "slide-left":
      return { x: `W*(1-${ease})`, y: "0" };
    case "slide-right":
      return { x: `-W*(1-${ease})`, y: "0" };
    case "slide-up":
      return { x: "0", y: `H*(1-${ease})` };
    default:
      return { x: "0", y: `-H*(1-${ease})` };
  }
}

/** Preview helpers: opacity/transform for transitions at clip-relative time. */
export function transitionPreview(
  tin: { id: string; duration: number } | undefined,
  tout: { id: string; duration: number } | undefined,
  local: number,
  dur: number
): { opacity: number; transform: string; filter: string } {
  let opacity = 1;
  let transform = "";
  let filter = "";
  if (tin && local < tin.duration) {
    const p = local / tin.duration;
    const e = 1 - Math.pow(1 - p, 3);
    if (tin.id === "fade-in" || tin.id === "dissolve" || tin.id === "blur-in") opacity = p;
    if (tin.id === "blur-in") filter += ` blur(${f(12 * (1 - p))}px)`;
    if (tin.id === "flash") filter += ` brightness(${f(1 + 2 * (1 - p))})`;
    if (tin.id === "zoom-pop") transform += ` scale(${f(1.35 - 0.35 * p)})`;
    if (tin.id === "slide-left") transform += ` translateX(${f(100 * (1 - e))}%)`;
    if (tin.id === "slide-right") transform += ` translateX(${f(-100 * (1 - e))}%)`;
    if (tin.id === "slide-up") transform += ` translateY(${f(100 * (1 - e))}%)`;
    if (tin.id === "slide-down") transform += ` translateY(${f(-100 * (1 - e))}%)`;
  }
  if (tout && local > dur - tout.duration) {
    const p = (local - (dur - tout.duration)) / tout.duration;
    if (tout.id === "fade-out") opacity *= 1 - p;
    if (tout.id === "dip-white") filter += ` brightness(${f(1 + 3 * p)})`;
  }
  return { opacity, transform: transform.trim(), filter: filter.trim() };
}

export function effectsCss(effects: { id: string; amount: number }[]): { filter: string; transform: string } {
  const filters: string[] = [];
  const transforms: string[] = [];
  for (const e of effects) {
    const css = effectById(e.id)?.css?.(e.amount);
    if (css?.filter) filters.push(css.filter);
    if (css?.transform) transforms.push(css.transform);
  }
  return { filter: filters.join(" "), transform: transforms.join(" ") };
}
