import { useState } from "react";
import { CAPTION_TEMPLATES } from "../core/captions";
import { EFFECTS, EffectCategory, TRANSITIONS } from "../core/effects";
import { TEXT_PRESETS } from "../core/textPresets";
import type { MediaClip } from "../core/types";
import { updateClip } from "../core/project";
import { addGenerator, addSticker, addTemplate, addAssetToTimeline, addTextAtPlayhead, autoCaptions, autoZoom, errorText, exportSrt, importMedia, importSrt, notify } from "../lib/actions";
import { captionCss } from "../lib/captionStyle";
import { useEditor } from "../store";
import { GENERATORS, INTROS, STICKERS } from "../core/visuals";
import { stickerThumb } from "../lib/stickers";
import previewImage from "../assets/preview.jpg";
import { SOUNDS } from "../core/audiolib";
import type { ShareTemplate } from "../core/sharing";
import { addMarkerAtPlayhead, addSound, clearMarkers, deleteWords, detectBeatMarkers, openTemplate, saveAsTemplate, textToSpeech, applyShareTemplate } from "../lib/pro";

// Effect thumbnails pre-rendered with the real export filters (npm run previews).
const FX_THUMBS = import.meta.glob("../assets/fx/*.jpg", { eager: true, import: "default" }) as Record<string, string>;
const fxThumb = (id: string) => FX_THUMBS[`../assets/fx/${id}.jpg`] ?? previewImage;
import { formatTime } from "./Preview";

type Tab = "media" | "audio" | "text" | "elements" | "effects" | "transitions" | "captions";

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("media");
  return (
    <div className="panel">
      <div className="tabs">
        {(["media", "audio", "text", "elements", "effects", "transitions", "captions"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="panel-body" key={tab}>
        {tab === "media" && <MediaTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "text" && <TextTab />}
        {tab === "elements" && <ElementsTab />}
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
      <TemplatesBox />
    </>
  );
}

/** Run an async action with a busy label; show the result as a toast. */
function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, fn: (progress: (m: string) => void) => Promise<string> | string) => {
    setBusy(label);
    try {
      const msg = await fn(setBusy);
      if (msg) notify(msg);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function TemplatesBox() {
  const assets = useEditor((s) => s.project.assets);
  const [tpl, setTpl] = useState<ShareTemplate | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const { busy, run } = useRunner();
  return (
    <>
      <div className="section-title">Templates</div>
      <p className="muted small">Save this edit's cuts, effects, text and timing as a shareable file — then reuse it with new clips.</p>
      <div className="row">
        <button className="grow" disabled={!!busy} onClick={() => run("Saving…", saveAsTemplate)}>💾 Save as template</button>
        <button className="grow" disabled={!!busy} onClick={() => run("", async () => { const t = await openTemplate(); if (t) { setTpl(t); setPicks({}); } return ""; })}>📂 Use template</button>
      </div>
      {tpl && (
        <div className="fx-item">
          <b>{tpl.name}</b>
          {tpl.slots.map((slot) => (
            <label key={slot.id} className="field">
              <span>{slot.label} <b>{slot.needs ? `${slot.needs.toFixed(1)}s` : ""}</b></span>
              <select value={picks[slot.id] ?? ""} onChange={(e) => setPicks({ ...picks, [slot.id]: e.target.value })}>
                <option value="">— pick {slot.kind} —</option>
                {Object.values(assets).filter((a) => a.kind === slot.kind && !a.id.startsWith("stk_")).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ))}
          <div className="row">
            <button onClick={() => setTpl(null)}>Cancel</button>
            <button className="primary grow" onClick={() => run("", () => { const m = applyShareTemplate(tpl, picks); setTpl(null); return m; })}>Apply template</button>
          </div>
        </div>
      )}
    </>
  );
}

function AudioTab() {
  const markers = useEditor((s) => s.project.markers ?? []);
  const { busy, run } = useRunner();
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(175);
  return (
    <>
      <div className="section-title">Text to speech</div>
      <textarea rows={3} placeholder="Type a voiceover…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <input className="grow" placeholder="Voice (optional, e.g. Samantha)" value={voice} onChange={(e) => setVoice(e.target.value)} />
      </div>
      <label className="field">
        <span>Speed<b>{rate} wpm</b></span>
        <input type="range" min={110} max={260} step={5} value={rate} onChange={(e) => setRate(+e.target.value)} />
      </label>
      <button className="primary" disabled={!!busy || !text.trim()} onClick={() => run("Speaking…", () => textToSpeech(text, voice, rate))}>
        {busy === "Speaking…" ? busy : "🗣 Add voiceover"}
      </button>
      <p className="muted small">Uses your computer's built-in voices (offline).</p>
      <div className="section-title">Beat markers · {markers.length}</div>
      <div className="row">
        <button className="grow" disabled={!!busy} onClick={() => run("Listening…", detectBeatMarkers)} title="Mark every beat of the music track; clips snap to the markers">🥁 Mark beats</button>
        <button onClick={addMarkerAtPlayhead} title="Add a marker at the playhead (M)">＋</button>
        <button onClick={clearMarkers} disabled={!markers.length}>Clear</button>
      </div>
      {(["sfx", "music"] as const).map((cat) => (
        <div key={cat}>
          <div className="section-title">{cat === "sfx" ? "Sound effects" : "Royalty-free beats"}</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {SOUNDS.filter((x) => x.category === cat).map((x) => (
              <button key={x.id} className="card" disabled={!!busy} onClick={() => run("Adding…", () => addSound(x.id))} title="Add at the playhead">
                <div className="thumb" style={{ height: 34 }}><span>{cat === "sfx" ? "🔊" : "🎵"}</span><span className="badge">{x.duration.toFixed(1)}s</span></div>
                <div className="label">{x.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Text-based editing: click words to select, delete to cut the video. */
function Transcript() {
  const captions = useEditor((s) => s.project.captions);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const { run } = useRunner();
  if (!captions.length) return null;
  const click = (i: number, shift: boolean) => {
    if (shift && anchor != null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSel(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)));
    } else {
      const next = new Set(sel);
      next.has(i) ? next.delete(i) : next.add(i);
      setSel(next);
      setAnchor(i);
    }
  };
  return (
    <>
      <div className="section-title">Edit by text</div>
      <p className="muted small">Click words (shift-click for a range), then cut them — the video is cut too. Double-click a word to jump there.</p>
      <div className="transcript">
        {captions.map((w, i) => (
          <span key={i} className={sel.has(i) ? "w sel" : "w"} onClick={(e) => click(i, e.shiftKey)} onDoubleClick={() => useEditor.getState().setPlayhead(w.start)}>
            {w.text}{" "}
          </span>
        ))}
      </div>
      <div className="row">
        <button className="grow" disabled={!sel.size} onClick={() => run("", async () => { const m = await deleteWords([...sel]); setSel(new Set()); return m; })}>✂ Cut {sel.size || ""} selected word{sel.size === 1 ? "" : "s"}</button>
        <button disabled={!sel.size} onClick={() => setSel(new Set())}>Clear</button>
      </div>
    </>
  );
}

function TextTab() {
  const categories = [...new Set(TEXT_PRESETS.map((p) => p.category))];
  return (
    <>
      <p className="muted small">Animated titles and lower thirds. Click to add at the playhead, then edit the text in the Inspector. Use a new line for a subtitle.</p>
      <button onClick={() => addTextAtPlayhead()}>T Plain text</button>
      {categories.map((cat) => (
        <div key={cat}>
          <div className="section-title">{cat}</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {TEXT_PRESETS.filter((p) => p.category === cat).map((p) => (
              <button key={p.id} className="card" onClick={() => addTextAtPlayhead(undefined, p.id)} title={`Add “${p.name}” at the playhead`}>
                <div className="thumb"><img src={fxThumb(`text-${p.id}`)} alt="" loading="lazy" draggable={false} /></div>
                <div className="label">{p.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ElementsTab() {
  const run = (f: () => unknown) => Promise.resolve(f()).catch((e) => notify(errorText(e)));
  return (
    <>
      <p className="muted small">Click to add at the playhead. Everything here is editable on the timeline like any clip.</p>
      <div className="section-title">Intros &amp; outros</div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {INTROS.map((t) => {
          const bg = GENERATORS.find((g) => g.id === t.bg)!;
          const ov = GENERATORS.find((g) => g.id === t.overlay);
          return (
            <button key={t.id} className="card" onClick={() => run(() => addTemplate(t.id))} title={t.kind === "intro" ? "Adds before your video (everything moves later)" : "Adds after your video"}>
              <div className="thumb gen-thumb" style={{ background: bg.css(1) }}>
                {ov && <div className="gen-ov" style={{ background: ov.css(1), ...(ov.style as object) }} />}
                <span className="gen-title">{t.text.split("\n")[0]}</span>
              </div>
              <div className="label">{t.kind === "intro" ? "Intro" : "Outro"} · {t.name}</div>
            </button>
          );
        })}
      </div>
      <div className="section-title">Stickers</div>
      <div className="sticker-grid">
        {STICKERS.map((s) => (
          <button key={s.id} className="sticker" title={`Add ${s.name} (pops in)`} onClick={() => run(() => addSticker(s.id))}>
            {s.emoji ? <span>{s.emoji}</span> : <img src={stickerThumb(s)} alt={s.name} draggable={false} />}
          </button>
        ))}
      </div>
      {(["overlay", "background"] as const).map((cat) => (
        <div key={cat}>
          <div className="section-title">{cat === "overlay" ? "Overlays" : "Animated backgrounds"}</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {GENERATORS.filter((g) => g.category === cat).map((g) => (
              <button key={g.id} className="card" onClick={() => run(() => addGenerator(g.id))} title={cat === "overlay" ? "Adds on top of your video" : "Adds under your clips (for titles and text-only clips)"}>
                <div className="thumb gen-thumb" style={{ background: cat === "overlay" ? "#445566" : g.css(1) }}>
                  {cat === "overlay" && <div className="gen-ov" style={{ background: g.css(1.2), ...(g.style as object) }} />}
                </div>
                <div className="label">{g.name}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
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
        disabled={!!busy}
        title="Transcribe any language and caption it in English (uses a multilingual model)"
        onClick={async () => {
          try {
            const n = await autoCaptions(setBusy, undefined, true);
            notify(`Added ${n} English caption words`);
          } catch (e) {
            notify(errorText(e));
          } finally {
            setBusy(null);
          }
        }}
      >
        🌐 Auto captions translated to English
      </button>
      <Transcript />
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
