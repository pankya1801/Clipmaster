import { describe, expect, it } from "vitest";
import { applyAutoZoom, emphasisScore, pickZoomMoments } from "../src/core/autozoom";
import { sampleKeyframes } from "../src/core/keyframes";
import { addAsset, createProject, placeAsset } from "../src/core/project";
import type { CaptionWord, MediaClip } from "../src/core/types";

const say = (text: string, gapAt: number[] = []) => {
  let t = 0;
  return text.split(" ").map((w, i) => {
    if (gapAt.includes(i)) t += 1;
    const word = { text: w, start: t, end: t + 0.3 };
    t += 0.35;
    return word;
  }) as CaptionWord[];
};

describe("auto zoom", () => {
  it("scores exclamations, caps and hook words higher than filler", () => {
    const w = say("so this is the SECRET nobody tells you wow!");
    const s = (txt: string) => emphasisScore(w, w.findIndex((x) => x.text === txt));
    expect(s("SECRET")).toBeGreaterThan(s("the"));
    expect(s("nobody")).toBeGreaterThan(s("tells"));
    expect(s("wow!")).toBeGreaterThanOrEqual(2);
  });

  it("keeps zooms at least minGap apart and alternates styles", () => {
    const words = say("NEVER do this. ALWAYS do that! the SECRET is simple. money MONEY money", [3, 7, 11]);
    const m = pickZoomMoments(words, 3);
    for (let i = 1; i < m.length; i++) expect(m[i].start - m[i - 1].start).toBeGreaterThanOrEqual(3);
    expect(m.length).toBeGreaterThanOrEqual(2);
    expect(m[0].style).toBe("punch");
    expect(m[1].style).toBe("push");
  });

  it("adds zoom keyframes to the main clip and returns to normal afterwards", () => {
    let p = addAsset(createProject(), { id: "v", path: "/v.mp4", name: "v", kind: "video", duration: 20, hasAudio: true });
    p = placeAsset(p, "v", "t_v1").project;
    p = { ...p, captions: [{ text: "Hello", start: 0.5, end: 0.8 }, { text: "NEVER!", start: 5, end: 5.4 }] };
    const r = applyAutoZoom(p);
    expect(r.zooms).toBeGreaterThan(0);
    const clip = Object.values(r.project.clips)[0] as MediaClip;
    expect(sampleKeyframes(clip.keyframes!, 5.3).scale).toBeGreaterThan(1.1);
    expect(sampleKeyframes(clip.keyframes!, 9).scale).toBeCloseTo(1);
  });

  it("leaves clips with hand-made keyframes alone", () => {
    let p = addAsset(createProject(), { id: "v", path: "/v.mp4", name: "v", kind: "video", duration: 20, hasAudio: true });
    const placed = placeAsset(p, "v", "t_v1");
    p = placed.project;
    const custom = [{ t: 0, x: 0.3, y: 0.5, scale: 2, rotation: 0, opacity: 1 }];
    p = { ...p, clips: { ...p.clips, [placed.clipId!]: { ...(p.clips[placed.clipId!] as MediaClip), keyframes: custom } }, captions: [{ text: "NEVER!", start: 5, end: 5.4 }] };
    expect(applyAutoZoom(p).zooms).toBe(0);
  });
});
