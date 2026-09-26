import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { beatSyncMontage, detectBeats, findMusicClip } from "../src/core/beats";
import { addAsset, clipDuration, clipsOnTrack, createProject, placeAsset } from "../src/core/project";
import type { MediaClip } from "../src/core/types";

/** Same envelope the Rust backend computes: RMS per 512 samples @ 22.05 kHz. */
function envelope(pcm: Float32Array) {
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += 512) {
    let s = 0;
    const end = Math.min(pcm.length, i + 512);
    for (let j = i; j < end; j++) s += pcm[j] * pcm[j];
    out.push(Math.sqrt(s / (end - i)));
  }
  return out;
}

function synthEnvelope(bpm: number, seconds: number, offset = 0) {
  const sr = 22050;
  const pcm = new Float32Array(sr * seconds);
  const period = 60 / bpm;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sr;
    const since = (t - offset + period * 100) % period;
    pcm[i] = (since < 0.04 ? 0.8 * Math.sin(2 * Math.PI * 80 * t) : 0) + 0.02 * Math.sin(2 * Math.PI * 440 * t);
  }
  return envelope(pcm);
}

describe("beat detection", () => {
  it.each([90, 120, 128, 150])("finds %d BPM", (bpm) => {
    const { bpm: got, beats } = detectBeats(synthEnvelope(bpm, 20, 0.3));
    expect(Math.abs(got - bpm)).toBeLessThan(2);
    // Beats land on the clicks (within 40 ms).
    const period = 60 / bpm;
    for (const b of beats.slice(1, 6)) expect(Math.min((b - 0.3) % period, period - ((b - 0.3) % period))).toBeLessThan(0.04);
  });

  it("works on real decoded audio (FFmpeg click track)", () => {
    let pcm: Buffer;
    try {
      pcm = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,0.5),0.03),0.8*sin(2*PI*120*t),0)':d=12", "-ac", "1", "-ar", "22050", "-f", "f32le", "-"]);
    } catch {
      return; // ffmpeg not installed
    }
    const f32 = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    expect(Math.abs(detectBeats(envelope(f32)).bpm - 120)).toBeLessThan(2);
  });
});

describe("beat-synced montage", () => {
  it("cuts footage onto every 2nd beat round-robin and mutes clip audio", () => {
    let p = createProject();
    for (const id of ["a", "b"]) p = addAsset(p, { id, path: `/${id}.mp4`, name: id, kind: "video", duration: 10, hasAudio: true });
    p = addAsset(p, { id: "m", path: "/m.mp3", name: "m", kind: "audio", duration: 8, hasAudio: true });
    p = placeAsset(p, "a", "t_v1").project;
    p = placeAsset(p, "b", "t_v1").project;
    p = placeAsset(p, "m", "t_a1").project;
    const music = findMusicClip(p)!;
    const beats = Array.from({ length: 16 }, (_, i) => i * 0.5); // 120 BPM
    const r = beatSyncMontage(p, music.id, beats, { everyBeats: 2, muteClips: true, punchIn: true, flash: false });
    const clips = clipsOnTrack(r.project, "t_v1") as MediaClip[];
    expect(clips.length).toBe(8); // 8 s of music / 1 s segments
    expect(clips.every((c) => Math.abs(clipDuration(c) - 1) < 1e-6 && c.volume === 0)).toBe(true);
    expect(clips.map((c) => c.assetId).slice(0, 4)).toEqual(["a", "b", "a", "b"]);
    expect(clips[2].in).toBeCloseTo(1); // continues where clip "a" left off
    expect(clips[1].effects.some((e) => e.id === "punch-in")).toBe(true);
  });
});
