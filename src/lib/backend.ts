/**
 * Bridge to the Rust backend. When running in a plain browser (`npm run dev`
 * without Tauri) a limited fallback lets you try the editor UI: files are
 * opened via <input type=file> and export is disabled.
 */
import type { AssetKind } from "../core/types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ProbeResult {
  kind: AssetKind;
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await core();
  return invoke<T>(cmd, args);
}

/** URL the <video>/<img> elements can load for a local path. */
export function mediaUrl(path: string): string {
  if (!isTauri || path.startsWith("blob:")) return path;
  // Synchronous variant of convertFileSrc (same encoding as @tauri-apps/api).
  const w = window as any;
  if (w.__TAURI_INTERNALS__?.convertFileSrc) return w.__TAURI_INTERNALS__.convertFileSrc(path, "asset");
  return path;
}

export const MEDIA_EXTENSIONS = [
  "mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg", "png", "jpg", "jpeg", "webp", "gif", "bmp",
];

export async function pickMediaFiles(): Promise<{ path: string; name: string }[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple: true, filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }] });
    const paths = Array.isArray(res) ? res : res ? [res] : [];
    return paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p }));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*,image/*";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      resolve(files.map((f) => ({ path: URL.createObjectURL(f), name: f.name, file: f } as any)));
    };
    input.click();
  });
}

export async function probe(path: string, name: string): Promise<ProbeResult> {
  if (isTauri) return invoke<ProbeResult>("probe_media", { path });
  return browserProbe(path, name);
}

function browserProbe(url: string, name: string): Promise<ProbeResult> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res({ kind: "image", duration: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false });
      img.onerror = () => rej(new Error("Unsupported image"));
      img.src = url;
    });
  }
  const isAudio = ["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(ext);
  return new Promise((res, rej) => {
    const el = document.createElement(isAudio ? "audio" : "video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      res({
        kind: isAudio ? "audio" : "video",
        duration: el.duration,
        width: isAudio ? undefined : v.videoWidth,
        height: isAudio ? undefined : v.videoHeight,
        hasAudio: true,
      });
    };
    el.onerror = () => rej(new Error("Unsupported media"));
    el.src = url;
  });
}

export async function thumbnail(path: string, kind: AssetKind, at = 1): Promise<string | undefined> {
  if (kind === "audio") return undefined;
  if (kind === "image") return mediaUrl(path);
  if (isTauri) return invoke<string>("thumbnail", { path, at }).catch(() => undefined);
  return undefined;
}

export async function ffmpegStatus(): Promise<{ ffmpeg?: string; ffprobe?: string }> {
  if (!isTauri) return {};
  return invoke("ffmpeg_status");
}

export async function saveDialog(defaultPath: string, ext: string, label: string): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters: [{ name: label, extensions: [ext] }] });
}

export async function openDialog(ext: string, label: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, filters: [{ name: label, extensions: [ext] }] });
  return typeof r === "string" ? r : null;
}
