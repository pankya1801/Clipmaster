import { describe, expect, it } from "vitest";
import { brollCues, orientationOf, parseResults, searchUrl, stockFileName } from "../src/core/stock";
import type { CaptionWord } from "../src/core/types";

const pexelsVideos = {
  videos: [
    {
      id: 123, width: 3840, height: 2160, duration: 12, url: "https://www.pexels.com/video/123/", image: "https://images.pexels.com/videos/123/x.jpg", user: { name: "Ann" },
      video_files: [
        { quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/4k.mp4" },
        { quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/1080.mp4" },
        { quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/360.mp4" },
      ],
    },
  ],
};
const pixabayVideos = {
  hits: [{ id: 9, pageURL: "https://pixabay.com/videos/id-9/", duration: 7, user: "bob", videos: {
    large: { url: "https://cdn.pixabay.com/l.mp4", width: 1920, height: 1080, thumbnail: "https://cdn.pixabay.com/l.jpg" },
    medium: { url: "https://cdn.pixabay.com/m.mp4", width: 1280, height: 720, thumbnail: "https://cdn.pixabay.com/m.jpg" },
    small: { url: "https://cdn.pixabay.com/s.mp4", width: 960, height: 540 },
    tiny: { url: "", width: 0, height: 0 },
  } }],
};

describe("stock providers", () => {
  it("picks the rendition closest to the project size", () => {
    const [v] = parseResults("pexels", "video", pexelsVideos, 1080);
    expect(v.url).toBe("https://videos.pexels.com/1080.mp4");
    expect(v).toMatchObject({ author: "Ann", duration: 12, width: 1920, height: 1080 });
    expect(parseResults("pexels", "video", pexelsVideos, 2160)[0].url).toContain("4k");
    expect(parseResults("pixabay", "video", pixabayVideos, 720)[0].url).toBe("https://cdn.pixabay.com/m.mp4");
    expect(parseResults("pixabay", "video", pixabayVideos, 1080)[0].thumb).toBe("https://cdn.pixabay.com/m.jpg");
  });
  it("parses photos", () => {
    const px = parseResults("pexels", "photo", { photos: [{ id: 1, width: 4000, height: 3000, url: "https://www.pexels.com/photo/1/", photographer: "Cy", src: { original: "https://images.pexels.com/o.jpeg", large2x: "https://images.pexels.com/l.jpeg", medium: "https://images.pexels.com/m.jpeg" } }] });
    expect(px[0]).toMatchObject({ url: "https://images.pexels.com/l.jpeg", author: "Cy", kind: "photo" });
    const pb = parseResults("pixabay", "photo", { hits: [{ id: 2, pageURL: "p", webformatURL: "w", largeImageURL: "l", imageWidth: 10, imageHeight: 5, user: "u" }] });
    expect(pb[0]).toMatchObject({ url: "l", thumb: "w" });
    expect(parseResults("pexels", "video", {})).toEqual([]);
  });
  it("builds search URLs with keys in the right place", () => {
    const a = searchUrl("pexels", "video", "city night", "KEY", { orientation: "portrait" });
    expect(a.url).toBe("https://api.pexels.com/videos/search?query=city%20night&per_page=24&page=1&orientation=portrait");
    expect(a.headers).toEqual({ Authorization: "KEY" });
    const b = searchUrl("pixabay", "photo", "cat", "K&1", { orientation: "landscape" });
    expect(b.url).toContain("https://pixabay.com/api/?key=K%261&q=cat");
    expect(b.url).toContain("image_type=photo");
    expect(b.url).toContain("orientation=horizontal");
  });
  it("names files safely and by size", () => {
    expect(stockFileName(parseResults("pexels", "video", pexelsVideos)[0])).toBe("pexels-video-123-1080.mp4");
    expect(orientationOf(1080, 1920)).toBe("portrait");
  });
});

describe("auto B-roll cues", () => {
  const say = (text: string, from = 0, step = 0.4): CaptionWord[] => text.split(" ").map((t, i) => ({ text: t, start: from + i * step, end: from + i * step + 0.35 }));
  it("finds telling words, skipping filler and stop words", () => {
    const words = [
      ...say("so um today I want to talk about my trip to the mountains", 0),
      ...say("we hiked through a beautiful forest and saw waterfalls", 8),
      ...say("then we cooked dinner by the campfire under the stars", 16),
    ];
    const cues = brollCues(words, { every: 8, length: 3 });
    expect(cues.length).toBe(3);
    expect(cues[0].query).toMatch(/mountains|trip/);
    expect(cues[1].query).toMatch(/forest|waterfalls|beautiful/);
    expect(cues[2].query).toMatch(/campfire|dinner|stars/);
    for (const c of cues) {
      expect(c.end - c.start).toBeLessThanOrEqual(3.001);
      expect(c.query).not.toMatch(/\b(um|so|the|we)\b/);
    }
  });
  it("respects max and returns nothing without words", () => {
    expect(brollCues([], {})).toEqual([]);
    const long = say(Array.from({ length: 200 }, (_, i) => `topic${String.fromCharCode(97 + (i % 26))}word`).join(" "));
    expect(brollCues(long, { every: 4, max: 5 }).length).toBe(5);
  });
});
