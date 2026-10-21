import type { FitMode, FocusPoint } from "./reframe";
import type { Box, MaskShape } from "./visuals";
import type { RampPoint } from "./speed";

export type AssetKind = "video" | "audio" | "image";

export interface MediaAsset {
  id: string;
  path: string;
  name: string;
  kind: AssetKind;
  /** Seconds. Images get a default display length when placed. */
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  /** Where stock media came from, for the credits list. */
  credit?: { provider: string; author: string; pageUrl: string };
}

export type TrackKind = "video" | "audio" | "text";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
}

interface ClipBase {
  id: string;
  trackId: string;
  /** Position on the timeline, seconds. */
  start: number;
}

export interface MediaClip extends ClipBase {
  type: "media";
  assetId: string;
  /** Source in/out points, seconds. */
  in: number;
  out: number;
  speed: number;
  volume: number; // 0..2 (1 = original)
  fadeIn: number;
  fadeOut: number;
  /** Visual effects, applied in order. amount is 0..1. */
  effects: AppliedEffect[];
  transIn?: AppliedTransition;
  transOut?: AppliedTransition;
  /** Position/scale/rotation/opacity. Undefined = fill the frame. */
  transform?: Transform;
  /** Animated transform. When present (≥1 key) it overrides `transform`. */
  keyframes?: Keyframe[];
  /** Voice clean-up on this clip's audio. */
  denoise?: boolean;
  /** How the clip fills a differently shaped canvas. Undefined = project default. */
  fit?: FitMode;
  /** Where to centre the crop over time (Smart reframe), in source seconds. */
  focus?: FocusPoint[];
  /** Cut the clip to a shape (rounded corners, circle). */
  mask?: MaskShape;
  /** Fill only this region of the frame (split-screen layouts). */
  box?: Box;
  /** Soft edge for the shape mask, 0..1. */
  feather?: number;
  /** Speed ramp (curve speed). The clip keeps its length; its own sound is muted. */
  ramp?: RampPoint[];
  /** Hold the frame at `in` for the clip's length. */
  freeze?: boolean;
  /** Play backwards. */
  reverse?: boolean;
  /** Smooth out camera shake. */
  stabilize?: boolean;
  /** Green-screen key. */
  chroma?: { color: string; similarity: number; blend: number };
  /** 3D LUT colour grade (.cube file). */
  lut?: { path: string; name: string; amount: number };
  /** AI background removal: a greyscale mask video covering source time from `start`. */
  bgMask?: { path: string; start: number; fps: number };
}

export interface Keyframe extends Transform {
  /** Clip-local time, seconds (0 = clip start on the timeline). */
  t: number;
}

export interface Transform {
  /** Centre of the clip, 0..1 of the frame. */
  x: number;
  y: number;
  /** 1 = fit the frame. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number; // 0..1
}

export interface AppliedEffect {
  id: string;
  amount: number;
}

export interface AppliedTransition {
  id: string;
  duration: number;
}

export interface TextClip extends ClipBase {
  type: "text";
  duration: number;
  text: string;
  /** Anchor position, 0..1 of frame. */
  x: number;
  y: number;
  fontSize: number; // px at output resolution
  color: string; // #rrggbb
  box: boolean; // background box behind text
  /** Animated text / motion-graphics template id (see textPresets.ts). */
  preset?: string;
  /** Accent colour used by some templates (bars, boxes, glow). */
  accent?: string;
}

export type Clip = MediaClip | TextClip;

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  /** Lower background music automatically while someone is speaking. */
  autoDuck?: boolean;
  /** Default fit for clips whose shape differs from the canvas. Undefined = fill. */
  fit?: FitMode;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionSettings {
  templateId: string;
  /** Multiplier on the template's font size. */
  scale: number;
  /** Vertical position override, 0 (top) .. 1 (bottom). */
  y?: number;
  /** Max words shown at once (overrides template). */
  maxWords?: number;
}

export interface Project {
  version: 1;
  name: string;
  settings: ProjectSettings;
  assets: Record<string, MediaAsset>;
  /** Top of the list renders on top. */
  tracks: Track[];
  clips: Record<string, Clip>;
  /** Word-timed captions on the timeline. */
  captions: CaptionWord[];
  captionSettings: CaptionSettings;
  /** Timeline markers (seconds), e.g. detected beats. Clips snap to them. */
  markers?: number[];
}

export const ASPECT_PRESETS: { label: string; width: number; height: number }[] = [
  { label: "16:9 Landscape (1080p)", width: 1920, height: 1080 },
  { label: "9:16 Reels / Shorts / TikTok", width: 1080, height: 1920 },
  { label: "1:1 Square", width: 1080, height: 1080 },
  { label: "4:5 Instagram feed", width: 1080, height: 1350 },
  { label: "16:9 4K", width: 3840, height: 2160 },
  { label: "16:9 720p", width: 1280, height: 720 },
];
