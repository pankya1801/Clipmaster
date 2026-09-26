import { clipDuration, clipEnd, clipsOnTrack, projectDuration } from "./project";
import { buildAss } from "./captions";
import { effectById, slideOverlay, transitionFilters } from "./effects";
import { isAnimated, keyframeExpr } from "./keyframes";
import type { Keyframe, MediaClip, Project, TextClip } from "./types";

export type ExportQuality = "draft" | "standard" | "high";

export interface ExportOptions {
  outputPath: string;
  /** Directory where text files for drawtext can be written. */
  tempDir: string;
  quality: ExportQuality;
  /** Optional font file for text (otherwise FFmpeg's fontconfig default). */
  fontFile?: string;
  /** Directory of bundled fonts for captions. */
  fontsDir?: string;
  /** Override output size (defaults to project settings). */
  width?: number;
  height?: number;
}

export interface ExportPlan {
  args: string[];
  /** Files the backend must write before running FFmpeg. */
  files: { path: string; content: string }[];
  duration: number;
}

const QUALITY: Record<ExportQuality, { preset: string; crf: number }> = {
  draft: { preset: "ultrafast", crf: 28 },
  standard: { preset: "medium", crf: 21 },
  high: { preset: "slow", crf: 17 },
};

const n = (v: number) => Number(v.toFixed(4)).toString();

/** atempo only accepts 0.5..2 (older builds); chain filters for other speeds. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${n(s)}`);
  return out;
}

/** Escape a value for use inside a single-quoted filtergraph option. */
export function escapeFilterValue(v: string): string {
  return v.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:");
}

function joinPath(dir: string, name: string) {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

export function buildExportPlan(p: Project, opts: ExportOptions): ExportPlan {
  const W = opts.width ?? p.settings.width;
  const H = opts.height ?? p.settings.height;
  const fps = p.settings.fps;
  const total = projectDuration(p);
  if (total <= 0) throw new Error("Timeline is empty");

  const args: string[] = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"];
  const filters: string[] = [];
  const files: ExportPlan["files"] = [];
  let inputIndex = 0;

  const addInput = (path: string, isImage: boolean, dur: number) => {
    if (isImage) args.push("-loop", "1", "-framerate", String(fps), "-t", n(dur));
    args.push("-i", path);
    return inputIndex++;
  };

  // Base canvas.
  filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p[base]`);
  let last = "base";
  let vi = 0;

  // Visual layers: bottom track first so upper tracks overlay it.
  const videoTracks = p.tracks.filter((t) => t.kind === "video" && !t.hidden).reverse();
  const audioClips: { clip: MediaClip; input: number }[] = [];

  for (const track of videoTracks) {
    const clips = clipsOnTrack(p, track.id);
    clips.forEach((c, ci) => {
      if (c.type !== "media") return;
      const asset = p.assets[c.assetId];
      if (!asset) return;
      const isImage = asset.kind === "image";
      const dur = clipDuration(c);
      // A cross dissolve on the next clip needs this clip to keep playing under it.
      const next = clips[ci + 1];
      let tail = 0;
      if (next?.type === "media" && next.transIn?.id === "dissolve" && Math.abs(next.start - clipEnd(c)) < 0.05) {
        tail = Math.min(next.transIn.duration, clipDuration(next));
        if (!isImage) tail = Math.min(tail, Math.max(0, (asset.duration - c.out) / c.speed));
      }
      const shown = dur + tail;
      const idx = addInput(asset.path, isImage, shown);
      const keys = c.keyframes?.length ? c.keyframes : undefined;
      const tf = keys ? keys[0] : c.transform;
      // With a transform the clip keeps its own aspect (no letterbox pad), so
      // effects see the fitted frame size instead of the canvas size.
      const fit = fittedSize(asset.width, asset.height, W, H);
      const ctx = tf ? { W: fit.w, H: fit.h, fps, duration: dur } : { W, H, fps, duration: dur };
      const chain = [
        isImage ? `trim=duration=${n(shown)}` : `trim=start=${n(c.in)}:end=${n(c.out + tail * c.speed)}`,
        `setpts=(PTS-STARTPTS)/${n(c.speed)}`,
        tf ? `scale=${fit.w}:${fit.h}` : `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        tf ? "" : `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`,
        "setsar=1",
        `fps=${fps}`,
        ...(c.effects ?? []).map((e) => effectById(e.id)?.filter(e.amount, ctx)).filter((x): x is string => !!x),
        "format=yuva420p",
        ...transitionFilters(c.transIn, c.transOut, dur, ctx),
        ...(keys ? keyframeFilters(keys, fit) : tf ? transformFilters(tf) : []),
        `setpts=PTS+${n(c.start)}/TB`,
      ].filter(Boolean);
      filters.push(`[${idx}:v]${chain.join(",")}[v${vi}]`);
      const pos = slideOverlay(c.transIn, c.start);
      const tv = `(t-${n(c.start)})`;
      const cx = keys ? keyframeExpr(keys, "x", tv) : n(tf?.x ?? 0.5);
      const cy = keys ? keyframeExpr(keys, "y", tv) : n(tf?.y ?? 0.5);
      filters.push(
        `[${last}][v${vi}]overlay=x='W*${cx}-w/2+(${pos.x})':y='H*${cy}-h/2+(${pos.y})':eof_action=pass:enable='between(t,${n(c.start)},${n(c.start + shown)})'[o${vi}]`
      );
      last = `o${vi}`;
      vi++;
      if (asset.hasAudio && !track.muted && !isImage) audioClips.push({ clip: c, input: idx });
    });
  }

  // Audio tracks.
  for (const track of p.tracks.filter((t) => t.kind === "audio" && !t.muted)) {
    for (const c of clipsOnTrack(p, track.id)) {
      if (c.type !== "media") continue;
      const asset = p.assets[c.assetId];
      if (!asset?.hasAudio) continue;
      audioClips.push({ clip: c, input: addInput(asset.path, false, 0) });
    }
  }

  // Text overlays.
  const texts = p.tracks
    .filter((t) => t.kind === "text" && !t.hidden)
    .reverse()
    .flatMap((t) => clipsOnTrack(p, t.id))
    .filter((c): c is TextClip => c.type === "text" && c.text.trim().length > 0);
  texts.forEach((t, i) => {
    const file = joinPath(opts.tempDir, `clipmaster_text_${i}.txt`);
    files.push({ path: file, content: t.text });
    const opt = [
      `textfile='${escapeFilterValue(file)}'`,
      opts.fontFile ? `fontfile='${escapeFilterValue(opts.fontFile)}'` : "",
      `fontsize=${Math.round(t.fontSize * (H / p.settings.height))}`,
      `fontcolor=${t.color.replace("#", "0x")}`,
      `x=(w-text_w)*${n(t.x)}`,
      `y=(h-text_h)*${n(t.y)}`,
      "line_spacing=8",
      t.box ? "box=1:boxcolor=black@0.55:boxborderw=18" : "borderw=3:bordercolor=black@0.8",
      `enable='between(t,${n(t.start)},${n(clipEnd(t))})'`,
    ].filter(Boolean);
    filters.push(`[${last}]drawtext=${opt.join(":")}[t${i}]`);
    last = `t${i}`;
  });
  // Captions (ASS via libass).
  if (p.captions?.length) {
    const file = joinPath(opts.tempDir, "clipmaster_captions.ass");
    files.push({ path: file, content: buildAss(p.captions, p.captionSettings, W, H) });
    const fonts = opts.fontsDir ? `:fontsdir='${escapeFilterValue(opts.fontsDir)}'` : "";
    filters.push(`[${last}]ass=filename='${escapeFilterValue(file)}'${fonts}[cap]`);
    last = "cap";
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  // Audio mix.
  audioClips.forEach(({ clip: c, input }, i) => {
    const dur = clipDuration(c);
    const delayMs = Math.round(c.start * 1000);
    const chain = [
      `atrim=start=${n(c.in)}:end=${n(c.out)}`,
      "asetpts=PTS-STARTPTS",
      ...atempoChain(c.speed),
      `volume=${n(c.volume)}`,
      c.fadeIn > 0 ? `afade=t=in:st=0:d=${n(c.fadeIn)}` : "",
      c.fadeOut > 0 ? `afade=t=out:st=${n(Math.max(0, dur - c.fadeOut))}:d=${n(c.fadeOut)}` : "",
      "aresample=48000",
      "aformat=channel_layouts=stereo",
      `adelay=${delayMs}|${delayMs}`,
    ].filter(Boolean);
    filters.push(`[${input}:a]${chain.join(",")}[a${i}]`);
  });
  if (audioClips.length) {
    const labels = audioClips.map((_, i) => `[a${i}]`).join("");
    filters.push(`${labels}amix=inputs=${audioClips.length}:duration=longest:normalize=0,apad[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo[aout]`);
  }

  const q = QUALITY[opts.quality];
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    String(q.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    n(total),
    "-movflags",
    "+faststart",
    opts.outputPath
  );
  return { args, files, duration: total };
}

/** Size of media fitted inside W×H (even dimensions). Unknown size → full frame. */
export function fittedSize(aw: number | undefined, ah: number | undefined, W: number, H: number) {
  if (!aw || !ah) return { w: W, h: H };
  const k = Math.min(W / aw, H / ah);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { w: even(aw * k), h: even(ah * k) };
}

/** Scale / rotate / opacity for a transformed clip (after alpha format). */
export function transformFilters(t: { scale: number; rotation: number; opacity: number }): string[] {
  const out: string[] = [];
  if (t.scale !== 1) out.push(`scale='trunc(iw*${n(t.scale)}/2)*2':'trunc(ih*${n(t.scale)}/2)*2'`);
  if (t.rotation) {
    const a = `${n(t.rotation)}*PI/180`;
    out.push(`rotate=${a}:c=none:ow='rotw(${a})':oh='roth(${a})'`);
  }
  if (t.opacity < 1) out.push(`colorchannelmixer=aa=${n(t.opacity)}`);
  return out;
}

/**
 * Animated scale / rotation / opacity (clip-local time `t`). The frame is
 * padded to a constant size so downstream filters never see size changes.
 */
export function keyframeFilters(keys: Keyframe[], fit: { w: number; h: number }): string[] {
  const out: string[] = [];
  const maxS = Math.max(...keys.map((k) => k.scale));
  if (isAnimated(keys, "scale")) {
    const s = keyframeExpr(keys, "scale", "t");
    const bw = Math.max(2, Math.round((fit.w * maxS) / 2) * 2);
    const bh = Math.max(2, Math.round((fit.h * maxS) / 2) * 2);
    out.push(`scale=w='max(2\\,trunc(${fit.w}*(${s})/2)*2)':h='max(2\\,trunc(${fit.h}*(${s})/2)*2)':eval=frame`);
    out.push(`pad=w=${bw}:h=${bh}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`);
  } else if (keys[0].scale !== 1) {
    out.push(`scale='trunc(iw*${n(keys[0].scale)}/2)*2':'trunc(ih*${n(keys[0].scale)}/2)*2'`);
  }
  if (keys.some((k) => k.rotation)) {
    out.push(`rotate='(${keyframeExpr(keys, "rotation", "t")})*PI/180':c=none:ow='hypot(iw\\,ih)':oh=ow`);
  }
  if (isAnimated(keys, "opacity")) {
    out.push(`geq=lum='lum(X\\,Y)':cb='cb(X\\,Y)':cr='cr(X\\,Y)':a='alpha(X\\,Y)*(${keyframeExpr(keys, "opacity", "T")})'`);
  } else if (keys[0].opacity < 1) {
    out.push(`colorchannelmixer=aa=${n(keys[0].opacity)}`);
  }
  return out;
}

/** Parse `-progress pipe:1` output; returns seconds encoded, if present. */
export function parseProgress(line: string): number | null {
  const m = /^out_time_(?:ms|us)=(\d+)/.exec(line.trim());
  return m ? Number(m[1]) / 1e6 : null;
}
