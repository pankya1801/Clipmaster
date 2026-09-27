import { useEffect, useState } from "react";
import { AutoEditDialog, ExportDialog, SettingsDialog, ShortcutsDialog } from "./components/Dialogs";
import { Inspector } from "./components/Inspector";
import { LeftPanel } from "./components/LeftPanel";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { projectDuration } from "./core/project";
import {
  addTextAtPlayhead, deleteSelected, duplicateSelected, importMedia, migrate, newProject, openProject, saveProject, splitAtPlayhead,
} from "./lib/actions";
import { ffmpegStatus, isTauri, thumbnail } from "./lib/backend";
import { useEditor } from "./store";

const AUTOSAVE_KEY = "cm.autosave";

export default function App() {
  const [dialog, setDialog] = useState<"export" | "auto" | "settings" | "shortcuts" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ffmpegMissing, setFfmpegMissing] = useState(false);
  const [tlHeight, setTlHeight] = useState(300);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const dirty = useEditor((s) => s.dirty);
  const name = useEditor((s) => s.project.name);
  const hasClips = useEditor((s) => projectDuration(s.project) > 0);

  useEffect(() => {
    let timer: number | undefined;
    const onToast = (e: Event) => {
      setToast((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 3500);
    };
    window.addEventListener("cm-toast", onToast);
    return () => window.removeEventListener("cm-toast", onToast);
  }, []);

  useEffect(() => {
    if (isTauri) ffmpegStatus().then((s) => setFfmpegMissing(!s.ffmpeg || !s.ffprobe));
  }, []);

  // Crash recovery: autosave to local storage (desktop only; browser blob URLs don't survive reloads).
  useEffect(() => {
    if (!isTauri) return;
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        const { project, path } = JSON.parse(saved);
        if (Object.keys(project.clips ?? {}).length && confirm("Restore your last unsaved session?")) {
          const p = migrate(project);
          useEditor.getState().load(p, path);
          for (const a of Object.values(p.assets)) thumbnail(a.path, a.kind, Math.min(1, a.duration / 2)).then((u) => useEditor.getState().setThumb(a.id, u));
        }
      }
    } catch {
      /* ignore corrupt autosave */
    }
    let t: number | undefined;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project: s.project, path: s.projectPath }));
        } catch {
          /* storage full */
        }
      }, 800);
    });
    return unsub;
  }, []);

  useEffect(() => {
    document.title = `${dirty ? "● " : ""}${name} — Clipmaster`;
  }, [dirty, name]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const frame = 1 / s.project.settings.fps;
      const handled = () => e.preventDefault();
      if (mod && key === "z") (e.shiftKey ? s.redo() : s.undo(), handled());
      else if (mod && key === "y") (s.redo(), handled());
      else if (mod && key === "s") (saveProject(e.shiftKey), handled());
      else if (mod && key === "o") (openProject(), handled());
      else if (mod && key === "i") (importMedia(), handled());
      else if (mod && key === "e") (setDialog("export"), handled());
      else if (mod && key === "d") (duplicateSelected(), handled());
      else if (mod && key === "a") (s.select(Object.keys(s.project.clips)), handled());
      else if (mod) return;
      else if (key === " ") (s.setPlaying(!s.playing), handled());
      else if (key === "s") splitAtPlayhead();
      else if (key === "t") addTextAtPlayhead();
      else if (key === "delete" || key === "backspace") (deleteSelected(e.shiftKey), handled());
      else if (key === "arrowleft") (s.setPlayhead(s.playhead - (e.shiftKey ? 1 : frame)), handled());
      else if (key === "arrowright") (s.setPlayhead(s.playhead + (e.shiftKey ? 1 : frame)), handled());
      else if (key === "home") s.setPlayhead(0);
      else if (key === "end") s.setPlayhead(projectDuration(s.project));
      else if (key === "=" || key === "+") s.setZoom(s.zoom * 1.25);
      else if (key === "-") s.setZoom(s.zoom * 0.8);
      else if (key === "escape") s.select([]);
      else if (key === "?") (setDialog("shortcuts"), handled());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startH = tlHeight;
    const move = (ev: PointerEvent) => setTlHeight(Math.min(window.innerHeight - 250, Math.max(160, startH - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="app" style={{ ["--tl-h" as any]: `${tlHeight}px` }}>
      <div className="toolbar">
        <div className="brand"><div className="brand-logo">▶</div>Clipmaster</div>
        <button className="ghost" onClick={newProject}>New</button>
        <button className="ghost" onClick={openProject} disabled={!isTauri}>Open</button>
        <button className="ghost" onClick={() => saveProject()}>Save</button>
        <div className="sep" />
        <button className="ghost icon" onClick={() => useEditor.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
        <button className="ghost icon" onClick={() => useEditor.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <div className="sep" />
        <button onClick={importMedia}>＋ Import</button>
        <span className="grow" />
        <span className="muted small">{name}{dirty ? " •" : ""}</span>
        <button className="ghost" onClick={() => setDialog("shortcuts")} title="Keyboard shortcuts (?)">?</button>
        <button className="ghost" onClick={() => setDialog("settings")}>⚙ Settings</button>
        <button onClick={() => setDialog("auto")} disabled={!hasClips}>✨ Auto Edit</button>
        <button className="primary" onClick={() => setDialog("export")} disabled={!hasClips}>Export</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {ffmpegMissing && (
          <div className="banner">FFmpeg was not found. Install it (see README) or place ffmpeg and ffprobe next to Clipmaster to import and export media.</div>
        )}
        {!isTauri && <div className="banner">Browser preview mode: you can try editing, but import is temporary and export needs the desktop app.</div>}
        <div className="main" style={{ flex: 1 }}>
          <LeftPanel />
          <Preview />
          <Inspector />
        </div>
      </div>
      <div className="resizer" onPointerDown={startResize} />
      <Timeline />
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "auto" && <AutoEditDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
