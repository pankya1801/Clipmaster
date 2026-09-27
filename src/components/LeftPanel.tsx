import { useState } from "react";
import { CAPTION_TEMPLATES } from "../core/captions";
import { EFFECTS, EffectCategory, TRANSITIONS } from "../core/effects";
import type { MediaClip } from "../core/types";
import { updateClip } from "../core/project";
import { addAssetToTimeline, autoCaptions, autoZoom, errorText, exportSrt, importMedia, importSrt, notify } from "../lib/actions";
import { captionCss } from "../lib/captionStyle";
import { useEditor } from "../store";
import previewImage from "../assets/preview.jpg";

// Effect thumbnails pre-rendered with the real export filters (npm run previews).
const FX_THUMBS = import.meta.glob("../assets/fx/*.jpg", { eager: true, import: "default" }) as Record<string, string>;
const fxThumb = (id: string) => FX_THUMBS[`../assets/fx/${id}.jpg`] ?? previewImage;
import { formatTime } from "./Preview";

type Tab = "media" | "effects" | "transitions" | "captions";

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("media");
  return (
    <div className="panel">
      <div className="tabs">
        {(["media", "effects", "transitions", "captions"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="panel-body" key={tab}>
        {tab === "media" && <MediaTab />}
        {tab === "effects" && <EffectsTab />}
        {tab === "transitions" && <TransitionsTab />}
        {tab === "captions" && <CaptionsTab />}
      </div>
    </div>
  );
}

function MediaTab() {
  const assets = useEditor((s) => s.project.assets);
  const thumbs = useEditor((s) => s.thumbs);
  const list = Object.values(assets);
  return (
    <>
      <button className="primary" onClick={importMedia}>＋ Import media</button>
      {!list.length && <p className="muted small">Videos, photos and music. Drag them onto the timeline, or double-click to append.</p>}
      <div className="grid">
        {list.map((a) => (
          <div
            key={a.id}
            className="card"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-clipmaster-asset", a.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => addAssetToTimeline(a.id)}
            title={`${a.name}\nDouble-click to add to the timeline`}
          >
            <div className="thumb" style={{ backgroundImage: thumbs[a.id] ? `url(${thumbs[a.id]})` : undefined }}>
              {a.kind === "audio" && <span style={{ fontSize: 26 }}>♪</span>}
              {a.kind !== "image" && <span className="badge">{formatTime(a.duration).slice(0, 5)}</span>}
            </div>
            <div className="label">{a.name}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function useSelectedMedia(): MediaClip | undefined {
  return useEditor((s) => {
    const c = s.selected.length === 1 ? s.project.clips[s.selected[0]] : undefined;
    return c?.type === "media" ? c : undefined;
  });
}

const CATEGORY_LABEL: Record<EffectCategory, string> = { color: "Color & grading", stylize: "Stylize", motion: "Motion" };


function EffectsTab() {
  const clip = useSelectedMedia();
  const { commit } = useEditor.getState();
  const apply = (id: string) => {
    if (!clip) return notify("Select a video or image clip first");
    const has = clip.effects.some((e) => e.id === id);
    commit((p) => updateClip(p, clip.id, { effects: has ? clip.effects.filter((e) => e.id !== id) : [...clip.effects, { id, amount: 0.8 }] }));
  };
  const applyAll = (id: string) =>
    commit((p) => {
      let next = p;
      for (const c of Object.values(p.clips)) {
        if (c.type !== "media" || p.assets[c.assetId]?.kind === "audio" || c.effects.some((e) => e.id === id)) continue;
        next = updateClip(next, c.id, { effects: [...c.effects, { id, amount: 0.8 }] });
      }
      return next;
    });
  return (
    <>
      <p className="muted small">{clip ? "Click to toggle an effect on the selected clip. Adjust strength in the Inspector." : "Select a clip on the timeline, then pick effects."}</p>
      {(["color", "stylize", "motion"] as EffectCategory[]).map((cat) => (
        <div key={cat}>
          <div className="section-title">{CATEGORY_LABEL[cat]}</div>
          <div className="grid">
            {EFFECTS.filter((e) => e.category === cat).map((e) => (
              <button
                key={e.id}
                className={`card ${clip?.effects.some((x) => x.id === e.id) ? "active" : ""}`}
                onClick={() => apply(e.id)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  applyAll(e.id);
                  notify(`${e.name} applied to all clips`);
                }}
                title={`${e.name}\nRight-click: apply to all clips`}
              >
                <div className="thumb"><img src={fxThumb(e.id)} alt="" loading="lazy" draggable={false} /></div>
                <div className="label">{e.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TransitionsTab() {
  const clip = useSelectedMedia();
  const { commit } = useEditor.getState();
  const set = (id: string, side: "in" | "out") => {
    if (!clip) return notify("Select a clip first");
    const key = side === "in" ? "transIn" : "transOut";
    const cur = clip[key];
    commit((p) => updateClip(p, clip.id, { [key]: cur?.id === id ? undefined : { id, duration: id === "flash" ? 0.2 : 0.5 } }));
  };
  return (
    <>
      <p className="muted small">In-transitions play at the start of the selected clip; out-transitions at its end. Cross dissolve blends from the previous clip.</p>
      {(["in", "out"] as const).map((side) => (
        <div key={side}>
          <div className="section-title">{side === "in" ? "Transition in" : "Transition out"}</div>
          <div className="grid">
            {TRANSITIONS.filter((t) => t.side === side).map((t) => (
              <button key={t.id} className={`card ${(side === "in" ? clip?.transIn : clip?.transOut)?.id === t.id ? "active" : ""}`} onClick={() => set(t.id, side)}>
                <div className="thumb tr-thumb" title="Hover to preview">
                  <img className="tr-from" src={fxThumb("bw")} alt="" draggable={false} />
                  <img className={`tr-to tr-${t.id}`} src={previewImage} alt="" draggable={false} />
                </div>
                <div className="label">{t.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function CaptionsTab() {
  const captions = useEditor((s) => s.project.captions);
  const settings = useEditor((s) => s.project.captionSettings);
  const { commit } = useEditor.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const setSettings = (patch: Partial<typeof settings>) => commit((p) => ({ ...p, captionSettings: { ...p.captionSettings, ...patch } }));

  return (
    <>
      <div className="row">
        <button
          className="primary grow"
          disabled={!!busy}
          onClick={async () => {
            try {
              const n = await autoCaptions(setBusy);
              notify(`Added ${n} caption words`);
            } catch (e) {
              notify(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy ?? "✨ Auto captions"}
        </button>
      </div>
      <div className="row">
        <button className="grow" onClick={importSrt}>Import SRT</button>
        <button className="grow" onClick={exportSrt} disabled={!captions.length}>Export SRT</button>
        <button onClick={() => commit((p) => ({ ...p, captions: [] }))} disabled={!captions.length}>Clear</button>
      </div>
      <button
        disabled={!captions.length}
        title="Punch-in and push-in zooms on sentence starts, exclamations and key words"
        onClick={() => {
          try {
            notify(autoZoom());
          } catch (e) {
            notify(errorText(e));
          }
        }}
      >
        🎯 Auto zoom on key words
      </button>
      <div className="section-title">Style · {CAPTION_TEMPLATES.length} templates</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {CAPTION_TEMPLATES.map((t) => {
          const { base, active } = captionCss(t, 13);
          return (
            <button key={t.id} className={`card ${settings.templateId === t.id ? "active" : ""}`} onClick={() => setSettings({ templateId: t.id })}>
              <div className="cap-thumb">
                <span style={base}>
                  Make it <span style={["highlight", "highlight-box", "karaoke"].includes(t.animation) ? active : {}}>pop</span>
                </span>
              </div>
              <div className="label">{t.name}</div>
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>Size <b>{Math.round(settings.scale * 100)}%</b></span>
        <input type="range" min={0.5} max={2} step={0.05} value={settings.scale} onChange={(e) => setSettings({ scale: +e.target.value })} />
      </label>
      <label className="field">
        <span>Position <b>{settings.y == null ? "template" : `${Math.round(settings.y * 100)}%`}</b></span>
        <input type="range" min={0.05} max={0.95} step={0.01} value={settings.y ?? 0.86} onChange={(e) => setSettings({ y: +e.target.value })} />
      </label>
      <label className="field">
        <span>Words per line</span>
        <input type="number" min={1} max={12} value={settings.maxWords ?? ""} placeholder="template default" onChange={(e) => setSettings({ maxWords: e.target.value ? +e.target.value : undefined })} />
      </label>
      {captions.length > 0 && <CaptionEditor />}
    </>
  );
}

function CaptionEditor() {
  const captions = useEditor((s) => s.project.captions);
  const { commit, setPlayhead } = useEditor.getState();
  return (
    <div>
      <div className="section-title">Edit words ({captions.length})</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {captions.map((w, i) => (
          <input
            key={i}
            type="text"
            value={w.text}
            style={{ width: Math.max(38, w.text.length * 8 + 16), padding: "2px 5px" }}
            onFocus={() => setPlayhead(w.start)}
            onChange={(e) => {
              const text = e.target.value;
              commit((p) => ({ ...p, captions: p.captions.map((c, j) => (j === i ? { ...c, text } : c)) }));
            }}
          />
        ))}
      </div>
    </div>
  );
}
