import { clipFit, reframeGraph } from "./reframe";
import { boxPixels, generatorOfPath, maskFilter } from "./visuals";
import { silentTiming, timingFilters } from "./speed";
import { clipDuration, clipEnd, clipsOnTrack, projectDuration } from "./project";
import { buildAss } from "./captions";
import { effectById, slideOverlay, transitionFilters } from "./effects";
import { isAnimated, keyframeExpr } from "./keyframes";
import { buildTextAss, textPreset } from "./textPresets";
import type { Keyframe, MediaClip, Project, TextClip } from "./types";

export type ExportQuality = "draft" | "standard" | "high";

export type ExportFormat = "mp4" | "webm" | "mov" | "gif";

export interface ExportOptions {
  outputPath: string;
  /** Directory where text files for drawtext can be written. */
  tempDir: string;
  quality: ExportQuality;
  /** Optional font file for text (otherwise FFmpeg's fontconfig default). */
  fontFile?: string;
  /** Directory of bundled fonts for captions. */
  fontsDir?: string;
  /** Normalise loudness to -14 LUFS (YouTube / TikTok / Instagram target). */
  normalizeLoudness?: boolean;
  /** RNNoise model file for clips with Studio voice. */
  voiceModel?: string;
  /** Container / codec. GIF has no sound and runs at up to 15 fps. */
  format?: ExportFormat;
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

/**
 * Voice clean-up: rumble cut, FFT noise reduction and non-local-means
 * denoise. Measured on white noise at -35/-50 dBFS: hiss drops by 35-40 dB
 * while speech-band level is kept (see tests/features.test.ts).
 */
export const VOICE_CLEANUP = ["highpass=f=80", "afftdn=nr=20:nf=-40", "anlmdn=s=7"];

/** Music ducking: ~-12 dB under speech, fast attack, gentle release. */
export const DUCKING = "sidechaincompress=threshold=0.015:ratio=12:attack=20:release=450:makeup=1";

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
  // Voice = sound from video clips; music = clips on audio tracks.
  const audioClips: { clip: MediaClip; input: number; role: "voice" | "music" }[] = [];

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
      if (next?.type === "media" && next.transIn?.id === "dissolve" && Math.abs(next.start - clipEnd(c)) < 0.05 && !c.freeze && !c.reverse && !c.ramp?.length) {
        tail = Math.min(next.transIn.duration, clipDuration(next));
        if (!isImage) tail = Math.min(tail, Math.max(0, (asset.duration - c.out) / c.speed));
      }
      const shown = dur + tail;
      const keys = c.keyframes?.length ? c.keyframes : undefined;
      const tf = keys ? keys[0] : c.transform;
      // Layout box: the clip fills only part of the frame (split screen).
      const box = !tf && c.box ? boxPixels(c.box, W, H) : { w: W, h: H };
      const gen = generatorOfPath(asset.path);
      let idx: number;
      if (gen) {
        args.push("-f", "lavfi", "-t", n(shown), "-i", gen.source(box.w, box.h, fps, shown));
        idx = inputIndex++;
      } else idx = addInput(asset.path, isImage, shown);
      const media = gen ? { width: box.w, height: box.h } : asset;
      // With a transform the clip keeps its own aspect (no letterbox pad), so
      // effects see the fitted frame size instead of the canvas size.
      const fit = fittedSize(media.width, media.height, W, H);
      const ctx = tf ? { W: fit.w, H: fit.h, fps, duration: dur } : { W: box.w, H: box.h, fps, duration: dur };
      // Source stream: optional stabilising and AI background mask, then timing
      // (speed / ramp / freeze / reverse) and green-screen key.
      let src = `${idx}:v`;
      if (c.stabilize && !gen) {
        filters.push(`[${src}]deshake,crop=trunc(iw*0.94/2)*2:trunc(ih*0.94/2)*2[st${vi}]`);
        src = `st${vi}`;
      }
      if (c.bgMask && !gen && !isImage) {
        const mi = addInput(c.bgMask.path, false, 0);
        filters.push(`[${src}]format=yuva420p[bs${vi}]`);
        filters.push(`[${mi}:v]setpts=PTS-STARTPTS+${n(c.bgMask.start)}/TB,format=gray[bm${vi}]`);
        filters.push(`[bm${vi}][bs${vi}]scale2ref[bmk${vi}][bsr${vi}]`);
        filters.push(`[bsr${vi}][bmk${vi}]alphamerge[ba${vi}]`);
        src = `ba${vi}`;
      }
      if (c.faceMask && !gen && !isImage) {
        const mi = addInput(c.faceMask.path, false, 0);
        filters.push(`[${src}]split[fo${vi}][fb${vi}]`);
        filters.push(`[fb${vi}]boxblur=lr='min(w\\,h)/24':lp=3,format=yuva420p[fbb${vi}]`);
        filters.push(`[${mi}:v]setpts=PTS-STARTPTS+${n(c.faceMask.start)}/TB,format=gray[fm${vi}]`);
        filters.push(`[fm${vi}][fbb${vi}]scale2ref[fmk${vi}][fbr${vi}]`);
        filters.push(`[fbr${vi}][fmk${vi}]alphamerge[fba${vi}]`);
        filters.push(`[fo${vi}][fba${vi}]overlay=eof_action=pass:format=auto[fx${vi}]`);
        src = `fx${vi}`;
      }
      const head = [
        ...timingFilters(c, isImage, shown, tail),
        ...(c.smoothSlow && !isImage && !c.freeze && (c.speed < 0.99 || c.ramp?.length) ? [`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`] : []),
        ...(c.enhance && !gen ? ["hqdn3d=1.5:1.5:6:6", "unsharp=5:5:0.8:5:5:0"] : []),
        ...(c.chroma ? ["format=yuva420p", chromaFilter(c.chroma)] : []),
      ];
      filters.push(`[${src}]${head.join(",")}[h${vi}]`);
      // Untransformed clips fill the canvas per their fit mode (fit / fill / blur).
      if (!tf) filters.push(reframeGraph(c, media, box.w, box.h, gen ? "fill" : clipFit(c, p.settings), `h${vi}`, `r${vi}`));
      const chain = [
        tf ? `scale=${fit.w}:${fit.h}` : "",
        "setsar=1",
        `fps=${fps}`,
        ...(c.effects ?? []).map((e) => effectById(e.id)?.filter(e.amount, ctx)).filter((x): x is string => !!x),
        c.lut ? lutFilter(c.lut, `lut${vi}`) : "",
        gen?.category === "overlay" ? "format=rgba" : "",
        "format=yuva420p",
        maskFilter(c.mask, c.feather) ?? "",
        ...transitionFilters(c.transIn, c.transOut, dur, ctx),
        ...(keys ? keyframeFilters(keys, fit) : tf ? transformFilters(tf) : []),
        `setpts=PTS+${n(c.start)}/TB`,
      ].filter(Boolean);
      filters.push(`[${tf ? `h${vi}` : `r${vi}`}]${chain.join(",")}[v${vi}]`);
      const pos = slideOverlay(c.transIn, c.start);
      const tv = `(t-${n(c.start)})`;
      const boxCentre = !tf && c.box ? { x: c.box.x + c.box.w / 2, y: c.box.y + c.box.h / 2 } : { x: 0.5, y: 0.5 };
      const cx = keys ? keyframeExpr(keys, "x", tv) : n(tf?.x ?? boxCentre.x);
      const cy = keys ? keyframeExpr(keys, "y", tv) : n(tf?.y ?? boxCentre.y);
      filters.push(
        `[${last}][v${vi}]overlay=x='W*${cx}-w/2+(${pos.x})':y='H*${cy}-h/2+(${pos.y})':eof_action=pass:enable='between(t,${n(c.start)},${n(c.start + shown)})'[o${vi}]`
      );
      last = `o${vi}`;
      vi++;
      if (asset.hasAudio && !track.muted && !isImage && !silentTiming(c)) audioClips.push({ clip: c, input: idx, role: "voice" });
    });
  }

  // Audio tracks.
  for (const track of p.tracks.filter((t) => t.kind === "audio" && !t.muted)) {
    for (const c of clipsOnTrack(p, track.id)) {
      if (c.type !== "media") continue;
      const asset = p.assets[c.assetId];
      if (!asset?.hasAudio) continue;
      audioClips.push({ clip: c, input: addInput(asset.path, false, 0), role: "music" });
    }
  }

  // Text overlays.
  const texts = p.tracks
    .filter((t) => t.kind === "text" && !t.hidden)
    .reverse()
    .flatMap((t) => clipsOnTrack(p, t.id))
    .filter((c): c is TextClip => c.type === "text" && c.text.trim().length > 0 && !textPreset(c.preset));
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
  // Animated text / lower-third templates (ASS via libass).
  const presetTexts = p.tracks
    .filter((t) => t.kind === "text" && !t.hidden)
    .flatMap((t) => clipsOnTrack(p, t.id))
    .filter((c): c is TextClip => c.type === "text");
  const textAss = buildTextAss(presetTexts, W, H, p.settings.height);
  if (textAss) {
    const file = joinPath(opts.tempDir, "clipmaster_text.ass");
    files.push({ path: file, content: textAss });
    const fonts = opts.fontsDir ? `:fontsdir='${escapeFilterValue(opts.fontsDir)}'` : "";
    filters.push(`[${last}]ass=filename='${escapeFilterValue(file)}'${fonts}[txt]`);
    last = "txt";
  }

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
      c.reverse ? "areverse" : "",
      ...atempoChain(c.speed),
      ...(c.studioVoice && opts.voiceModel ? ["highpass=f=70", `arnndn=m='${escapeFilterValue(opts.voiceModel)}'`, "dynaudnorm=f=150:g=15"] : c.denoise || c.studioVoice ? VOICE_CLEANUP : []),
      `volume=${n(c.volume)}`,
      c.fadeIn > 0 ? `afade=t=in:st=0:d=${n(c.fadeIn)}` : "",
      c.fadeOut > 0 ? `afade=t=out:st=${n(Math.max(0, dur - c.fadeOut))}:d=${n(c.fadeOut)}` : "",
      "aresample=48000",
      "aformat=channel_layouts=stereo",
      `adelay=${delayMs}|${delayMs}`,
    ].filter(Boolean);
    filters.push(`[${input}:a]${chain.join(",")}[a${i}]`);
  });
  const loud = opts.normalizeLoudness ? ",loudnorm=I=-14:TP=-1.5:LRA=11" : "";
  const voice = audioClips.map((a, i) => ({ ...a, i })).filter((a) => a.role === "voice");
  const music = audioClips.map((a, i) => ({ ...a, i })).filter((a) => a.role === "music");
  if (p.settings.autoDuck && voice.length && music.length) {
    // Duck the music under speech: the voice mix drives a sidechain compressor on the music.
    const mix = (xs: typeof voice) => `${xs.map((a) => `[a${a.i}]`).join("")}amix=inputs=${xs.length}:duration=longest:normalize=0`;
    filters.push(`${mix(voice)},asplit=2[vox][voxsc]`);
    filters.push(`${mix(music)}[mus]`);
    filters.push(`[mus][voxsc]${DUCKING}[ducked]`);
    filters.push(`[vox][ducked]amix=inputs=2:duration=longest:normalize=0${loud},aresample=48000,apad[aout]`);
  } else if (audioClips.length) {
    const labels = audioClips.map((_, i) => `[a${i}]`).join("");
    filters.push(`${labels}amix=inputs=${audioClips.length}:duration=longest:normalize=0${loud},aresample=48000,apad[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo[aout]`);
  }

  if (Object.values(p.clips).some((c) => c.type === "media" && c.enhance)) filters[0] = `sws_flags=lanczos+accurate_rnd;${filters[0]}`;
  const q = QUALITY[opts.quality];
  const fmt = opts.format ?? "mp4";
  if (fmt === "gif") {
    filters.push(`[vout]fps=${Math.min(15, fps)},split[ga][gb];[ga]palettegen=stats_mode=diff[gp];[gb][gp]paletteuse=dither=bayer:bayer_scale=4[vgif]`, `[aout]atrim=duration=${n(total)},anullsink`);
    args.push("-filter_complex", filters.join(";"), "-map", "[vgif]", "-loop", "0", "-t", n(total), opts.outputPath);
    return { args, files, duration: total };
  }
  const video =
    fmt === "webm"
      ? ["-c:v", "libvpx-vp9", "-crf", String(q.crf + 12), "-b:v", "0", "-row-mt", "1", "-deadline", opts.quality === "high" ? "good" : "realtime", "-pix_fmt", "yuv420p"]
      : ["-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf), "-pix_fmt", "yuv420p"];
  const audio = fmt === "webm" ? ["-c:a", "libopus", "-b:a", "160k"] : ["-c:a", "aac", "-b:a", "192k"];
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    ...video,
    "-r",
    String(fps),
    ...audio,
    "-t",
    n(total),
    ...(fmt === "webm" ? [] : ["-movflags", "+faststart"]),
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

/** Green-screen key (FFmpeg chromakey on YUV; similarity/blend 0..1). */
export function chromaFilter(k: { color: string; similarity: number; blend: number }): string {
  return `chromakey=color=0x${k.color.replace("#", "")}:similarity=${n(Math.max(0.01, k.similarity))}:blend=${n(k.blend)}`;
}

/** 3D LUT grade, mixed with the original by `amount`. */
export function lutFilter(l: { path: string; amount: number }, id = "lut"): string {
  const file = `lut3d=file='${escapeFilterValue(l.path)}'`;
  if (l.amount >= 0.999) return file;
  // Mix: split, grade one copy, blend back.
  return `split[${id}o][${id}g];[${id}g]${file}[${id}r];[${id}o][${id}r]blend=all_mode=normal:all_opacity=${n(l.amount)}`;
}
