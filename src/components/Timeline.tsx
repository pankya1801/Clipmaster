import { useMemo, useRef, useState } from "react";
import { captionTemplate, groupCaptionLines } from "../core/captions";
import { clipDuration, moveClip, projectDuration, snapTime, trimEnd, trimStart, addTrack, removeTrack, updateTrack } from "../core/project";
import type { Project, Track } from "../core/types";
import { addAssetToTimeline, addTextAtPlayhead, deleteSelected, splitAtPlayhead } from "../lib/actions";
import { useEditor } from "../store";

const ROW_H = 58;
const SNAP_PX = 8;

type Drag =
  | { kind: "move"; id: string; base: Project; grabOffset: number }
  | { kind: "trim-l" | "trim-r"; id: string; base: Project }
  | { kind: "scrub" };

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const selected = useEditor((s) => s.selected);
  const thumbs = useEditor((s) => s.thumbs);
  const { setZoom, setPlayhead, select, replace, checkpoint, commit } = useEditor.getState();
  const lanesRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);

  const total = projectDuration(project);
  const width = Math.max(1200, (total + 30) * zoom);
  const captionLines = useMemo(
    () => groupCaptionLines(project.captions, project.captionSettings.maxWords ?? captionTemplate(project.captionSettings.templateId).maxWords),
    [project.captions, project.captionSettings]
  );

  const timeAt = (clientX: number) => {
    const r = lanesRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / zoom);
  };
  const trackAt = (clientY: number): Track | undefined => {
    const r = lanesRef.current!.getBoundingClientRect();
    const i = Math.floor((clientY - r.top - 24) / ROW_H);
    return project.tracks[i];
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    const threshold = SNAP_PX / zoom;
    if (d.kind === "scrub") return setPlayhead(t);
    const c = d.base.clips[d.id];
    if (d.kind === "move") {
      const raw = t - d.grabOffset;
      const dur = clipDuration(c);
      let start = snapTime(d.base, raw, threshold, [playhead], d.id);
      const endSnap = snapTime(d.base, raw + dur, threshold, [playhead], d.id);
      if (start === raw && endSnap !== raw + dur) start = endSnap - dur;
      const track = trackAt(e.clientY) ?? d.base.tracks.find((tr) => tr.id === c.trackId)!;
      replace(moveClip(d.base, d.id, track.id, start));
    } else if (d.kind === "trim-l") {
      replace(trimStart(d.base, d.id, snapTime(d.base, t, threshold, [playhead], d.id)));
    } else {
      replace(trimEnd(d.base, d.id, snapTime(d.base, t, threshold, [playhead], d.id)));
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  const startClipDrag = (e: React.PointerEvent, id: string, kind: "move" | "trim-l" | "trim-r") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    select(multi ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : [id]);
    checkpoint();
    const base = useEditor.getState().project;
    drag.current = kind === "move" ? { kind, id, base, grabOffset: timeAt(e.clientX) - base.clips[id].start } : { kind, id, base };
  };

  const ticks = useMemo(() => {
    const step = zoom > 150 ? 0.5 : zoom > 60 ? 1 : zoom > 25 ? 5 : zoom > 10 ? 10 : 30;
    const out: number[] = [];
    for (let t = 0; t * zoom < width; t += step) out.push(t);
    return out;
  }, [zoom, width]);

  return (
    <div className="timeline" style={{ ["--row-h" as any]: `${ROW_H}px` }}>
      <div className="tl-toolbar">
        <button onClick={splitAtPlayhead} title="Split at playhead (S)">✂ Split</button>
        <button onClick={() => deleteSelected(false)} disabled={!selected.length} title="Delete (Del)">🗑 Delete</button>
        <button onClick={() => deleteSelected(true)} disabled={!selected.length} title="Ripple delete (Shift+Del)">⇤ Ripple</button>
        <button onClick={() => addTextAtPlayhead()} title="Add text (T)">T Text</button>
        <div className="sep" />
        <button onClick={() => commit((p) => addTrack(p, "video"))}>+ Video track</button>
        <button onClick={() => commit((p) => addTrack(p, "audio"))}>+ Audio track</button>
        <span className="grow" />
        <span className="muted small">Zoom</span>
        <input type="range" min={8} max={400} value={zoom} style={{ width: 140 }} onChange={(e) => setZoom(+e.target.value)} />
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          <div className="tl-ruler-head" />
          {project.tracks.map((t) => (
            <div key={t.id} className="tl-head">
              <span className="dot" style={{ background: `var(--${t.kind === "text" ? "texttrack" : t.kind})` }} />
              <span className="name">{t.name}</span>
              {t.kind !== "text" && (
                <button className="ghost icon" title={t.muted ? "Unmute" : "Mute"} onClick={() => commit((p) => updateTrack(p, t.id, { muted: !t.muted }))}>
                  {t.muted ? "🔇" : "🔊"}
                </button>
              )}
              {t.kind !== "audio" && (
                <button className="ghost icon" title={t.hidden ? "Show" : "Hide"} onClick={() => commit((p) => updateTrack(p, t.id, { hidden: !t.hidden }))}>
                  {t.hidden ? "🙈" : "👁"}
                </button>
              )}
              <button className="ghost icon" title="Remove track" onClick={() => commit((p) => removeTrack(p, t.id))}>×</button>
            </div>
          ))}
          <div className="tl-head"><span className="dot" style={{ background: "var(--caption)" }} /><span className="name">Captions</span></div>
        </div>
        <div
          className="tl-lanes"
          ref={lanesRef}
          style={{ width }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoom(zoom * (e.deltaY < 0 ? 1.15 : 0.87));
            }
          }}
        >
          <div
            className="tl-ruler"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { kind: "scrub" };
              setPlayhead(timeAt(e.clientX));
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          >
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: t * zoom }}>{fmtTick(t)}</div>
            ))}
          </div>
          {project.tracks.map((track) => (
            <div
              key={track.id}
              className={`tl-lane ${dropTrack === track.id ? "drop" : ""}`}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  select([]);
                  setPlayhead(timeAt(e.clientX));
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-clipmaster-asset")) {
                  e.preventDefault();
                  setDropTrack(track.id);
                }
              }}
              onDragLeave={() => setDropTrack(null)}
              onDrop={(e) => {
                setDropTrack(null);
                const id = e.dataTransfer.getData("application/x-clipmaster-asset");
                if (id) addAssetToTimeline(id, track.id, timeAt(e.clientX));
              }}
            >
              {Object.values(project.clips)
                .filter((c) => c.trackId === track.id)
                .map((c) => {
                  const asset = c.type === "media" ? project.assets[c.assetId] : undefined;
                  const kind = c.type === "text" ? "text" : asset?.kind ?? "video";
                  const w = clipDuration(c) * zoom;
                  const thumb = asset ? thumbs[asset.id] : undefined;
                  const fxCount = c.type === "media" ? (c.effects?.length ?? 0) : 0;
                  return (
                    <div
                      key={c.id}
                      className={`clip ${kind} ${selected.includes(c.id) ? "selected" : ""}`}
                      style={{ left: c.start * zoom, width: Math.max(4, w), backgroundImage: thumb && kind !== "audio" ? `url(${thumb})` : undefined }}
                      onPointerDown={(e) => startClipDrag(e, c.id, "move")}
                      title={c.type === "text" ? c.text : asset?.name}
                    >
                      {c.type === "media" && c.transIn && <div className="trans" style={{ left: 0, width: c.transIn.duration * zoom }} />}
                      {c.type === "media" && c.transOut && <div className="trans out" style={{ right: 0, width: c.transOut.duration * zoom }} />}
                      {fxCount > 0 && <span className="fx-dot">fx {fxCount}</span>}
                      <div className="handle l" onPointerDown={(e) => startClipDrag(e, c.id, "trim-l")} />
                      <div className="clip-label">
                        {c.type === "text" ? `T ${c.text}` : `${asset?.name ?? "missing"}${c.type === "media" && c.speed !== 1 ? ` · ${c.speed}×` : ""}`}
                      </div>
                      <div className="handle r" onPointerDown={(e) => startClipDrag(e, c.id, "trim-r")} />
                    </div>
                  );
                })}
            </div>
          ))}
          <div className="tl-lane">
            {captionLines.map((l, i) => (
              <div key={i} className="cap-block" style={{ left: l.start * zoom, width: Math.max(3, (l.end - l.start) * zoom) }} title={l.words.map((w) => w.text).join(" ")}>
                {l.words.map((w) => w.text).join(" ")}
              </div>
            ))}
          </div>
          <div className="playhead" style={{ left: playhead * zoom }} />
          {/* clip end markers help snapping be visible */}
          {total > 0 && <div style={{ position: "absolute", top: 24, bottom: 0, left: total * zoom, borderLeft: "1px dashed #ffffff22" }} />}
        </div>
      </div>
    </div>
  );
}

function fmtTick(t: number) {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return m ? `${m}:${String(Math.floor(s)).padStart(2, "0")}` : `${Number(s.toFixed(1))}s`;
}

