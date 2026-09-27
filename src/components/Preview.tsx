import { useEffect, useMemo, useRef, useState } from "react";
import { captionTemplate, groupCaptionLines } from "../core/captions";
import { effectsCss, transitionPreview } from "../core/effects";
import { fittedSize } from "../core/ffmpeg";
import { clipDuration, clipEnd, clipsOnTrack, IDENTITY_TRANSFORM, projectDuration, textsAt, transformAt, transformPatch, updateClip } from "../core/project";
import type { MediaClip, Project, TextClip } from "../core/types";
import { presetPreview, textPreset } from "../core/textPresets";
import { mediaUrl } from "../lib/backend";
import { captionCss } from "../lib/captionStyle";
import { useEditor } from "../store";

/** Size a transformed layer to the media's fitted box (so outlines hug it). */
function fittedBox(aw: number | undefined, ah: number | undefined, W: number, H: number, x: number, y: number) {
  const f = fittedSize(aw, ah, W, H);
  const w = (f.w / W) * 100;
  const h = (f.h / H) * 100;
  return { width: `${w}%`, height: `${h}%`, left: `${x * 100 - w / 2}%`, top: `${y * 100 - h / 2}%` };
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

/** All visible media clips on video tracks at time t, bottom layer first. */
function layersAt(p: Project, t: number): MediaClip[] {
  const out: MediaClip[] = [];
  for (const track of [...p.tracks].reverse()) {
    if (track.kind !== "video" || track.hidden) continue;
    const hit = clipsOnTrack(p, track.id).find((c) => c.type === "media" && t >= c.start && t < clipEnd(c));
    if (hit && hit.type === "media") out.push(hit);
  }
  return out;
}

/** Media elements (video + audio) that should be audible at t, with their clips. */
function audioClipsAt(p: Project, t: number): MediaClip[] {
  return p.tracks
    .filter((tr) => tr.kind === "audio" && !tr.muted)
    .flatMap((tr) => clipsOnTrack(p, tr.id))
    .filter((c): c is MediaClip => c.type === "media" && t >= c.start && t < clipEnd(c));
}

function gainAt(c: MediaClip, t: number) {
  const local = t - c.start;
  const dur = clipDuration(c);
  let g = c.volume;
  if (c.fadeIn > 0 && local < c.fadeIn) g *= local / c.fadeIn;
  if (c.fadeOut > 0 && local > dur - c.fadeOut) g *= Math.max(0, (dur - local) / c.fadeOut);
  return Math.max(0, Math.min(1, g));
}

function syncMedia(el: HTMLMediaElement, c: MediaClip, t: number, playing: boolean, gain: number) {
  const desired = c.in + (t - c.start) * c.speed;
  el.playbackRate = c.speed;
  el.volume = gain;
  if (playing) {
    if (Math.abs(el.currentTime - desired) > 0.3) el.currentTime = desired;
    if (el.paused) el.play().catch(() => {});
  } else {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - desired) > 0.04) el.currentTime = desired;
  }
}

export function Preview() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const mediaEls = useRef(new Map<string, HTMLMediaElement>());
  const audioPool = useRef(new Map<string, HTMLAudioElement>());
  const total = projectDuration(project);
  const { width: W, height: H } = project.settings;

  // Fit the frame into the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 28) / W, (r.height - 28) / H);
      setBox({ w: Math.max(50, W * s), h: Math.max(50, H * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { playhead: t } = useEditor.getState();
      const next = t + dt;
      if (next >= projectDuration(useEditor.getState().project)) {
        setPlaying(false);
        setPlayhead(projectDuration(useEditor.getState().project));
        return;
      }
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, setPlayhead, setPlaying]);

  const layers = layersAt(project, playhead);
  const audible = audioClipsAt(project, playhead);

  // Sync video layers and audio-track elements to the playhead.
  useEffect(() => {
    for (const c of layers) {
      const el = mediaEls.current.get(c.id);
      const track = project.tracks.find((t) => t.id === c.trackId);
      if (el) syncMedia(el, c, playhead, playing, track?.muted ? 0 : gainAt(c, playhead));
    }
    const live = new Set(audible.map((c) => c.id));
    for (const c of audible) {
      let el = audioPool.current.get(c.id);
      const asset = project.assets[c.assetId];
      if (!asset) continue;
      if (!el) {
        el = new Audio(mediaUrl(asset.path));
        el.preload = "auto";
        audioPool.current.set(c.id, el);
      }
      // Preview approximation of auto-ducking: quieter music while a clip with sound plays.
      const duck = project.settings.autoDuck && layers.some((l) => project.assets[l.assetId]?.hasAudio) ? 0.3 : 1;
      syncMedia(el, c, playhead, playing, gainAt(c, playhead) * duck);
    }
    for (const [id, el] of audioPool.current) {
      if (!live.has(id)) {
        el.pause();
        if (!project.clips[id]) audioPool.current.delete(id);
      }
    }
  });

  useEffect(() => () => audioPool.current.forEach((el) => el.pause()), []);

  const scale = box.h / H;
  const selected = useEditor((s) => s.selected);

  // Drag the selected visual clip to move it; scroll to resize.
  const dragRef = useRef<{ id: string; x0: number; y0: number; base: Project } | null>(null);
  const target = layers.find((c) => selected.includes(c.id));
  const onFramePointerDown = (e: React.PointerEvent) => {
    if (!target) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    useEditor.getState().checkpoint();
    dragRef.current = { id: target.id, x0: e.clientX, y0: e.clientY, base: useEditor.getState().project };
  };
  const onFramePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const c = d.base.clips[d.id];
    if (c.type !== "media") return;
    const now = useEditor.getState().playhead;
    const t = transformAt(c, now) ?? IDENTITY_TRANSFORM;
    const snap = (v: number) => (Math.abs(v - 0.5) < 0.015 ? 0.5 : v);
    const values = { ...t, x: snap(t.x + (e.clientX - d.x0) / box.w), y: snap(t.y + (e.clientY - d.y0) / box.h) };
    useEditor.getState().replace(updateClip(d.base, d.id, transformPatch(c, now, values, d.base.settings.fps)));
  };
  const onFrameWheel = (e: React.WheelEvent) => {
    if (!target) return;
    const t = transformAt(target, playhead) ?? IDENTITY_TRANSFORM;
    const values = { ...t, scale: t.scale * (e.deltaY < 0 ? 1.05 : 0.95) };
    useEditor.getState().commit((p) => updateClip(p, target.id, transformPatch(target, playhead, values, p.settings.fps)));
  };
  const texts = textsAt(project, playhead);
  const captionLines = useMemo(() => {
    const t = captionTemplate(project.captionSettings.templateId);
    return groupCaptionLines(project.captions, project.captionSettings.maxWords ?? t.maxWords);
  }, [project.captions, project.captionSettings]);

  return (
    <div className="preview-wrap">
      <div className="stage" ref={stageRef}>
        <div
          className="frame"
          style={{ width: box.w, height: box.h, cursor: target ? "move" : undefined }}
          onPointerDown={onFramePointerDown}
          onPointerMove={onFramePointerMove}
          onPointerUp={() => (dragRef.current = null)}
          onWheel={onFrameWheel}
          title={target ? "Drag to move · scroll to resize" : undefined}
        >
          {layers.map((c) => {
            const asset = project.assets[c.assetId];
            if (!asset) return null;
            const fx = effectsCss(c.effects ?? []);
            const tr = transitionPreview(c.transIn, c.transOut, playhead - c.start, clipDuration(c));
            const tf = transformAt(c, playhead);
            const place = tf ? `scale(${tf.scale}) rotate(${tf.rotation}deg)` : "";
            const style = {
              filter: [fx.filter, tr.filter].filter(Boolean).join(" ") || undefined,
              transform: [place, tr.transform, fx.transform].filter(Boolean).join(" ") || undefined,
              opacity: tr.opacity * (tf?.opacity ?? 1),
              outline: selected.includes(c.id) && tf ? "2px dashed #a78bfa" : undefined,
              ...(tf ? fittedBox(asset.width, asset.height, W, H, tf.x, tf.y) : {}),
            };
            return asset.kind === "image" ? (
              <img key={c.id} className="layer" src={mediaUrl(asset.path)} style={style} alt="" draggable={false} />
            ) : (
              <video
                key={c.id}
                ref={(el) => {
                  if (el) mediaEls.current.set(c.id, el);
                  else mediaEls.current.delete(c.id);
                }}
                src={mediaUrl(asset.path)}
                style={style}
                preload="auto"
                playsInline
              />
            );
          })}
          {texts.map((t) =>
            textPreset(t.preset) ? (
              <PresetText key={t.id} clip={t} local={playhead - t.start} scale={scale} />
            ) : (
              <div
                key={t.id}
                className="text-layer"
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  fontSize: t.fontSize * scale,
                  color: t.color,
                  background: t.box ? "rgba(0,0,0,.55)" : undefined,
                  padding: t.box ? `${4 * scale * 3}px ${6 * scale * 3}px` : undefined,
                  textShadow: t.box ? undefined : "0 0 3px #000, 0 0 3px #000",
                }}
              >
                {t.text}
              </div>
            )
          )}
          <CaptionOverlay lines={captionLines} t={playhead} scale={scale} />
          {!layers.length && !texts.length && (
            <div className="empty-state" style={{ position: "absolute", inset: 0 }}>
              <div style={{ alignSelf: "end" }}>{total ? "No clip at the playhead" : "Import media and drag it onto the timeline"}</div>
            </div>
          )}
        </div>
      </div>
      <div className="transport">
        <button className="icon" title="Start (Home)" onClick={() => setPlayhead(0)}>⏮</button>
        <button className="icon primary" title="Play / pause (Space)" onClick={() => setPlaying(!playing)} disabled={!total}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="icon" title="End (End)" onClick={() => setPlayhead(total)}>⏭</button>
        <span className="timecode">{formatTime(playhead)} / {formatTime(total)}</span>
        <span className="grow" />
        <span className="muted small">{W}×{H} · {project.settings.fps} fps</span>
      </div>
    </div>
  );
}

function CaptionOverlay({ lines, t, scale }: { lines: ReturnType<typeof groupCaptionLines>; t: number; scale: number }) {
  const settings = useEditor((s) => s.project.captionSettings);
  const H = useEditor((s) => s.project.settings.height);
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return null;
  const tpl = captionTemplate(settings.templateId);
  const { base, active } = captionCss(tpl, tpl.size * H * settings.scale * scale);
  const idx = line.words.findIndex((w, i) => t >= w.start && t < (line.words[i + 1]?.start ?? line.end));
  const y = settings.y ?? (tpl.position === "top" ? 0.12 : tpl.position === "center" ? 0.5 : 0.86);
  let words = line.words;
  if (tpl.animation === "word") words = idx >= 0 ? [line.words[idx]] : [];
  return (
    <div className="caption-layer" style={{ top: `${y * 100}%` }}>
      <span style={base}>
        {words.map((w, i) => {
          const real = tpl.animation === "word" ? idx : i;
          const isActive = real === idx && ["highlight", "highlight-box", "karaoke"].includes(tpl.animation);
          const sung = tpl.animation === "karaoke" && real <= idx;
          const hidden = tpl.animation === "reveal" && real > idx;
          return (
            <span key={i} style={{ ...(isActive || sung ? active : {}), opacity: hidden ? 0 : 1 }}>
              {w.text}
              {i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </span>
    </div>
  );
}

/** Live-preview approximation of an animated text template (export uses libass). */
function PresetText({ clip, local, scale }: { clip: TextClip; local: number; scale: number }) {
  const p = textPreset(clip.preset)!;
  const anim = presetPreview(p, local, clip.duration);
  const text = p.uppercase ? clip.text.toUpperCase() : clip.text;
  const [title, ...rest] = text.split("\n");
  const sub = rest.join(" ");
  const fs = clip.fontSize * scale;
  const accent = clip.accent ?? p.accent;
  const shown = anim.reveal != null ? title.slice(0, Math.ceil(title.length * anim.reveal)) : title;
  const look: React.CSSProperties =
    p.look === "box"
      ? { background: accent, padding: `${fs * 0.25}px ${fs * 0.45}px`, borderRadius: fs * 0.12 }
      : p.look === "banner"
        ? { background: accent, padding: `${fs * 0.2}px ${fs * 0.4}px`, minWidth: "88%" }
        : p.look === "bar"
          ? { borderLeft: `${fs * 0.22}px solid ${accent}`, paddingLeft: fs * 0.35 }
          : p.look === "glow"
            ? { textShadow: `0 0 ${fs * 0.15}px ${accent}, 0 0 ${fs * 0.3}px ${accent}` }
            : p.look === "plain"
              ? { textShadow: "0 2px 6px #000a" }
              : { WebkitTextStroke: `${fs * 0.06}px #000`, paintOrder: "stroke fill" };
  return (
    <div
      className="text-layer"
      style={{
        left: `${clip.x * 100}%`,
        top: `${clip.y * 100}%`,
        transform: `${p.align === "left" ? "translate(0,0)" : "translate(-50%,-50%)"} ${anim.transform}`,
        transformOrigin: p.align === "left" ? "left center" : "center",
        opacity: anim.opacity,
        filter: anim.filter,
        textAlign: p.align,
        fontFamily: `"${p.font}", "Poppins", sans-serif`,
        fontWeight: p.bold || p.font.includes("Bold") ? 800 : 400,
        fontStyle: p.italic ? "italic" : "normal",
        fontSize: fs,
        color: clip.color,
        lineHeight: 1.15,
        ...look,
      }}
    >
      {shown}
      {sub && <div style={{ fontSize: fs * 0.7, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}
