/** Auto face blur: detect faces offline (MediaPipe) and save a blur mask for export. */
import { clipEnd, updateClip } from "../core/project";
import { sampleSize, unpackFrames } from "../core/reframe";
import type { MediaClip } from "../core/types";
import { useEditor } from "../store";
import { invoke, isTauri } from "./backend";

const S = () => useEditor.getState();

async function faceFiles(): Promise<Record<string, string>> {
  const m = await Promise.all([
    import("@mediapipe/face_detection/face_detection_short.binarypb?url"),
    import("@mediapipe/face_detection/face_detection_full.binarypb?url"),
    import("@mediapipe/face_detection/face_detection_short_range.tflite?url"),
    import("@mediapipe/face_detection/face_detection_full_range_sparse.tflite?url"),
    import("@mediapipe/face_detection/face_detection_full_range.tflite?url"),
    import("@mediapipe/face_detection/face_detection_solution_simd_wasm_bin.js?url"),
    import("@mediapipe/face_detection/face_detection_solution_simd_wasm_bin.wasm?url"),
    import("@mediapipe/face_detection/face_detection_solution_simd_wasm_bin.data?url"),
    import("@mediapipe/face_detection/face_detection_solution_wasm_bin.js?url"),
    import("@mediapipe/face_detection/face_detection_solution_wasm_bin.wasm?url"),
  ]);
  const names = [
    "face_detection_short.binarypb", "face_detection_full.binarypb", "face_detection_short_range.tflite", "face_detection_full_range_sparse.tflite",
    "face_detection_full_range.tflite", "face_detection_solution_simd_wasm_bin.js", "face_detection_solution_simd_wasm_bin.wasm",
    "face_detection_solution_simd_wasm_bin.data", "face_detection_solution_wasm_bin.js", "face_detection_solution_wasm_bin.wasm",
  ];
  return Object.fromEntries(names.map((n, i) => [n, m[i].default]));
}

export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Faces on each frame, with short gaps filled from the previous frame. */
export function holdFaces(frames: FaceBox[][], hold = 3): FaceBox[][] {
  let last: FaceBox[] = [];
  let miss = 0;
  return frames.map((f) => {
    if (f.length) {
      last = f;
      miss = 0;
      return f;
    }
    if (++miss <= hold) return last;
    return [];
  });
}

function selectedVideo(): MediaClip {
  const { project, selected, playhead } = S();
  const sel = selected.map((id) => project.clips[id]).find((c): c is MediaClip => c?.type === "media" && project.assets[c.assetId]?.kind === "video");
  const under = Object.values(project.clips).find(
    (c): c is MediaClip => c.type === "media" && project.assets[c.assetId]?.kind === "video" && c.start <= playhead && clipEnd(c) > playhead
  );
  const c = sel ?? under;
  if (!c) throw new Error("Select a video clip first.");
  return c;
}

export async function blurFaces(onProgress: (m: string) => void): Promise<string> {
  if (!isTauri) throw new Error("Face blur needs the desktop app.");
  const c = selectedVideo();
  const asset = S().project.assets[c.assetId];
  onProgress("Loading face detection…");
  const files = await faceFiles();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("@mediapipe/face_detection");
  const FaceDetection = mod.FaceDetection ?? mod.default?.FaceDetection ?? (globalThis as any).FaceDetection; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!FaceDetection) throw new Error("Could not load face detection.");
  const det = new FaceDetection({ locateFile: (f: string) => files[f] ?? f });
  det.setOptions({ model: "short", minDetectionConfidence: 0.45 });

  const fps = Math.min(12, 600 / Math.max(0.5, c.out - c.in));
  const { width, height } = sampleSize(asset.width, asset.height, 320);
  onProgress("Reading frames…");
  const b64 = await invoke<string>("sample_frames", { path: asset.path, start: c.in, end: c.out, fps, width, height });
  const frames = unpackFrames(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), width, height, c.in, fps);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.createImageData(width, height);
  let resolveFrame: (boxes: FaceBox[]) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  det.onResults((r: any) => resolveFrame((r.detections ?? []).map((d: any) => {
    const b = d.boundingBox;
    return { x: b.xCenter, y: b.yCenter, w: b.width, h: b.height };
  })));
  const found: FaceBox[][] = [];
  for (const [i, f] of frames.entries()) {
    if (i % 10 === 0) onProgress(`Finding faces (${Math.round((i / frames.length) * 100)}%)…`);
    for (let k = 0, p = 0; k < width * height; k++, p += 3) {
      img.data[k * 4] = f.rgb[p];
      img.data[k * 4 + 1] = f.rgb[p + 1];
      img.data[k * 4 + 2] = f.rgb[p + 2];
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    found.push(await new Promise<FaceBox[]>((res) => {
      resolveFrame = res;
      det.send({ image: canvas });
    }));
  }
  det.close?.();
  const faces = holdFaces(found);
  const count = Math.max(0, ...faces.map((f) => f.length));
  if (!count) throw new Error("No faces found in this clip.");

  onProgress("Saving the blur mask…");
  const out = new Uint8Array(width * height * faces.length);
  for (const [i, fs] of faces.entries()) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    for (const b of fs) {
      ctx.beginPath();
      ctx.ellipse(b.x * width, b.y * height, (b.w * width * 1.35) / 2, (b.h * height * 1.6) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const px = ctx.getImageData(0, 0, width, height).data;
    for (let k = 0; k < width * height; k++) out[i * width * height + k] = px[k * 4];
  }
  let bin = "";
  for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
  const raw = await invoke<string>("write_temp_file", { name: `faces_${Date.now()}.gray`, dataBase64: btoa(bin) });
  const mask = raw.replace(/\.gray$/, ".mkv");
  await invoke("run_ffmpeg", {
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${width}x${height}`, "-r", String(fps), "-i", raw, "-vf", "gblur=sigma=2", "-c:v", "ffv1", mask],
  });
  S().commit((p) => updateClip(p, c.id, { faceMask: { path: mask, start: c.in, fps } }));
  return `Blurred ${count} face${count > 1 ? "s" : ""} (shows on export).`;
}
