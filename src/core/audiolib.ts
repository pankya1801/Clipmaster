/**
 * Built-in sound library, synthesised with FFmpeg (no samples, no licences):
 * sound effects for edits and simple royalty-free beats. The app renders a
 * sound to a WAV file once and then uses it like any imported audio.
 */

export interface Sound {
  id: string;
  name: string;
  category: "sfx" | "music";
  /** Seconds. */
  duration: number;
  /** lavfi audio graph (mono or stereo, 48 kHz). */
  graph: string;
}

const sfx = (id: string, name: string, duration: number, graph: string): Sound => ({ id, name, category: "sfx", duration, graph });

/** Drum-machine beat: kick, snare and hats at `bpm` for `bars` 4/4 bars. */
function beat(bpm: number, bars: number, style: "lofi" | "house" | "trap"): string {
  const b = 60 / bpm;
  const dur = bars * 4 * b;
  const kickPattern = style === "house" ? "1" : style === "trap" ? "lt(mod(t/(B/2)\\,8)\\,1)+between(mod(t/(B/2)\\,8)\\,3\\,4)+between(mod(t/(B/2)\\,8)\\,6\\,6.5)" : "lt(mod(t/B\\,4)\\,1)+between(mod(t/B\\,4)\\,2.5\\,3)";
  const kick = `0.9*sin(2*PI*(50+90*exp(-mod(t\\,B)*30))*mod(t\\,B))*exp(-mod(t\\,B)*9)*(${kickPattern})`.replace(/B/g, String(b));
  const snare = `0.35*(random(0)*2-1)*exp(-mod(t-${b}\\,${2 * b})*22)*gte(t\\,${b})`;
  const hatStep = style === "trap" ? b / 4 : b / 2;
  const hat = `0.12*(random(1)*2-1)*exp(-mod(t\\,${hatStep})*80)`;
  const pad = style === "lofi" ? `+0.08*sin(2*PI*220*t)*0.5*(1+sin(2*PI*t/${8 * b}))+0.06*sin(2*PI*277.18*t)+0.05*sin(2*PI*329.63*t)` : style === "house" ? `+0.1*sin(2*PI*110*t)*gte(mod(t\\,${b})\\,${b / 2})` : `+0.12*sin(2*PI*55*t)*exp(-mod(t\\,${4 * b})*1.5)`;
  const lowpass = style === "lofi" ? ",lowpass=f=3500,aecho=0.8:0.6:120:0.2" : "";
  return `aevalsrc='${kick}+${snare}+${hat}${pad}':s=48000:d=${dur.toFixed(3)}${lowpass},volume=0.8`;
}

export const SOUNDS: Sound[] = [
  sfx("whoosh", "Whoosh", 0.8, "anoisesrc=d=0.8:c=pink:a=0.8,highpass=f=300,lowpass=f=5000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.45"),
  sfx("swoosh-fast", "Fast swoosh", 0.4, "anoisesrc=d=0.4:c=white:a=0.6,bandpass=f=2500:w=2000,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.28"),
  sfx("pop", "Pop", 0.15, "aevalsrc='sin(2*PI*(900-4000*t)*t)*exp(-t*40)':s=48000:d=0.15"),
  sfx("ding", "Ding", 1.2, "aevalsrc='0.6*sin(2*PI*1318*t)*exp(-t*3)+0.3*sin(2*PI*2637*t)*exp(-t*5)':s=48000:d=1.2"),
  sfx("click", "Click", 0.05, "aevalsrc='(random(0)*2-1)*exp(-t*300)':s=48000:d=0.05"),
  sfx("boom", "Boom", 1.5, "aevalsrc='0.9*sin(2*PI*(40+60*exp(-t*8))*t)*exp(-t*2.5)':s=48000:d=1.5,lowpass=f=200"),
  sfx("riser", "Riser", 2, "aevalsrc='0.4*sin(2*PI*(200+t*t*400)*t)':s=48000:d=2,afade=t=in:d=1.8"),
  sfx("drop", "Bass drop", 1.5, "aevalsrc='0.8*sin(2*PI*(120*exp(-t*1.5)+35)*t)':s=48000:d=1.5,afade=t=out:st=1:d=0.5"),
  sfx("shutter", "Camera shutter", 0.3, "aevalsrc='(random(0)*2-1)*(exp(-t*60)+0.7*exp(-abs(t-0.12)*80))':s=48000:d=0.3,highpass=f=800"),
  sfx("typing", "Typing", 2, "aevalsrc='(random(0)*2-1)*exp(-mod(t\\,0.11+0.03*sin(t*7))*90)*0.5':s=48000:d=2,highpass=f=1500"),
  sfx("notification", "Notification", 0.6, "aevalsrc='0.5*sin(2*PI*880*t)*lt(t\\,0.15)*exp(-t*10)+0.5*sin(2*PI*1320*t)*gte(t\\,0.15)*exp(-(t-0.15)*8)':s=48000:d=0.6"),
  sfx("glitch", "Glitch", 0.5, "aevalsrc='0.5*sgn(sin(2*PI*(100+800*random(0))*t))*lt(mod(t\\,0.08)\\,0.05)':s=48000:d=0.5"),
  sfx("heartbeat", "Heartbeat", 2, "aevalsrc='0.9*sin(2*PI*55*t)*(exp(-mod(t\\,1)*25)+0.7*exp(-abs(mod(t\\,1)-0.25)*25))':s=48000:d=2"),
  sfx("record-scratch", "Record scratch", 0.6, "aevalsrc='0.5*(random(0)*2-1)*sin(2*PI*6*t)':s=48000:d=0.6,bandpass=f=1800:w=1500"),
  sfx("tada", "Ta-da", 1.5, "aevalsrc='0.35*(sin(2*PI*523.25*t)+sin(2*PI*659.25*t)+sin(2*PI*783.99*t))*(lt(t\\,0.15)+gte(t\\,0.25))*exp(-max(0\\,t-0.25)*2)':s=48000:d=1.5"),
  { id: "beat-lofi", name: "Lo-fi beat (85 BPM)", category: "music", duration: (60 / 85) * 4 * 8, graph: beat(85, 8, "lofi") },
  { id: "beat-house", name: "House beat (122 BPM)", category: "music", duration: (60 / 122) * 4 * 8, graph: beat(122, 8, "house") },
  { id: "beat-trap", name: "Trap beat (140 BPM)", category: "music", duration: (60 / 140) * 4 * 8, graph: beat(140, 8, "trap") },
];

export const soundById = (id: string) => SOUNDS.find((s) => s.id === id);

/** FFmpeg arguments that render a sound to a 48 kHz stereo WAV file. */
export function soundRenderArgs(s: Sound, outPath: string): string[] {
  return ["-v", "error", "-y", "-f", "lavfi", "-i", s.graph, "-t", String(s.duration), "-ac", "2", "-ar", "48000", outPath];
}
