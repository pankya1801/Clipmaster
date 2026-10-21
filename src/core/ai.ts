/**
 * Bring-your-own-key AI: request builders and response parsers for text
 * (OpenAI, OpenRouter, Anthropic), images (OpenAI, fal.ai) and voices
 * (OpenAI, ElevenLabs), plus the prompts Clipmaster uses. No network here —
 * the backend sends the requests.
 */
import type { CaptionWord } from "./types";

export type LlmProvider = "openai" | "openrouter" | "anthropic";
export type ImageProvider = "openai" | "fal";
export type VoiceProvider = "openai" | "elevenlabs";

export interface AiKeys {
  openai: string;
  openrouter: string;
  anthropic: string;
  fal: string;
  elevenlabs: string;
  /** Optional model overrides. */
  llmModel?: string;
  imageModel?: string;
}

export const DEFAULT_MODELS = {
  openai: "gpt-4.1-mini",
  openrouter: "openai/gpt-4.1-mini",
  anthropic: "claude-haiku-5-5",
  openaiImage: "gpt-image-1",
  falImage: "fal-ai/flux/schnell",
  openaiVoice: "gpt-4o-mini-tts",
  elevenlabsVoice: "eleven_multilingual_v2",
};

/** Hosts the backend may contact for AI requests and result downloads. */
export const AI_HOSTS = ["api.openai.com", "openrouter.ai", "api.anthropic.com", "fal.run", "queue.fal.run", "fal.media", "api.elevenlabs.io"];

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

/** First provider that has a key, in a sensible order. */
export function llmProvider(k: Partial<AiKeys>): LlmProvider | null {
  if (k.anthropic) return "anthropic";
  if (k.openai) return "openai";
  if (k.openrouter) return "openrouter";
  return null;
}
export const imageProvider = (k: Partial<AiKeys>): ImageProvider | null => (k.fal ? "fal" : k.openai ? "openai" : null);
export const voiceProviders = (k: Partial<AiKeys>): VoiceProvider[] => [...(k.elevenlabs ? ["elevenlabs" as const] : []), ...(k.openai ? ["openai" as const] : [])];

export function chatRequest(provider: LlmProvider, k: Partial<AiKeys>, system: string, user: string, maxTokens = 2000): HttpRequest {
  const json = { "Content-Type": "application/json" };
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { ...json, "x-api-key": k.anthropic!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: k.llmModel || DEFAULT_MODELS.anthropic, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    };
  }
  const openrouter = provider === "openrouter";
  return {
    url: openrouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
    method: "POST",
    headers: { ...json, Authorization: `Bearer ${openrouter ? k.openrouter : k.openai}`, ...(openrouter ? { "X-Title": "Clipmaster" } : {}) },
    body: JSON.stringify({
      model: k.llmModel || (openrouter ? DEFAULT_MODELS.openrouter : DEFAULT_MODELS.openai),
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function chatText(provider: LlmProvider, json: any): string {
  if (json?.error) throw new Error(typeof json.error === "string" ? json.error : json.error.message ?? "AI request failed");
  if (provider === "anthropic") return (json?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return json?.choices?.[0]?.message?.content ?? "";
}

/** Pull the first JSON value out of a model reply (handles ```json fences and chatter). */
export function extractJson<T = any>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("The AI reply had no data in it.");
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("The AI reply was cut off.");
}

// ---------------------------------------------------------------- images

export type ImageSize = "square" | "landscape" | "portrait";

export function imageRequest(provider: ImageProvider, k: Partial<AiKeys>, prompt: string, size: ImageSize, transparent = false): HttpRequest {
  if (provider === "openai") {
    const dims = size === "square" ? "1024x1024" : size === "landscape" ? "1536x1024" : "1024x1536";
    return {
      url: "https://api.openai.com/v1/images/generations",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.openai}` },
      body: JSON.stringify({ model: k.imageModel || DEFAULT_MODELS.openaiImage, prompt, size: dims, n: 1, ...(transparent ? { background: "transparent", output_format: "png" } : {}) }),
    };
  }
  const image_size = size === "square" ? "square_hd" : size === "landscape" ? "landscape_16_9" : "portrait_16_9";
  const model = k.imageModel && k.imageModel.startsWith("fal-ai/") ? k.imageModel : DEFAULT_MODELS.falImage;
  return {
    url: `https://fal.run/${model}`,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${k.fal}` },
    body: JSON.stringify({ prompt: transparent ? `${prompt}, isolated on a plain white background, sticker style` : prompt, image_size, num_images: 1 }),
  };
}

/** Either base64 PNG data or a URL to download. */
export function imageResult(provider: ImageProvider, json: any): { b64?: string; url?: string } {
  if (json?.error) throw new Error(json.error.message ?? String(json.error));
  if (provider === "openai") {
    const d = json?.data?.[0];
    if (!d) throw new Error("No image returned.");
    return d.b64_json ? { b64: d.b64_json } : { url: d.url };
  }
  const img = json?.images?.[0];
  if (!img?.url) throw new Error(json?.detail?.[0]?.msg ?? "No image returned.");
  if (img.url.startsWith("data:")) return { b64: img.url.split(",")[1] };
  return { url: img.url };
}

// ---------------------------------------------------------------- voices

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
/** A few of ElevenLabs' default library voices (any voice id from the user's account also works). */
export const ELEVEN_VOICES: { id: string; name: string }[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
];

export function speechRequest(provider: VoiceProvider, k: Partial<AiKeys>, text: string, voice: string, instructions?: string): HttpRequest {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/audio/speech",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.openai}` },
      body: JSON.stringify({ model: DEFAULT_MODELS.openaiVoice, voice: voice || "coral", input: text, response_format: "mp3", ...(instructions ? { instructions } : {}) }),
    };
  }
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice || ELEVEN_VOICES[0].id)}?output_format=mp3_44100_128`,
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": k.elevenlabs!, Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: DEFAULT_MODELS.elevenlabsVoice }),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- transcript helpers

export interface Sentence {
  start: number;
  end: number;
  text: string;
  /** Index of the first word. */
  first: number;
  last: number;
}

/** Split word captions into sentences (punctuation or pauses). */
export function sentences(words: CaptionWord[], maxWords = 30): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const end = !next || /[.!?]["')\]]?$/.test(w.text) || next.start - w.end > 0.8 || i - first + 1 >= maxWords;
    if (end) {
      out.push({ start: words[first].start, end: w.end, text: words.slice(first, i + 1).map((x) => x.text).join(" ").trim(), first, last: i });
      first = i + 1;
    }
  }
  return out;
}

/** "[12.3] text" lines the model can quote times from. */
export function timedTranscript(s: Sentence[], maxChars = 24000): string {
  const lines = s.map((x) => `[${x.start.toFixed(1)}-${x.end.toFixed(1)}] ${x.text}`);
  let out = "";
  for (const l of lines) {
    if (out.length + l.length > maxChars) break;
    out += l + "\n";
  }
  return out;
}

// ---------------------------------------------------------------- prompts

export interface ClipIdea {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
}

export const VIRAL_SYSTEM =
  "You are an expert short-form video editor (TikTok, Reels, Shorts). You find the moments in long videos that work as stand-alone viral clips: a strong hook in the first seconds, one clear idea, a payoff, and no missing context. Reply with JSON only.";

export function viralPrompt(transcript: string, count = 5, min = 20, max = 60): string {
  return `Here is a timed transcript (seconds):\n\n${transcript}\nFind the ${count} best clips, each ${min}-${max} seconds long, starting and ending on sentence boundaries from the transcript. Return a JSON array, best first:\n[{"start": number, "end": number, "title": "short catchy title", "hook": "on-screen hook text, max 8 words", "score": 1-100, "reason": "why it works, one sentence"}]`;
}

export function parseClipIdeas(raw: unknown, duration: number): ClipIdea[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { clips?: unknown[] })?.clips) ? (raw as { clips: unknown[] }).clips : [];
  return arr
    .map((x) => x as Partial<ClipIdea>)
    .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end))
    .map((x) => ({
      start: Math.max(0, Number(x.start)),
      end: Math.min(duration, Number(x.end)),
      title: String(x.title ?? "Clip").slice(0, 80),
      hook: String(x.hook ?? "").slice(0, 80),
      score: Math.max(0, Math.min(100, Math.round(Number(x.score) || 0))),
      reason: String(x.reason ?? "").slice(0, 200),
    }))
    .filter((x) => x.end - x.start >= 3)
    .sort((a, b) => b.score - a.score);
}

export interface PublishKit {
  titles: string[];
  description: string;
  hashtags: string[];
  hook: string;
}

export const PUBLISH_SYSTEM = "You write titles, descriptions and hashtags for online videos that get clicks without being misleading. Reply with JSON only.";

export function publishPrompt(transcript: string, platform: string): string {
  return `Video transcript:\n\n${transcript}\nWrite publishing text for ${platform}. Return JSON: {"titles": ["5 title options"], "description": "2-4 sentences", "hashtags": ["8-12 hashtags without #"], "hook": "on-screen hook for the first 2 seconds, max 8 words"}`;
}

export function parsePublishKit(raw: unknown): PublishKit {
  const r = (raw ?? {}) as Partial<PublishKit>;
  return {
    titles: (Array.isArray(r.titles) ? r.titles : []).map(String).slice(0, 8),
    description: String(r.description ?? ""),
    hashtags: (Array.isArray(r.hashtags) ? r.hashtags : []).map((h) => String(h).replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 15),
    hook: String(r.hook ?? ""),
  };
}

export const BROLL_SYSTEM = "You pick stock-footage search terms for B-roll. Terms must be visual and concrete (2-4 words, things a camera can film). Reply with JSON only.";

export function brollPrompt(items: { id: number; context: string }[]): string {
  return `For each moment, give one stock video search phrase that shows what is being talked about.\n\n${items.map((x) => `${x.id}: ${x.context}`).join("\n")}\n\nReturn JSON: [{"id": number, "query": "search phrase"}]`;
}

export function parseQueries(raw: unknown): Map<number, string> {
  const m = new Map<number, string>();
  if (!Array.isArray(raw)) return m;
  for (const x of raw as { id?: unknown; query?: unknown }[]) {
    const q = String(x?.query ?? "").trim();
    if (Number.isFinite(Number(x?.id)) && q) m.set(Number(x.id), q.slice(0, 60));
  }
  return m;
}

export const TRANSLATE_SYSTEM = "You translate video subtitles. Keep the meaning and tone, keep lines short and natural to speak. Reply with JSON only.";

export function translatePrompt(lines: string[], language: string): string {
  return `Translate each line to ${language}. Return a JSON array of strings with exactly ${lines.length} items, same order.\n\n${JSON.stringify(lines)}`;
}

export function parseTranslation(raw: unknown, n: number): string[] {
  if (!Array.isArray(raw) || raw.length !== n) throw new Error("The translation came back with the wrong number of lines. Try again.");
  return raw.map((x) => String(x));
}

/** Spread a translated sentence over its time span as word captions. */
export function respread(text: string, start: number, end: number): CaptionWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  let t = start;
  return words.map((w) => {
    const d = ((end - start) * (w.length + 1)) / total;
    const out = { text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return out;
  });
}

export const LANGUAGES = ["Spanish", "Portuguese", "French", "German", "Italian", "Hindi", "Japanese", "Korean", "Chinese (Simplified)", "Arabic", "Indonesian", "Turkish", "Russian", "English"];
