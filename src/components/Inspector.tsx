import { effectById, transitionById, TRANSITIONS } from "../core/effects";
import { clipDuration, IDENTITY_TRANSFORM, PIP_PRESETS, transformAt, transformPatch, updateClip } from "../core/project";
import { upsertKeyframe } from "../core/keyframes";
import { TEXT_PRESETS } from "../core/textPresets";
import { ASPECT_PRESETS, MediaClip, TextClip } from "../core/types";
import { useEditor } from "../store";
import { formatTime } from "./Preview";
import { SHORTCUTS } from "./shortcuts";

function Num({ label, value, min, max, step = 0.1, suffix = "", onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}<b>{Number(value.toFixed(2))}{suffix}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function Inspector() {
  const clip = useEditor((s) => (s.selected.length === 1 ? s.project.clips[s.selected[0]] : undefined));
  const count = useEditor((s) => s.selected.length);
  return (
    <div className="panel right">
      <div className="tabs"><button className="active">{clip ? (clip.type === "text" ? "Text" : "Clip") : "Project"}</button></div>
      <div className="panel-body">
        {count > 1 ? <p className="muted">{count} clips selected</p> : clip?.type === "media" ? <MediaInspector clip={clip} /> : clip?.type === "text" ? <TextInspector clip={clip} /> : <ProjectInspector />}
      </div>
    </div>
  );
}

function MediaInspector({ clip }: { clip: MediaClip }) {
  const asset = useEditor((s) => s.project.assets[clip.assetId]);
  const { commit } = useEditor.getState();
  const set = (patch: Partial<MediaClip>) => commit((p) => updateClip(p, clip.id, patch));
  const dur = clipDuration(clip);
  const visual = asset?.kind !== "audio";
  return (
    <>
      <div>
        <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{asset?.name}</div>
        <div className="muted small">Starts {formatTime(clip.start)} · {formatTime(dur)} long</div>
      </div>
      <Num label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} suffix="×" onChange={(speed) => set({ speed })} />
      {asset?.hasAudio && (
        <>
          <Num label="Volume" value={clip.volume * 100} min={0} max={200} step={1} suffix="%" onChange={(v) => set({ volume: v / 100 })} />
          <Num label="Audio fade in" value={clip.fadeIn} min={0} max={Math.min(5, dur)} suffix="s" onChange={(fadeIn) => set({ fadeIn })} />
          <Num label="Audio fade out" value={clip.fadeOut} min={0} max={Math.min(5, dur)} suffix="s" onChange={(fadeOut) => set({ fadeOut })} />
          <label className="check" title="Removes background hiss and hum, cuts rumble and evens out volume. Applied on export.">
            <input type="checkbox" checked={!!clip.denoise} onChange={(e) => set({ denoise: e.target.checked || undefined })} /> 🎙 Clean up voice (noise reduction)
          </label>
        </>
      )}
      {visual && (
        <>
          <div className="section-title">Transform</div>
          <TransformControls clip={clip} set={set} />
          <div className="section-title">Transitions</div>
          {(["transIn", "transOut"] as const).map((key) => {
            const side = key === "transIn" ? "in" : "out";
            const cur = clip[key];
            return (
              <div key={key} className="fx-item">
                <label className="field">
                  <span>{side === "in" ? "In" : "Out"}</span>
                  <select value={cur?.id ?? ""} onChange={(e) => set({ [key]: e.target.value ? { id: e.target.value, duration: cur?.duration ?? 0.5 } : undefined })}>
                    <option value="">None</option>
                    {TRANSITIONS.filter((t) => t.side === side).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                {cur && <Num label="Duration" value={cur.duration} min={0.1} max={Math.min(3, dur)} suffix="s" onChange={(duration) => set({ [key]: { ...cur, duration } })} />}
              </div>
            );
          })}
          <div className="section-title">Effects ({clip.effects.length})</div>
          {!clip.effects.length && <p className="muted small">Add effects from the Effects tab.</p>}
          {clip.effects.map((e, i) => {
            const def = effectById(e.id);
            return (
              <div key={e.id} className="fx-item">
                <div className="row">
                  <b className="grow">{def?.name ?? e.id}</b>
                  <button className="ghost icon" disabled={i === 0} title="Move up" onClick={() => {
                    const fx = [...clip.effects];
                    [fx[i - 1], fx[i]] = [fx[i], fx[i - 1]];
                    set({ effects: fx });
                  }}>↑</button>
                  <button className="ghost icon" title="Remove" onClick={() => set({ effects: clip.effects.filter((x) => x.id !== e.id) })}>×</button>
                </div>
                <Num label="Strength" value={e.amount * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ effects: clip.effects.map((x) => (x.id === e.id ? { ...x, amount: v / 100 } : x)) })} />
              </div>
            );
          })}
          {clip.transIn && !transitionById(clip.transIn.id) && <p className="small muted">Unknown transition</p>}
        </>
      )}
    </>
  );
}

function TextInspector({ clip }: { clip: TextClip }) {
  const { commit } = useEditor.getState();
  const H = useEditor((s) => s.project.settings.height);
  const set = (patch: Partial<TextClip>) => commit((p) => updateClip(p, clip.id, patch));
  return (
    <>
      <label className="field">
        <span>Template</span>
        <select value={clip.preset ?? ""} onChange={(e) => {
          const p = TEXT_PRESETS.find((x) => x.id === e.target.value);
          set(p ? { preset: p.id, x: p.x, y: p.y, color: p.color, accent: p.accent, box: false } : { preset: undefined });
        }}>
          <option value="">Plain text</option>
          {TEXT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.category} · {p.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Text {clip.preset ? "(new line = subtitle)" : ""}</span>
        <textarea rows={3} value={clip.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <Num label="Duration" value={clip.duration} min={0.2} max={30} suffix="s" onChange={(duration) => set({ duration })} />
      <Num label="Font size" value={clip.fontSize} min={12} max={Math.round(H / 4)} step={1} suffix="px" onChange={(fontSize) => set({ fontSize })} />
      <Num label="Horizontal" value={clip.x * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ x: v / 100 })} />
      <Num label="Vertical" value={clip.y * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ y: v / 100 })} />
      <div className="row">
        <label className="check"><input type="color" value={clip.color} onChange={(e) => set({ color: e.target.value })} /> Colour</label>
        {clip.preset ? (
          <label className="check"><input type="color" value={clip.accent ?? "#8b5cf6"} onChange={(e) => set({ accent: e.target.value })} /> Accent</label>
        ) : (
          <label className="check"><input type="checkbox" checked={clip.box} onChange={(e) => set({ box: e.target.checked })} /> Background box</label>
        )}
      </div>
    </>
  );
}

function ProjectInspector() {
  const settings = useEditor((s) => s.project.settings);
  const name = useEditor((s) => s.project.name);
  const { commit } = useEditor.getState();
  const preset = ASPECT_PRESETS.find((p) => p.width === settings.width && p.height === settings.height);
  return (
    <>
      <label className="field">
        <span>Project name</span>
        <input type="text" value={name} onChange={(e) => commit((p) => ({ ...p, name: e.target.value }))} />
      </label>
      <label className="field">
        <span>Canvas</span>
        <select
          value={preset?.label ?? ""}
          onChange={(e) => {
            const p = ASPECT_PRESETS.find((x) => x.label === e.target.value);
            if (p) commit((pr) => ({ ...pr, settings: { ...pr.settings, width: p.width, height: p.height } }));
          }}
        >
          {!preset && <option value="">Custom {settings.width}×{settings.height}</option>}
          {ASPECT_PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Frame rate</span>
        <select value={settings.fps} onChange={(e) => commit((p) => ({ ...p, settings: { ...p.settings, fps: +e.target.value } }))}>
          {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
        </select>
      </label>
      <label className="check" title="Lowers music on audio tracks automatically whenever a video clip has sound (speech). Exact on export; approximate in preview.">
        <input type="checkbox" checked={!!settings.autoDuck} onChange={(e) => commit((p) => ({ ...p, settings: { ...p.settings, autoDuck: e.target.checked } }))} />
        🎚 Auto-duck music under speech
      </label>
      <div className="section-title">Shortcuts</div>
      <div className="small muted" style={{ display: "grid", gap: 4 }}>
        {SHORTCUTS.map(([k, v]) => <div key={k} className="row"><span className="kbd">{k}</span><span>{v}</span></div>)}
      </div>
    </>
  );
}

function TransformControls({ clip, set }: { clip: MediaClip; set: (p: Partial<MediaClip>) => void }) {
  const playhead = useEditor((s) => s.playhead);
  const fps = useEditor((s) => s.project.settings.fps);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const t = transformAt(clip, playhead) ?? IDENTITY_TRANSFORM;
  const local = Math.min(clipDuration(clip), Math.max(0, playhead - clip.start));
  const keys = clip.keyframes ?? [];
  const onKey = keys.some((k) => Math.abs(k.t - local) < 0.5 / fps);
  const put = (patch: Partial<typeof t>) => set(transformPatch(clip, playhead, { ...t, ...patch }, fps));
  return (
    <div className="fx-item">
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {PIP_PRESETS.map((p) => (
          <button key={p.label} className="small" onClick={() => set(transformPatch(clip, playhead, p.t, fps))} title={`Picture-in-picture: ${p.label}`}>
            {p.label}
          </button>
        ))}
        <button className="small" onClick={() => set({ transform: undefined, keyframes: undefined })} disabled={!clip.transform && !keys.length}>Reset</button>
      </div>
      <Num label="Scale" value={t.scale * 100} min={5} max={300} step={1} suffix="%" onChange={(v) => put({ scale: v / 100 })} />
      <Num label="Position X" value={t.x * 100} min={-50} max={150} step={1} suffix="%" onChange={(v) => put({ x: v / 100 })} />
      <Num label="Position Y" value={t.y * 100} min={-50} max={150} step={1} suffix="%" onChange={(v) => put({ y: v / 100 })} />
      <Num label="Rotation" value={t.rotation} min={0} max={359} step={1} suffix="°" onChange={(rotation) => put({ rotation })} />
      <Num label="Opacity" value={t.opacity * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => put({ opacity: v / 100 })} />
      <div className="section-title">Keyframes {keys.length ? `(${keys.length})` : ""}</div>
      <div className="row">
        <button
          className={onKey ? "" : "primary"}
          disabled={onKey}
          onClick={() => {
            // First keyframe also anchors the current look at the clip start.
            const seed = keys.length ? keys : upsertKeyframe([], 0, clip.transform ?? IDENTITY_TRANSFORM, fps);
            set({ keyframes: upsertKeyframe(seed, local, t, fps) });
          }}
          title="Add a keyframe at the playhead, then move the playhead and change values to animate"
        >
          ◆ {onKey ? "Keyframe here" : "Add keyframe"}
        </button>
        {keys.length > 0 && <button onClick={() => set({ keyframes: undefined, transform: t })}>Remove all</button>}
      </div>
      {keys.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {keys.map((k) => (
            <span key={k.t} className="kbd" style={{ cursor: "pointer" }} onClick={() => setPlayhead(clip.start + k.t)} title="Jump to keyframe">
              ◆ {k.t.toFixed(2)}s
              <b style={{ marginLeft: 4 }} onClick={(e) => { e.stopPropagation(); const rest = keys.filter((x) => x !== k); set(rest.length ? { keyframes: rest } : { keyframes: undefined, transform: k }); }}>×</b>
            </span>
          ))}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {keys.length ? "Changing a value writes a keyframe at the playhead." : "Tip: drag the clip in the preview to move it, scroll to resize. Add keyframes to animate."}
      </p>
    </div>
  );
}
