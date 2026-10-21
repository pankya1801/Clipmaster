import { describe, expect, it } from "vitest";
import { addAsset, createProject, placeAsset, clipsOnTrack, clipEnd } from "../src/core/project";
import {
  addBroll, AUTO_EDIT_PRESETS, brollMoments, cutTimeline, findFillers, keepOnly, mapClamped, mergeRanges, pickHighlight, remapTime,
} from "../src/core/smartcut";
import type { CaptionWord, MediaClip } from "../src/core/types";

const words = (spec: string, t0 = 0, step = 0.4): CaptionWord[] =>
  spec.split(" ").map((text, i) => ({ text, start: t0 + i * step, end: t0 + i * step + step * 0.8 }));

function talkProject(seconds = 20) {
  let p = createProject();
  p = addAsset(p, { id: "v", path: "v.mp4", name: "v", kind: "video", duration: seconds, width: 1920, height: 1080, hasAudio: true });
  p = addAsset(p, { id: "b1", path: "b1.mp4", name: "b1", kind: "video", duration: 10, width: 1920, height: 1080, hasAudio: true });
  p = addAsset(p, { id: "b2", path: "b2.jpg", name: "b2", kind: "image", duration: 0, width: 800, height: 800, hasAudio: false });
  return placeAsset(p, "v", "t_v1").project;
}

describe("filler words", () => {
  it("finds ums, uhs and stutters", () => {
    const w = words("So um I think the the answer is uh yes.");
    const r = findFillers(w);
    expect(r).toHaveLength(3);
    expect(r[0].start).toBeCloseTo(w[1].start);
    expect(r[1].start).toBeCloseTo(w[4].start); // first "the"
    expect(r[2].start).toBeCloseTo(w[8].start);
  });
  it("only removes soft fillers when asked and when they sound like filler", () => {
    const w = words("I like pizza. It was, like, amazing");
    expect(findFillers(w)).toHaveLength(0);
    const soft = findFillers(w, true);
    expect(soft).toHaveLength(1);
    expect(soft[0].start).toBeCloseTo(w[5].start); // the second "like," only
  });
  it("finds 'you know' as a phrase", () => {
    const w = words("It's, you know, fine");
    const r = findFillers(w, true);
    expect(r).toHaveLength(1);
    expect(r[0].end).toBeCloseTo(w[2].end);
  });
});

describe("cutting the timeline", () => {
  it("merges and remaps", () => {
    expect(mergeRanges([{ start: 2, end: 3 }, { start: 1, end: 2.01 }])).toEqual([{ start: 1, end: 3 }]);
    const cut = [{ start: 2, end: 4 }];
    expect(remapTime(1, cut)).toBe(1);
    expect(remapTime(3, cut)).toBeNull();
    expect(remapTime(5, cut)).toBe(3);
    expect(mapClamped(3, cut)).toBe(2);
  });
  it("splits the main track, ripples and shifts captions", () => {
    let p = talkProject(10);
    p = { ...p, captions: words("a b c d e f g h", 0, 1) };
    const { project, removed } = cutTimeline(p, [{ start: 2, end: 3 }, { start: 6, end: 6.5 }], ["t_v1"]);
    expect(removed).toBeCloseTo(1.5);
    const clips = clipsOnTrack(project, "t_v1") as MediaClip[];
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => [c.start, c.in, c.out])).toEqual([[0, 0, 2], [2, 3, 6], [5, 6.5, 10]]);
    expect(Math.max(...clips.map(clipEnd))).toBeCloseTo(8.5);
    expect(project.captions.map((w) => w.text)).toEqual(["a", "b", "d", "e", "f", "h"]);
    expect(project.captions[2].start).toBeCloseTo(2);
  });
  it("keeps only a highlight on every track", () => {
    let p = talkProject(30);
    p = { ...p, captions: words("x ".repeat(60).trim(), 0, 0.5) };
    const kept = keepOnly(p, { start: 10, end: 20 }, 0);
    const clips = clipsOnTrack(kept, "t_v1") as MediaClip[];
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ start: 0, in: 10, out: 20 });
    expect(kept.captions[0].start).toBeCloseTo(0);
    expect(kept.captions.every((w) => w.end <= 10.01)).toBe(true);
  });
});

describe("B-roll", () => {
  it("cuts away at sentence starts, spaced out", () => {
    const w = [...words("Hello there friends.", 0), ...words("Today we build things.", 5), ...words("It is fun.", 12), ...words("Bye now.", 18)];
    const m = brollMoments(w, 22, { length: 2.5, every: 4 });
    expect(m[0]).toBeCloseTo(5);
    expect(m[1]).toBeCloseTo(12);
    for (let i = 1; i < m.length; i++) expect(m[i] - m[i - 1]).toBeGreaterThanOrEqual(6.5);
  });
  it("falls back to an even rhythm without captions", () => {
    expect(brollMoments([], 30, { length: 2, every: 6 }).length).toBeGreaterThanOrEqual(3);
  });
  it("places muted B-roll on a track above the main one", () => {
    const p = talkProject(30);
    const r = addBroll(p, ["b1", "b2"], "t_v1", { length: 2.5, every: 6 });
    expect(r.shots).toBeGreaterThanOrEqual(3);
    const track = r.project.tracks.find((t) => t.name === "B-roll")!;
    expect(r.project.tracks.indexOf(track)).toBeLessThan(r.project.tracks.findIndex((t) => t.id === "t_v1"));
    const b = clipsOnTrack(r.project, track.id) as MediaClip[];
    expect(b.every((c) => c.volume === 0 && c.fit === "fill")).toBe(true);
    expect(new Set(b.map((c) => c.assetId))).toEqual(new Set(["b1", "b2"]));
    // Second use of b1 shows a different moment.
    const b1 = b.filter((c) => c.assetId === "b1");
    if (b1.length > 1) expect(b1[1].in).not.toBe(b1[0].in);
  });
});

describe("highlights", () => {
  it("prefers the punchy part", () => {
    const dull = words("and then we went to the shop and we bought some bread and milk and then we walked home again.", 0, 0.5);
    const hot = words("STOP! This is the biggest mistake everyone makes with money. Never do this! Here is the secret nobody tells you.", 60, 0.35);
    const best = pickHighlight([...dull, ...hot], 5, 20)!;
    expect(best.start).toBeGreaterThanOrEqual(60);
    expect(best.end - best.start).toBeLessThanOrEqual(20);
  });
  it("needs enough words", () => {
    expect(pickHighlight(words("hi there"))).toBeNull();
  });
});

describe("presets", () => {
  it("covers talking head, vlog, podcast and montage", () => {
    expect(AUTO_EDIT_PRESETS.map((p) => p.id)).toEqual(["talking-head", "vlog", "podcast", "montage"]);
  });
});
