import { useEffect, useMemo, useRef, useState } from "react";
import { captionTemplate, groupCaptionLines } from "../core/captions";
import { effectsCss, transitionPreview } from "../core/effects";
import { clipDuration, clipEnd, clipsOnTrack, projectDuration, textsAt } from "../core/project";
import type { MediaClip, Project } from "../core/types";
import { mediaUrl } from "../lib/backend";
import { captionCss } from "../lib/captionStyle";
import { useEditor } from "../store";

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
      syncMedia(el, c, playhead, playing, gainAt(c, playhead));
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
  const texts = textsAt(project, playhead);
  const captionLines = useMemo(() => {
    const t = captionTemplate(project.captionSettings.templateId);
    return groupCaptionLines(project.captions, project.captionSettings.maxWords ?? t.maxWords);
  }, [project.captions, project.captionSettings]);

  return (
    <div className="preview-wrap">
      <div className="stage" ref={stageRef}>
        <div className="frame" style={{ width: box.w, height: box.h }}>
          {layers.map((c) => {
            const asset = project.assets[c.assetId];
            if (!asset) return null;
            const fx = effectsCss(c.effects ?? []);
            const tr = transitionPreview(c.transIn, c.transOut, playhead - c.start, clipDuration(c));
            const style = {
              filter: [fx.filter, tr.filter].filter(Boolean).join(" ") || undefined,
              transform: [tr.transform, fx.transform].filter(Boolean).join(" ") || undefined,
              opacity: tr.opacity,
            };
            return asset.kind === "image" ? (
              <img key={c.id} className="layer" src={mediaUrl(asset.path)} style={style} alt="" />
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
          {texts.map((t) => (
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
          ))}
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
