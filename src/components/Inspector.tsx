import { effectById, transitionById, TRANSITIONS } from "../core/effects";
import { clipDuration, updateClip } from "../core/project";
import { ASPECT_PRESETS, MediaClip, TextClip } from "../core/types";
import { useEditor } from "../store";
import { formatTime } from "./Preview";

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
        </>
      )}
      {visual && (
        <>
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
        <span>Text</span>
        <textarea rows={3} value={clip.text} onChange={(e) => set({ text: e.target.value })} />
      </label>
      <Num label="Duration" value={clip.duration} min={0.2} max={30} suffix="s" onChange={(duration) => set({ duration })} />
      <Num label="Font size" value={clip.fontSize} min={12} max={Math.round(H / 4)} step={1} suffix="px" onChange={(fontSize) => set({ fontSize })} />
      <Num label="Horizontal" value={clip.x * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ x: v / 100 })} />
      <Num label="Vertical" value={clip.y * 100} min={0} max={100} step={1} suffix="%" onChange={(v) => set({ y: v / 100 })} />
      <div className="row">
        <label className="check"><input type="color" value={clip.color} onChange={(e) => set({ color: e.target.value })} /> Colour</label>
        <label className="check"><input type="checkbox" checked={clip.box} onChange={(e) => set({ box: e.target.checked })} /> Background box</label>
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
      <div className="section-title">Shortcuts</div>
      <div className="small muted" style={{ display: "grid", gap: 4 }}>
        {[
          ["Space", "Play / pause"], ["S", "Split at playhead"], ["Del", "Delete"], ["Shift+Del", "Ripple delete"],
          ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Ctrl+D", "Duplicate"], ["T", "Add text"], ["← / →", "Step one frame"],
          ["Ctrl+S", "Save"], ["Ctrl+I", "Import"], ["Ctrl+E", "Export"], ["Ctrl+scroll", "Zoom timeline"],
        ].map(([k, v]) => <div key={k} className="row"><span className="kbd">{k}</span><span>{v}</span></div>)}
      </div>
    </>
  );
}
