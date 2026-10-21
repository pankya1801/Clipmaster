/** BYOK AI actions: image generation, voices, dubbing, viral clips, publish text, smarter B-roll. */
import {
  AiKeys, BROLL_SYSTEM, brollPrompt, chatRequest, chatText, ClipIdea, extractJson, HttpRequest, imageProvider, imageRequest, imageResult, ImageSize,
  llmProvider, parseClipIdeas, parsePublishKit, parseQueries, parseTranslation, PUBLISH_SYSTEM, publishPrompt, PublishKit, respread, sentences,
  speechRequest, timedTranscript, TRANSLATE_SYSTEM, translatePrompt, VIRAL_SYSTEM, viralPrompt, VoiceProvider,
} from "../core/ai";
import { addAsset, addText, addTrack, clipEnd, clipsOnTrack, placeAsset, projectDuration, uid, updateClip } from "../core/project";
import { keepOnly } from "../core/smartcut";
import type { CaptionWord, MediaAsset, Project } from "../core/types";
import { useEditor } from "../store";
import { freeTopVideoTrack, makeFormat } from "./actions";
import { invoke, isTauri, probe, thumbnail } from "./backend";

const S = () => useEditor.getState();
const EMPTY: AiKeys = { openai: "", openrouter: "", anthropic: "", fal: "", elevenlabs: "" };

export function loadAiKeys(): AiKeys {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem("cm.ai") ?? "{}") };
  } catch {
    return { ...EMPTY };
  }
}
export function saveAiKeys(k: AiKeys) {
  try {
    localStorage.setItem("cm.ai", JSON.stringify(k));
  } catch {
    /* storage unavailable */
  }
}

function needDesktop() {
  if (!isTauri) throw new Error("AI features need the desktop app.");
}

async function send(req: HttpRequest, saveAs?: string): Promise<string> {
  return invoke<string>("ai_request", { ...req, body: req.body ?? null, saveAs: saveAs ?? null });
}

/** Ask the configured text model; returns parsed JSON. */
export async function askJson<T = unknown>(system: string, user: string, maxTokens = 2000): Promise<T> {
  needDesktop();
  const k = loadAiKeys();
  const prov = llmProvider(k);
  if (!prov) throw new Error("Add an OpenAI, Anthropic or OpenRouter key in Settings → AI first.");
  const raw = await send(chatRequest(prov, k, system, user, maxTokens));
  return extractJson<T>(chatText(prov, JSON.parse(raw)));
}

export const hasLlm = () => !!llmProvider(loadAiKeys());

async function importFile(path: string, name: string, extra: Partial<MediaAsset> = {}): Promise<MediaAsset> {
  const info = await probe(path, name);
  const asset: MediaAsset = { id: uid("a"), path, name, ...info, ...extra };
  S().commit((p) => addAsset(p, asset));
  thumbnail(asset.path, asset.kind, Math.min(1, asset.duration / 2)).then((url) => S().setThumb(asset.id, url));
  return asset;
}

// ---------------------------------------------------------------- images

export type ImageUse = "background" | "sticker" | "broll" | "library";

export async function generateImage(prompt: string, use: ImageUse, onProgress: (m: string) => void): Promise<string> {
  needDesktop();
  if (!prompt.trim()) throw new Error("Describe the image first.");
  const k = loadAiKeys();
  const prov = imageProvider(k);
  if (!prov) throw new Error("Add an OpenAI or fal.ai key in Settings → AI first.");
  const { width, height } = S().project.settings;
  const size: ImageSize = use === "sticker" ? "square" : width > height * 1.1 ? "landscape" : height > width * 1.1 ? "portrait" : "square";
  onProgress("Generating image…");
  const res = imageResult(prov, JSON.parse(await send(imageRequest(prov, k, prompt, size, use === "sticker"))));
  const name = `ai-${Date.now()}.png`;
  let path: string;
  if (res.b64) path = await invoke<string>("ai_save_base64", { name, dataBase64: res.b64 });
  else path = await send({ url: res.url!, method: "GET", headers: {} }, name);
  const asset = await importFile(path, `AI: ${prompt.slice(0, 30)}`);
  if (use === "library") return "Image added to your media.";
  const at = S().playhead;
  if (use === "background") {
    let p = S().project;
    const videos = p.tracks.filter((t) => t.kind === "video");
    let trackId = videos[videos.length - 1]?.id;
    if (!trackId || clipsOnTrack(p, trackId).some((c) => c.start < at + 5 && clipEnd(c) > at)) {
      const before = new Set(p.tracks.map((t) => t.id));
      p = addTrack(p, "video");
      const t = p.tracks.find((x) => !before.has(x.id))!;
      const rest = p.tracks.filter((x) => x.id !== t.id);
      const last = rest.map((x) => x.kind).lastIndexOf("video");
      p = { ...p, tracks: [...rest.slice(0, last + 1), t, ...rest.slice(last + 1)] };
      trackId = t.id;
    }
    const r = placeAsset(p, asset.id, trackId, at);
    if (r.clipId) S().commit(() => updateClip(r.project, r.clipId!, { fit: "fill", effects: [{ id: "zoom-in", amount: 0.5 }] }));
    return "AI background added.";
  }
  const len = use === "sticker" ? 3 : 4;
  const tr = freeTopVideoTrack(S().project, at, len);
  const r = placeAsset(tr.project, asset.id, tr.trackId, at);
  if (!r.clipId) return "Image added to your media.";
  const patch = use === "sticker"
    ? { out: len, transform: { x: 0.5, y: 0.4, scale: 0.4, rotation: 0, opacity: 1 } }
    : { out: len, fit: "fill" as const, effects: [{ id: "zoom-in", amount: 0.5 }] };
  S().commit(() => updateClip(r.project, r.clipId!, patch));
  S().select([r.clipId]);
  return use === "sticker" ? "AI sticker added." : "AI B-roll image added.";
}

// ---------------------------------------------------------------- voices

async function speakToFile(provider: VoiceProvider, text: string, voice: string, instructions?: string): Promise<string> {
  const k = loadAiKeys();
  return send(speechRequest(provider, k, text, voice, instructions), `voice-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`);
}

function placeAudio(p0: Project, assetId: string, at: number, trackId?: string): { project: Project; clipId?: string; trackId: string } {
  let p = p0;
  const len = p.assets[assetId]?.duration ?? 1;
  let tid = trackId;
  if (!tid) {
    const free = p.tracks.find((t) => t.kind === "audio" && !clipsOnTrack(p, t.id).some((c) => c.start < at + len && clipEnd(c) > at));
    tid = free?.id;
  }
  if (!tid) {
    const before = new Set(p.tracks.map((t) => t.id));
    p = addTrack(p, "audio");
    tid = p.tracks.find((t) => !before.has(t.id))!.id;
  }
  const r = placeAsset(p, assetId, tid, at);
  return { ...r, trackId: tid };
}

export async function aiVoiceover(provider: VoiceProvider, text: string, voice: string, style: string): Promise<string> {
  needDesktop();
  if (!text.trim()) throw new Error("Type something to say.");
  const path = await speakToFile(provider, text, voice, style || undefined);
  const asset = await importFile(path, `Voice: ${text.slice(0, 24)}`);
  const r = placeAudio(S().project, asset.id, S().playhead);
  if (r.clipId) {
    S().commit(() => r.project);
    S().select([r.clipId]);
  }
  return "AI voiceover added at the playhead.";
}

/**
 * Dub the video: translate the captions sentence by sentence, speak each one
 * with an AI voice at the same time, and replace the captions with the
 * translation. The original voice is turned down.
 */
export async function dubProject(language: string, provider: VoiceProvider, voice: string, onProgress: (m: string) => void, keepOriginal = 0.1): Promise<string> {
  needDesktop();
  const { project } = S();
  if (!project.captions.length) throw new Error("Add captions first (✨ Auto captions) — dubbing translates them.");
  const sents = sentences(project.captions);
  onProgress(`Translating ${sents.length} lines to ${language}…`);
  const translated: string[] = [];
  for (let i = 0; i < sents.length; i += 60) {
    const chunk = sents.slice(i, i + 60).map((s) => s.text);
    translated.push(...parseTranslation(await askJson(TRANSLATE_SYSTEM, translatePrompt(chunk, language), 4000), chunk.length));
  }
  let p = S().project;
  const before = new Set(p.tracks.map((t) => t.id));
  p = addTrack(p, "audio");
  const trackId = p.tracks.find((t) => !before.has(t.id))!.id;
  S().commit(() => p);
  const words: CaptionWord[] = [];
  for (const [i, s] of sents.entries()) {
    onProgress(`Voicing line ${i + 1} of ${sents.length}…`);
    const text = translated[i];
    if (!text.trim()) continue;
    const path = await speakToFile(provider, text, voice);
    const asset = await importFile(path, `Dub ${i + 1}: ${text.slice(0, 20)}`);
    const r = placeAudio(S().project, asset.id, s.start, trackId);
    if (r.clipId) {
      // Speed the line up a little if it runs into the next one.
      const next = sents[i + 1]?.start ?? Infinity;
      const room = next - s.start;
      const speed = asset.duration > room ? Math.min(1.35, asset.duration / Math.max(0.5, room)) : 1;
      S().commit(() => updateClip(r.project, r.clipId!, { speed: Math.round(speed * 100) / 100 }));
      words.push(...respread(text, s.start, s.start + Math.min(asset.duration / speed, Math.max(0.3, room))));
    }
  }
  // Turn down the original speech under the dub.
  S().commit((pp) => {
    let out = { ...pp, captions: words };
    for (const c of Object.values(pp.clips)) {
      if (c.type === "media" && c.trackId !== trackId && pp.assets[c.assetId]?.kind === "video") out = updateClip(out, c.id, { volume: keepOriginal });
    }
    return out;
  });
  return `Dubbed into ${language}: ${sents.length} lines.`;
}

// ---------------------------------------------------------------- viral clips & publishing

export async function findViralClips(onProgress: (m: string) => void, count = 5): Promise<ClipIdea[]> {
  const { project } = S();
  if (project.captions.length < 20) throw new Error("Add captions first (✨ Auto captions) — the clip finder reads the transcript.");
  onProgress("Reading the transcript…");
  const ideas = parseClipIdeas(await askJson(VIRAL_SYSTEM, viralPrompt(timedTranscript(sentences(project.captions)), count), 3000), projectDuration(project));
  if (!ideas.length) throw new Error("The AI didn't find any good clips.");
  return ideas;
}

/** Turn one idea into a vertical Short with its hook on screen. */
export async function makeShortFrom(idea: ClipIdea, onProgress: (m: string) => void): Promise<string> {
  S().commit((p) => keepOnly(p, { start: idea.start, end: idea.end }));
  const msg = await makeFormat(1080, 1920, "fill", onProgress);
  if (idea.hook) {
    S().commit((p0) => {
      let p = p0;
      let track = p.tracks.find((t) => t.kind === "text");
      if (!track) {
        p = addTrack(p, "text");
        track = p.tracks.find((t) => t.kind === "text")!;
      }
      const r = addText(p, track.id, 0, idea.hook, "pop-title");
      return r.clipId ? updateClip(r.project, r.clipId, { duration: 2.5 }) : r.project;
    });
  }
  return `Made “${idea.title}”. ${msg}`;
}

export async function publishKit(platform: string, onProgress: (m: string) => void): Promise<PublishKit> {
  const { project } = S();
  if (!project.captions.length) throw new Error("Add captions first (✨ Auto captions).");
  onProgress("Writing…");
  return parsePublishKit(await askJson(PUBLISH_SYSTEM, publishPrompt(timedTranscript(sentences(project.captions), 12000), platform)));
}

/** Better stock search phrases for B-roll cues (falls back to the plain ones). */
export async function refineBrollQueries(cues: { start: number; end: number; query: string }[]): Promise<string[]> {
  if (!hasLlm()) return cues.map((c) => c.query);
  const words = S().project.captions;
  const items = cues.map((c, id) => ({
    id,
    context: words.filter((w) => w.start >= c.start - 4 && w.start < c.end + 3).map((w) => w.text).join(" "),
  }));
  try {
    const m = parseQueries(await askJson(BROLL_SYSTEM, brollPrompt(items), 1500));
    return cues.map((c, i) => m.get(i) ?? c.query);
  } catch {
    return cues.map((c) => c.query);
  }
}
