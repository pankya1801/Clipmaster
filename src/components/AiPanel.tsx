import { useEffect, useRef, useState } from "react";
import { ClipIdea, ELEVEN_VOICES, imageProvider, LANGUAGES, llmProvider, OPENAI_VOICES, PublishKit, voiceProviders, VoiceProvider } from "../core/ai";
import { THUMB_LAYOUTS, ThumbLayout } from "../core/thumbnail";
import { aiVoiceover, dubProject, findViralClips, generateImage, ImageUse, loadAiKeys, makeShortFrom, publishKit } from "../lib/ai";
import { applyBrand, BRAND_FONTS, BrandKit, Corner, loadBrand, pickLogo, saveBrand } from "../lib/brand";
import { errorText, notify } from "../lib/actions";
import { composeThumbnail, grabFrame, saveThumbnail, subjectMask, ThumbOptions } from "../lib/thumbnail";
import { Modal } from "./Dialogs";
import { formatTime } from "./Preview";

function useRunner() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, fn: (progress: (m: string) => void) => Promise<string | void> | string | void) => {
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

const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => notify("Copied"), () => notify(text));

export function AiTab() {
  const keys = loadAiKeys();
  const llm = !!llmProvider(keys);
  const img = !!imageProvider(keys);
  const voices = voiceProviders(keys);
  const [thumb, setThumb] = useState(false);
  return (
    <>
      {!llm && !img && !voices.length && (
        <p className="banner small">Add your own OpenAI, Anthropic, OpenRouter, fal.ai or ElevenLabs key in <b>Settings → AI</b> to unlock these. The thumbnail maker and brand kit work without keys.</p>
      )}
      <ViralBox enabled={llm} />
      <ImageBox enabled={img} />
      <VoiceBox providers={voices} llm={llm} />
      <PublishBox enabled={llm} />
      <div className="section-title">Thumbnail</div>
      <button onClick={() => setThumb(true)}>🖼 Make a thumbnail</button>
      <BrandBox />
      {thumb && <ThumbnailDialog onClose={() => setThumb(false)} />}
    </>
  );
}

function ViralBox({ enabled }: { enabled: boolean }) {
  const { busy, run } = useRunner();
  const [ideas, setIdeas] = useState<ClipIdea[]>([]);
  return (
    <>
      <div className="section-title">🔥 Viral clip finder</div>
      <p className="muted small">AI reads your transcript and picks the best moments for Shorts, with a hook and a score.</p>
      <button className="primary" disabled={!enabled || !!busy} onClick={() => run("Finding clips…", async (pr) => { setIdeas(await findViralClips(pr)); })}>
        {busy ?? "Find the best clips"}
      </button>
      {ideas.map((x, i) => (
        <div key={i} className="fx-item">
          <div className="row"><b className="grow">{x.title}</b><span className="kbd">{x.score}</span></div>
          <div className="small muted">{formatTime(x.start)}–{formatTime(x.end)} · {Math.round(x.end - x.start)}s · “{x.hook}”</div>
          <div className="small">{x.reason}</div>
          <button className="small" disabled={!!busy} onClick={() => run("Making the Short…", (pr) => makeShortFrom(x, pr))} title="Keeps only this part, makes it vertical and adds the hook (undo to go back)">✂ Make this Short</button>
        </div>
      ))}
    </>
  );
}

function ImageBox({ enabled }: { enabled: boolean }) {
  const { busy, run } = useRunner();
  const [prompt, setPrompt] = useState("");
  const [use, setUse] = useState<ImageUse>("broll");
  return (
    <>
      <div className="section-title">🎨 AI image</div>
      <textarea rows={2} placeholder="A neon city street at night, rain, cinematic" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {([["broll", "B-roll"], ["background", "Background"], ["sticker", "Sticker"], ["library", "Media only"]] as [ImageUse, string][]).map(([id, label]) => (
          <button key={id} className={use === id ? "small primary" : "small"} onClick={() => setUse(id)}>{label}</button>
        ))}
      </div>
      <button disabled={!enabled || !!busy || !prompt.trim()} onClick={() => run("Generating…", (pr) => generateImage(prompt, use, pr))}>{busy ?? "Generate"}</button>
    </>
  );
}

function VoiceBox({ providers, llm }: { providers: VoiceProvider[]; llm: boolean }) {
  const { busy, run } = useRunner();
  const [provider, setProvider] = useState<VoiceProvider>(providers[0] ?? "openai");
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [style, setStyle] = useState("");
  const [lang, setLang] = useState("Spanish");
  const options = provider === "openai" ? OPENAI_VOICES.map((v) => ({ id: v, name: v })) : ELEVEN_VOICES;
  const enabled = providers.length > 0;
  return (
    <>
      <div className="section-title">🗣 AI voice &amp; dubbing</div>
      <div className="row">
        {providers.length > 1 && (
          <select value={provider} onChange={(e) => { setProvider(e.target.value as VoiceProvider); setVoice(""); }}>
            {providers.map((p) => <option key={p} value={p}>{p === "openai" ? "OpenAI" : "ElevenLabs"}</option>)}
          </select>
        )}
        <select className="grow" value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!enabled}>
          <option value="">Default voice</option>
          {options.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <textarea rows={3} placeholder="Type a voiceover…" value={text} onChange={(e) => setText(e.target.value)} />
      {provider === "openai" && <input placeholder="Style (optional): excited, calm narrator…" value={style} onChange={(e) => setStyle(e.target.value)} />}
      <button disabled={!enabled || !!busy || !text.trim()} onClick={() => run("Speaking…", () => aiVoiceover(provider, text, voice, style))}>Add voiceover</button>
      <div className="row">
        <select className="grow" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
        <button disabled={!enabled || !llm || !!busy} title={llm ? "Translate the captions and voice them in another language" : "Needs a text AI key too (OpenAI, Anthropic or OpenRouter)"} onClick={() => run("Dubbing…", (pr) => dubProject(lang, provider, voice, pr))}>
          🌍 Dub video
        </button>
      </div>
      {busy && <p className="small muted">{busy}</p>}
    </>
  );
}

function PublishBox({ enabled }: { enabled: boolean }) {
  const { busy, run } = useRunner();
  const [platform, setPlatform] = useState("YouTube");
  const [kit, setKit] = useState<PublishKit | null>(null);
  return (
    <>
      <div className="section-title">✍ Titles, description &amp; hashtags</div>
      <div className="row">
        <select className="grow" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {["YouTube", "YouTube Shorts", "TikTok", "Instagram Reels", "LinkedIn"].map((p) => <option key={p}>{p}</option>)}
        </select>
        <button disabled={!enabled || !!busy} onClick={() => run("Writing…", async (pr) => { setKit(await publishKit(platform, pr)); })}>{busy ?? "Write"}</button>
      </div>
      {kit && (
        <div className="fx-item small">
          {kit.titles.map((t) => <div key={t} className="row"><span className="grow">{t}</span><button className="ghost icon" title="Copy" onClick={() => copy(t)}>⧉</button></div>)}
          <p style={{ userSelect: "text" }}>{kit.description}</p>
          <p className="muted" style={{ userSelect: "text" }}>{kit.hashtags.map((h) => `#${h}`).join(" ")}</p>
          <div className="row">
            <button className="small grow" onClick={() => copy(`${kit.description}\n\n${kit.hashtags.map((h) => `#${h}`).join(" ")}`)}>Copy description</button>
            {kit.hook && <span className="small muted">Hook: “{kit.hook}”</span>}
          </div>
        </div>
      )}
    </>
  );
}

function BrandBox() {
  const [b, setB] = useState<BrandKit>(loadBrand());
  const { busy, run } = useRunner();
  const set = (patch: Partial<BrandKit>) => {
    const next = { ...b, ...patch };
    setB(next);
    saveBrand(next);
  };
  return (
    <>
      <div className="section-title">🏷 Brand kit</div>
      <div className="row">
        <button className="small grow" onClick={async () => { const p = await pickLogo(); if (p) set({ logoPath: p }); }}>{b.logoPath ? `Logo: ${b.logoPath.split(/[\\/]/).pop()}` : "Choose logo…"}</button>
        {b.logoPath && <button className="small ghost" onClick={() => set({ logoPath: "" })}>×</button>}
      </div>
      {b.logoPath && (
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as Corner[]).map((c) => (
            <button key={c} className={b.logoCorner === c ? "small primary" : "small"} onClick={() => set({ logoCorner: c })}>{c.replace("-", " ")}</button>
          ))}
        </div>
      )}
      <label className="field"><span>Font</span>
        <select value={b.font} onChange={(e) => set({ font: e.target.value })}>{BRAND_FONTS.map((f) => <option key={f}>{f}</option>)}</select>
      </label>
      <div className="row">
        <label className="field grow"><span>Text colour</span><input type="color" value={b.primary} onChange={(e) => set({ primary: e.target.value })} /></label>
        <label className="field grow"><span>Accent</span><input type="color" value={b.accent} onChange={(e) => set({ accent: e.target.value })} /></label>
      </div>
      <button disabled={!!busy} onClick={() => run("Applying…", () => applyBrand(b))}>Apply brand to this video</button>
    </>
  );
}

export function ThumbnailDialog({ onClose }: { onClose: () => void }) {
  const brand = loadBrand();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<HTMLCanvasElement | null>(null);
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const { busy, run } = useRunner();
  const [o, setO] = useState<ThumbOptions>({ text: "", layout: "left", color: "#ffffff", accent: brand.accent === "#8b5cf6" ? "#ffd400" : brand.accent, font: "Bangers", cutout: true, dim: 0.6 });
  const set = (p: Partial<ThumbOptions>) => setO({ ...o, ...p });

  const load = (mode: "best" | "playhead") =>
    run("Loading…", async (pr) => {
      const f = await grabFrame(mode, pr);
      setFrame(f);
      setMask(null);
      if (o.cutout) {
        pr("Cutting out the subject…");
        setMask(await subjectMask(f).catch(() => null));
      }
    });
  useEffect(() => { load("best"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!o.cutout || mask || !frame) return;
    run("Cutting out the subject…", async () => { setMask(await subjectMask(frame)); });
  }, [o.cutout]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!frame || !canvas.current) return;
    document.fonts.load(`80px "${o.font}"`).finally(() => composeThumbnail(canvas.current!, frame, o.cutout ? mask : null, o));
  }, [frame, mask, o]);

  return (
    <Modal title="Thumbnail maker" onClose={onClose}>
      <canvas ref={canvas} width={1280} height={720} style={{ width: "100%", borderRadius: 8, background: "#000", aspectRatio: "16 / 9" }} />
      {busy && <p className="small muted">{busy}</p>}
      <div className="row">
        <button disabled={!!busy} onClick={() => load("best")}>✨ Best frame</button>
        <button disabled={!!busy} onClick={() => load("playhead")}>Frame at playhead</button>
      </div>
      <input placeholder="Big thumbnail text (e.g. I QUIT MY JOB)" value={o.text} onChange={(e) => set({ text: e.target.value })} />
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {THUMB_LAYOUTS.map((l) => <button key={l.id} className={o.layout === l.id ? "small primary" : "small"} onClick={() => set({ layout: l.id as ThumbLayout })}>{l.name}</button>)}
      </div>
      <div className="row">
        <label className="field grow"><span>Font</span><select value={o.font} onChange={(e) => set({ font: e.target.value })}>{BRAND_FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="field"><span>Text</span><input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} /></label>
        <label className="field"><span>Accent</span><input type="color" value={o.accent} onChange={(e) => set({ accent: e.target.value })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={o.cutout} onChange={(e) => set({ cutout: e.target.checked })} /> Pop out the person (cut-out with outline)</label>
      {o.cutout && (
        <label className="field"><span>Background dim<b>{Math.round(o.dim * 100)}%</b></span><input type="range" min={0} max={1} step={0.05} value={o.dim} onChange={(e) => set({ dim: +e.target.value })} /></label>
      )}
      <div className="row">
        <span className="grow" />
        <button onClick={onClose}>Close</button>
        <button className="primary" disabled={!frame || !!busy} onClick={() => run("Saving…", () => saveThumbnail(canvas.current!))}>Save PNG</button>
      </div>
    </Modal>
  );
}
