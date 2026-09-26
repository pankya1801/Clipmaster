import { describe, expect, it } from "vitest";
import {
  addAsset, addText, clipDuration, clipEnd, createProject, deleteClips, moveClip, placeAsset,
  projectDuration, snapTime, splitClip, trimEnd, trimStart, updateClip, visualAt,
} from "../src/core/project";
import type { MediaAsset, MediaClip, Project } from "../src/core/types";

const video: MediaAsset = { id: "a1", path: "/v.mp4", name: "v.mp4", kind: "video", duration: 10, hasAudio: true };
const image: MediaAsset = { id: "a2", path: "/i.png", name: "i.png", kind: "image", duration: 0, hasAudio: false };
const music: MediaAsset = { id: "a3", path: "/m.mp3", name: "m.mp3", kind: "audio", duration: 30, hasAudio: true };

function setup() {
  let p = addAsset(addAsset(addAsset(createProject(), video), image), music);
  const a = placeAsset(p, "a1", "t_v1");
  const b = placeAsset(a.project, "a2", "t_v1");
  return { p: b.project, v: a.clipId!, img: b.clipId! };
}
const media = (p: Project, id: string) => p.clips[id] as MediaClip;

describe("placement", () => {
  it("appends clips back to back", () => {
    const { p, img } = setup();
    expect(p.clips[img].start).toBe(10);
    expect(clipDuration(p.clips[img])).toBe(5);
    expect(projectDuration(p)).toBe(15);
  });
  it("rejects clips on the wrong track kind", () => {
    const { p } = setup();
    expect(placeAsset(p, "a3", "t_v1").clipId).toBeUndefined();
    expect(placeAsset(p, "a2", "t_a1").clipId).toBeUndefined();
    expect(placeAsset(p, "a3", "t_a1").clipId).toBeDefined();
  });
});

describe("move", () => {
  it("never overlaps; lands in nearest free slot", () => {
    const { p, img } = setup();
    const moved = moveClip(p, img, "t_v1", 3); // would overlap the video
    const c = moved.clips[img];
    expect(c.start === 10 || clipEnd(c) <= 0 + 1e-9 || c.start >= 10).toBe(true);
  });
  it("moves into free space", () => {
    const { p, img } = setup();
    expect(moveClip(p, img, "t_v1", 20).clips[img].start).toBe(20);
  });
});

describe("trim", () => {
  it("trimStart moves in-point and keeps end fixed", () => {
    const { p, v } = setup();
    const t = trimStart(p, v, 2);
    expect(media(t, v).in).toBe(2);
    expect(t.clips[v].start).toBe(2);
    expect(clipEnd(t.clips[v])).toBe(10);
  });
  it("trimStart cannot go before source start", () => {
    const { p, v } = setup();
    const t = trimStart(trimStart(p, v, 2), v, -5);
    expect(media(t, v).in).toBe(0);
  });
  it("trimEnd cannot exceed source or overlap next clip", () => {
    const { p, v } = setup();
    expect(media(trimEnd(p, v, 50), v).out).toBe(10);
    expect(media(trimEnd(p, v, 4), v).out).toBe(4);
  });
  it("images can be stretched", () => {
    const { p, img } = setup();
    expect(clipDuration(trimEnd(p, img, 30).clips[img])).toBe(20);
  });
  it("respects speed", () => {
    const { p, v } = setup();
    const fast = updateClip(p, v, { speed: 2 });
    expect(clipDuration(fast.clips[v])).toBe(5);
    expect(media(trimStart(fast, v, 1), v).in).toBe(2);
  });
});

describe("split / delete", () => {
  it("splits into two contiguous clips", () => {
    const { p, v } = setup();
    const { project, clipId } = splitClip(p, v, 4);
    expect(media(project, v).out).toBe(4);
    expect(media(project, clipId!).in).toBe(4);
    expect(project.clips[clipId!].start).toBe(4);
  });
  it("ripple delete closes the gap", () => {
    const { p, v, img } = setup();
    const r = deleteClips(p, [v], true);
    expect(r.clips[img].start).toBe(0);
    expect(deleteClips(p, [v]).clips[img].start).toBe(10);
  });
});

describe("helpers", () => {
  it("snaps to edges", () => {
    const { p } = setup();
    expect(snapTime(p, 9.9, 0.2)).toBe(10);
    expect(snapTime(p, 7, 0.2)).toBe(7);
  });
  it("finds the visible clip", () => {
    const { p, v, img } = setup();
    expect(visualAt(p, 1)?.id).toBe(v);
    expect(visualAt(p, 12)?.id).toBe(img);
    expect(visualAt(p, 20)).toBeUndefined();
  });
  it("adds text only to text tracks", () => {
    const { p } = setup();
    expect(addText(p, "t_text", 1).clipId).toBeDefined();
    expect(addText(p, "t_v1", 1).clipId).toBeUndefined();
  });
});

describe("transform", () => {
  it("clamps values and drops identity transforms", () => {
    const { p, v } = setup();
    const t = updateClip(p, v, { transform: { x: 0.8, y: 0.2, scale: 9, rotation: -30, opacity: 2 } });
    expect(media(t, v).transform).toEqual({ x: 0.8, y: 0.2, scale: 4, rotation: 330, opacity: 1 });
    const back = updateClip(t, v, { transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } });
    expect(media(back, v).transform).toBeUndefined();
  });
});

describe("keyframes on split", () => {
  it("keeps the animation continuous across the cut", () => {
    const { p, v } = setup();
    const withKeys = updateClip(p, v, {
      keyframes: [
        { t: 0, x: 0, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
        { t: 10, x: 1, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
      ],
    });
    const { project, clipId } = splitClip(withKeys, v, 5);
    const left = media(project, v).keyframes!;
    const right = media(project, clipId!).keyframes!;
    expect(left.at(-1)!.t).toBeCloseTo(5);
    expect(right[0].t).toBe(0);
    expect(right[0].x).toBeCloseTo(left.at(-1)!.x);
    expect(right.at(-1)!.t).toBeCloseTo(5);
  });
});
