import { create } from "zustand";
import { createProject } from "./core/project";
import type { Project } from "./core/types";

const HISTORY_LIMIT = 200;

interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  selected: string[];
  playhead: number;
  playing: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  thumbs: Record<string, string | undefined>;
  projectPath: string | null;
  dirty: boolean;

  /** Apply an undoable change. */
  commit: (fn: (p: Project) => Project) => void;
  /** Replace without recording history (e.g. live drag preview). */
  replace: (p: Project) => void;
  /** Push a snapshot so a drag gesture becomes one undo step. */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, path: string | null) => void;
  select: (ids: string[]) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (v: boolean) => void;
  setZoom: (z: number) => void;
  setThumb: (assetId: string, url?: string) => void;
  markSaved: (path: string) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  selected: [],
  playhead: 0,
  playing: false,
  zoom: 60,
  thumbs: {},
  projectPath: null,
  dirty: false,

  commit: (fn) => {
    const { project, past } = get();
    const next = fn(project);
    if (next === project) return;
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
  },
  replace: (p) => set({ project: p, dirty: true }),
  checkpoint: () => {
    const { project, past } = get();
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), dirty: true });
  },
  load: (p, path) => set({ project: p, past: [], future: [], selected: [], playhead: 0, projectPath: path, dirty: false }),
  select: (ids) => set({ selected: ids }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (v) => set({ playing: v }),
  setZoom: (z) => set({ zoom: Math.min(400, Math.max(8, z)) }),
  setThumb: (id, url) => set((s) => ({ thumbs: { ...s.thumbs, [id]: url } })),
  markSaved: (path) => set({ projectPath: path, dirty: false }),
}));

// Exposed for end-to-end tests and debugging in development builds.
if (import.meta.env.DEV && typeof window !== "undefined") (window as any).__clipmaster = useEditor;
