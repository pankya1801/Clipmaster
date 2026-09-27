import { useEffect, useState } from "react";
import { DEFAULT_AUTO_EDIT } from "../core/autoedit";
import { EFFECTS } from "../core/effects";
import { buildExportPlan, ExportQuality } from "../core/ffmpeg";
import { projectDuration } from "../core/project";
import { errorText, loadWhisperConfig, runAutoEdit, runBeatSync, saveWhisperConfig, WhisperModel } from "../lib/actions";
import { invoke, isTauri, saveDialog } from "../lib/backend";
import { useEditor } from "../store";
import { SHORTCUTS } from "./shortcuts";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row"><h2 className="grow">{title}</h2><button className="ghost icon" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}

const RESOLUTIONS = [
  { label: "Project size", scale: 0 },
  { label: "720p", scale: 720 },
  { label: "1080p", scale: 1080 },
  { label: "1440p", scale: 1440 },
  { label: "4K (2160p)", scale: 2160 },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [quality, setQuality] = useState<ExportQuality>("standard");
  const [res, setRes] = useState(0);
  const [loudness, setLoudness] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const total = projectDuration(project);

  const size = (() => {
    const { width, height } = project.settings;
    if (!res) return { width, height };
    const short = Math.min(width, height);
    const k = res / short;
    const even = (v: number) => Math.round((v * k) / 2) * 2;
    return { width: even(width), height: even(height) };
  })();

  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ seconds: number }>("export-progress", (e) => setProgress(Math.min(1, e.payload.seconds / Math.max(0.01, total)))).then((u) => (un = u))
    );
    return () => un?.();
  }, [total]);

  const start = async () => {
    const out = await saveDialog(`${project.name}.mp4`, "mp4", "MP4 video");
    if (!out) return;
    try {
      setStatus("Exporting…");
      setProgress(0);
      const [tempDir, fontsDir] = await Promise.all([invoke<string>("temp_dir"), invoke<string | null>("fonts_dir")]);
      const fontFile = fontsDir ? `${fontsDir}/Montserrat-ExtraBold.ttf` : undefined;
      const plan = buildExportPlan(project, { outputPath: out, tempDir, quality, fontsDir: fontsDir ?? undefined, fontFile, normalizeLoudness: loudness, ...size });
      await invoke("export_video", { args: plan.args, files: plan.files });
      setProgress(1);
      setStatus(`Saved to ${out}`);
    } catch (e) {
      setProgress(null);
      setStatus(`Export failed: ${errorText(e)}`);
    }
  };

  const running = progress != null && progress < 1 && status === "Exporting…";
  return (
    <Modal title="Export video" onClose={() => !running && onClose()}>
      {!isTauri && <p className="banner">Export needs the Clipmaster desktop app (it uses FFmpeg on your computer).</p>}
      <div className="row">
        <label className="field grow">
          <span>Resolution</span>
          <select value={res} onChange={(e) => setRes(+e.target.value)} disabled={running}>
            {RESOLUTIONS.map((r) => <option key={r.label} value={r.scale}>{r.label}</option>)}
          </select>
        </label>
        <label className="field grow">
          <span>Quality</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={running}>
            <option value="draft">Draft (fast)</option>
            <option value="standard">Standard</option>
            <option value="high">High (slow)</option>
          </select>
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={loudness} onChange={(e) => setLoudness(e.target.checked)} disabled={running} /> Normalise loudness for social media (−14 LUFS)</label>
      <p className="muted small">MP4 (H.264 + AAC) · {size.width}×{size.height} · {project.settings.fps} fps · {total.toFixed(1)}s · no watermark</p>
      {progress != null && <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {status && <p className="small" style={{ userSelect: "text", whiteSpace: "pre-wrap" }}>{status}</p>}
      <div className="row">
        <span className="grow" />
        {running ? (
          <button onClick={() => invoke("cancel_export")}>Cancel</button>
        ) : (
          <>
            <button onClick={onClose}>Close</button>
            <button className="primary" onClick={start} disabled={!isTauri || total <= 0}>Export</button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function AutoEditDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"talk" | "music">("talk");
  const [beat, setBeat] = useState({ everyBeats: 2, muteClips: true, punchIn: true, flash: false });
  const [opts, setOpts] = useState({ ...DEFAULT_AUTO_EDIT, captions: true, noiseDb: -35, minSilence: 0.45, duck: true, autoZoom: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const set = (patch: Partial<typeof opts>) => setOpts((o) => ({ ...o, ...patch }));
  const colorLooks = EFFECTS.filter((e) => e.category === "color");

  return (
    <Modal title="✨ Auto Edit" onClose={() => !busy && onClose()}>
      <div className="tabs" style={{ margin: "-4px 0 0" }}>
        <button className={mode === "talk" ? "active" : ""} onClick={() => setMode("talk")}>🎙 Talking video</button>
        <button className={mode === "music" ? "active" : ""} onClick={() => setMode("music")}>🎵 Music montage</button>
      </div>
      {mode === "music" ? (
        <>
          <p className="muted small">Put your clips/photos on the video track and a song on an audio track. Clipmaster finds the beat and cuts your footage to it. One undo step (Ctrl+Z).</p>
          <label className="field"><span>Cut every</span>
            <select value={beat.everyBeats} onChange={(e) => setBeat({ ...beat, everyBeats: +e.target.value })}>
              <option value={1}>1 beat (fast, energetic)</option>
              <option value={2}>2 beats</option>
              <option value={4}>4 beats / one bar (calm)</option>
            </select></label>
          <label className="check"><input type="checkbox" checked={beat.muteClips} onChange={(e) => setBeat({ ...beat, muteClips: e.target.checked })} /> Mute the clips' own sound (music only)</label>
          <label className="check"><input type="checkbox" checked={beat.punchIn} onChange={(e) => setBeat({ ...beat, punchIn: e.target.checked })} /> Punch-in zoom on every other shot</label>
          <label className="check"><input type="checkbox" checked={beat.flash} onChange={(e) => setBeat({ ...beat, flash: e.target.checked })} /> Flash on each cut</label>
        </>
      ) : (<>
      <p className="muted small">Turns raw talking footage into a tight edit: cuts out pauses, hides jump cuts with punch-in zooms, adds captions and a colour look. Everything is one undo step (Ctrl+Z).</p>
      <label className="check"><input type="checkbox" checked={opts.removeSilence} onChange={(e) => set({ removeSilence: e.target.checked })} /> Remove silences and pauses</label>
      {opts.removeSilence && (
        <div className="row" style={{ paddingLeft: 22 }}>
          <label className="field grow"><span>Silence threshold <b>{opts.noiseDb} dB</b></span>
            <input type="range" min={-60} max={-20} value={opts.noiseDb} onChange={(e) => set({ noiseDb: +e.target.value })} /></label>
          <label className="field grow"><span>Min pause <b>{opts.minSilence}s</b></span>
            <input type="range" min={0.2} max={2} step={0.05} value={opts.minSilence} onChange={(e) => set({ minSilence: +e.target.value })} /></label>
        </div>
      )}
      <label className="check"><input type="checkbox" checked={opts.autoZoom} disabled={!opts.captions} onChange={(e) => set({ autoZoom: e.target.checked })} /> Auto zoom on key words (uses captions)</label>
      <label className="check"><input type="checkbox" checked={opts.duck} onChange={(e) => set({ duck: e.target.checked })} /> Duck background music under speech</label>
      <label className="check"><input type="checkbox" checked={opts.punchIn} onChange={(e) => set({ punchIn: e.target.checked })} /> Punch-in zoom on every other cut</label>
      <label className="check"><input type="checkbox" checked={opts.captions} onChange={(e) => set({ captions: e.target.checked })} /> Auto captions (download a model once in Settings)</label>
      <div className="row">
        <label className="field grow"><span>Transition at cuts</span>
          <select value={opts.transition} onChange={(e) => set({ transition: e.target.value as typeof opts.transition })}>
            <option value="none">None (jump cut)</option>
            <option value="flash">Flash</option>
            <option value="fade-in">Fade</option>
            <option value="zoom-pop">Zoom pop</option>
          </select></label>
        <label className="field grow"><span>Colour look</span>
          <select value={opts.look ?? ""} onChange={(e) => set({ look: e.target.value || null })}>
            <option value="">None</option>
            {colorLooks.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select></label>
      </div>
      </>)}
      {result && <p className="small">{result}</p>}
      <div className="row">
        <span className="grow" />
        <button onClick={onClose} disabled={!!busy}>Close</button>
        <button
          className="primary"
          disabled={!!busy}
          onClick={async () => {
            setResult(null);
            try {
              setResult(mode === "music" ? await runBeatSync(beat, setBusy) : await runAutoEdit(opts, setBusy));
            } catch (e) {
              setResult(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy ?? "Run Auto Edit"}
        </button>
      </div>
    </Modal>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState(loadWhisperConfig());
  const [ffmpeg, setFfmpeg] = useState<string>("checking…");
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [downloading, setDownloading] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(!!(cfg.bin || cfg.model));

  const refresh = () => isTauri && invoke<WhisperModel[]>("whisper_models").then(setModels).catch(() => {});
  useEffect(() => {
    if (!isTauri) return setFfmpeg("desktop app only");
    invoke<{ ffmpeg?: string }>("ffmpeg_status").then((s) => setFfmpeg(s.ffmpeg ?? "not found"));
    refresh();
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ received: number; total: number }>("model-progress", (e) =>
        setDownloading((d) => (d ? { ...d, pct: e.payload.total ? e.payload.received / e.payload.total : 0 } : d))
      ).then((u) => (un = u))
    );
    return () => un?.();
  }, []);

  const download = async (name: string) => {
    setError(null);
    setDownloading({ name, pct: 0 });
    try {
      await invoke("download_model", { name });
      setCfg((c) => ({ ...c, modelName: name }));
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDownloading(null);
    }
  };

  const pick = async (key: "bin" | "model") => {
    if (!isTauri) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, filters: key === "model" ? [{ name: "Whisper model", extensions: ["bin"] }] : undefined });
    if (typeof r === "string") setCfg((c) => ({ ...c, [key]: r }));
  };
  return (
    <Modal title="Settings" onClose={onClose}>
      <div><b>FFmpeg</b><div className="muted small" style={{ userSelect: "text" }}>{ffmpeg}</div></div>
      <div className="section-title">Auto captions</div>
      <p className="muted small" style={{ margin: 0 }}>Speech is transcribed on your computer with whisper.cpp. Your audio never leaves your device. Download one model once:</p>
      <div style={{ display: "grid", gap: 6 }}>
        {models.map((m) => (
          <div key={m.name} className="fx-item">
            <div className="row">
              <label className="check grow">
                <input type="radio" name="model" disabled={!m.path} checked={!!m.path && cfg.modelName === m.name && !cfg.model} onChange={() => setCfg({ ...cfg, modelName: m.name, model: "" })} />
                {m.label} <span className="muted small">{m.size_mb} MB</span>
              </label>
              {m.path ? <span className="small" style={{ color: "var(--audio)" }}>✓ Ready</span> : (
                <button className="small" disabled={!!downloading} onClick={() => download(m.name)}>
                  {downloading?.name === m.name ? `${Math.round(downloading.pct * 100)}%` : "Download"}
                </button>
              )}
            </div>
            {downloading?.name === m.name && <div className="progress"><div style={{ width: `${Math.round(downloading.pct * 100)}%` }} /></div>}
          </div>
        ))}
        {!isTauri && <p className="small muted">Available in the desktop app.</p>}
      </div>
      {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
      <label className="field"><span>Spoken language</span>
        <select value={cfg.language} onChange={(e) => setCfg({ ...cfg, language: e.target.value })}>
          {[["auto", "Detect automatically"], ["en", "English"], ["hi", "Hindi"], ["es", "Spanish"], ["pt", "Portuguese"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["id", "Indonesian"], ["tr", "Turkish"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"], ["ru", "Russian"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <p className="muted small" style={{ margin: 0 }}>English-only models (".en") are faster; use a 99-language model for other languages.</p>
      <label className="check"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Advanced: use my own whisper.cpp / model</label>
      {advanced && (
        <>
          <label className="field"><span>whisper-cli program (blank = built-in)</span>
            <div className="row"><input type="text" value={cfg.bin} onChange={(e) => setCfg({ ...cfg, bin: e.target.value })} placeholder="built-in" /><button onClick={() => pick("bin")}>Browse</button></div></label>
          <label className="field"><span>Model file (blank = downloaded model above)</span>
            <div className="row"><input type="text" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="downloaded model" /><button onClick={() => pick("model")}>Browse</button></div></label>
        </>
      )}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { saveWhisperConfig(cfg); onClose(); }}>Save</button></div>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="small muted" style={{ display: "grid", gap: 4 }}>
        {SHORTCUTS.map(([k, v]) => <div key={k} className="row"><span className="kbd">{k}</span><span>{v}</span></div>)}
      </div>
      <div className="row"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
