use base64::Engine;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};

use crate::ExportState;

/// Resolve a helper program. Order: `CLIPMASTER_FFMPEG_DIR`, the copy bundled
/// next to the app (`clipmaster-<name>`, prefixed so Linux packages don't clash
/// with system FFmpeg in /usr/bin), then `<name>` on PATH.
fn tool(name: &str) -> PathBuf {
    let exe = |n: &str| if cfg!(windows) { format!("{n}.exe") } else { n.to_string() };
    if let Ok(dir) = std::env::var("CLIPMASTER_FFMPEG_DIR") {
        let p = PathBuf::from(dir).join(exe(name));
        if p.exists() {
            return p;
        }
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        let p = dir.join(exe(&format!("clipmaster-{name}")));
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(exe(name))
}

fn command(name: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(tool(name));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

#[derive(Serialize)]
pub struct FfmpegStatus {
    ffmpeg: Option<String>,
    ffprobe: Option<String>,
}

fn version(name: &str) -> Option<String> {
    let out = command(name).arg("-version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).lines().next().map(|s| s.to_string())
}

#[tauri::command]
pub fn ffmpeg_status() -> FfmpegStatus {
    FfmpegStatus { ffmpeg: version("ffmpeg"), ffprobe: version("ffprobe") }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    kind: String,
    duration: f64,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"];

#[tauri::command]
pub async fn probe_media(path: String) -> Result<ProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn probe_blocking(path: &str) -> Result<ProbeResult, String> {
    let out = command("ffprobe")
        .args(["-v", "error", "-show_format", "-show_streams", "-of", "json", path])
        .output()
        .map_err(|e| format!("ffprobe not found ({e}). Install FFmpeg to import media."))?;
    if !out.status.success() {
        return Err(format!("Unsupported file: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let streams = json["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| {
        s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0
    });
    let has_audio = streams.iter().any(|s| s["codec_type"] == "audio");
    let duration = json["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    let ext = PathBuf::from(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let kind = if IMAGE_EXT.contains(&ext.as_str()) {
        "image"
    } else if video.is_some() {
        "video"
    } else if has_audio {
        "audio"
    } else {
        return Err("File has no audio or video".into());
    };
    Ok(ProbeResult {
        kind: kind.into(),
        duration,
        width: video.and_then(|v| v["width"].as_u64()).map(|v| v as u32),
        height: video.and_then(|v| v["height"].as_u64()).map(|v| v as u32),
        has_audio: has_audio && kind != "image",
    })
}

/// Small JPEG poster frame as a data URL.
#[tauri::command]
pub async fn thumbnail(path: String, at: f64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = command("ffmpeg")
            .args(["-v", "error", "-ss", &format!("{at:.3}"), "-i", &path, "-frames:v", "1"])
            .args(["-vf", "scale=240:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() || out.stdout.is_empty() {
            return Err("no frame".into());
        }
        Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.stdout)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
pub struct PlanFile {
    path: String,
    content: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    seconds: f64,
}

#[tauri::command]
pub async fn export_video(
    app: AppHandle,
    state: State<'_, ExportState>,
    args: Vec<String>,
    files: Vec<PlanFile>,
) -> Result<(), String> {
    for f in &files {
        std::fs::write(&f.path, &f.content).map_err(|e| format!("write {}: {e}", f.path))?;
    }
    let mut child = command("ffmpeg")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start FFmpeg ({e}). Is it installed?"))?;
    *state.0.lock().unwrap() = Some(child.id());

    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let result = tauri::async_runtime::spawn_blocking(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                if let Ok(us) = v.trim().parse::<f64>() {
                    let _ = app.emit("export-progress", Progress { seconds: us / 1e6 });
                }
            }
        }
        child.wait()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let cancelled = state.0.lock().unwrap().take().is_none();
    let stderr = err_reader.join().unwrap_or_default();
    for f in &files {
        let _ = std::fs::remove_file(&f.path);
    }
    if result.success() {
        Ok(())
    } else if cancelled {
        Err("Export cancelled".into())
    } else {
        let tail: Vec<&str> = stderr.lines().rev().take(8).collect();
        Err(tail.into_iter().rev().collect::<Vec<_>>().join("\n"))
    }
}

#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>) -> Result<(), String> {
    if let Some(pid) = state.0.lock().unwrap().take() {
        kill(pid);
    }
    Ok(())
}

fn kill(pid: u32) {
    #[cfg(windows)]
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    #[cfg(not(windows))]
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
}

#[tauri::command]
pub fn temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// Run FFmpeg `silencedetect` on a file's audio; returns FFmpeg's log for parsing.
#[tauri::command]
pub async fn detect_silence(path: String, noise_db: f64, min_duration: f64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let filter = format!("silencedetect=noise={noise_db}dB:d={min_duration}");
        let out = command("ffmpeg")
            .args(["-hide_banner", "-nostats", "-i", &path, "-vn", "-af", &filter, "-f", "null", "-"])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stderr).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Transcribe `path` between `start` and `end` (source seconds) with a local
/// whisper.cpp binary. Returns word-level SRT relative to `start`.
#[tauri::command]
pub async fn transcribe(
    path: String,
    start: f64,
    end: f64,
    whisper_bin: String,
    model: String,
    language: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tmp = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let wav = tmp.join(format!("clipmaster_{stamp}.wav"));
        let base = tmp.join(format!("clipmaster_{stamp}"));
        let ok = command("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{start:.3}"), "-to", &format!("{end:.3}"), "-i", &path])
            .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
            .arg(&wav)
            .status()
            .map_err(|e| e.to_string())?;
        if !ok.success() {
            return Err("Could not extract audio for transcription".into());
        }
        // Empty path = the whisper-cli bundled with Clipmaster (or on PATH).
        let mut cmd = if whisper_bin.trim().is_empty() { command("whisper-cli") } else { Command::new(&whisper_bin) };
        cmd.args(["-m", &model, "-f"]).arg(&wav);
        cmd.args(["-osrt", "-ml", "1", "-sow", "-np", "-l", if language.is_empty() { "auto" } else { &language }]);
        cmd.arg("-of").arg(&base);
        let out = cmd.output().map_err(|e| format!("Could not run whisper ({e}). Check the path in Settings."));
        let _ = std::fs::remove_file(&wav);
        let out = out?;
        if !out.status.success() {
            return Err(format!("whisper failed: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")));
        }
        let srt_path = base.with_extension("srt");
        let srt = std::fs::read_to_string(&srt_path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&srt_path);
        Ok(srt)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct WhisperModel {
    name: &'static str,
    label: &'static str,
    size_mb: u32,
    path: Option<String>,
}

const MODELS: &[(&str, &str, u32)] = &[
    ("tiny.en", "Tiny · English · fastest", 75),
    ("base.en", "Base · English · recommended", 142),
    ("base", "Base · 99 languages", 142),
    ("small", "Small · 99 languages · most accurate", 466),
];

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn whisper_models(app: AppHandle) -> Result<Vec<WhisperModel>, String> {
    let dir = models_dir(&app)?;
    Ok(MODELS
        .iter()
        .map(|(name, label, size_mb)| {
            let p = dir.join(format!("ggml-{name}.bin"));
            WhisperModel { name, label, size_mb: *size_mb, path: p.exists().then(|| p.to_string_lossy().into_owned()) }
        })
        .collect())
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    received: u64,
    total: u64,
}

/// Download a whisper.cpp model into the app data folder; returns its path.
#[tauri::command]
pub async fn download_model(app: AppHandle, name: String) -> Result<String, String> {
    if !MODELS.iter().any(|(n, _, _)| *n == name) {
        return Err("Unknown model".into());
    }
    let dir = models_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin");
        let resp = ureq::get(&url).call().map_err(|e| format!("Download failed: {e}"))?;
        let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let part = dir.join(format!("ggml-{name}.bin.part"));
        let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; 1 << 16];
        let (mut received, mut last) = (0u64, 0u64);
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| e.to_string())?;
            received += n as u64;
            if received - last > 1 << 20 {
                last = received;
                let _ = app.emit("model-progress", DownloadProgress { received, total });
            }
        }
        if total > 0 && received != total {
            let _ = std::fs::remove_file(&part);
            return Err("Download incomplete, please try again".into());
        }
        let dest = dir.join(format!("ggml-{name}.bin"));
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
        Ok(dest.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Directory with the bundled caption fonts.
#[tauri::command]
pub fn fonts_dir(app: AppHandle) -> Option<String> {
    use tauri::Manager;
    let bundled = app.path().resource_dir().ok().map(|d| d.join("fonts"));
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fonts");
    [bundled, Some(dev)]
        .into_iter()
        .flatten()
        .find(|p| p.join("OFL.txt").exists())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, args: &[&str]) -> Option<String> {
        let path = std::env::temp_dir().join(name);
        let ok = command("ffmpeg").args(["-v", "error", "-y"]).args(args).arg(&path).status().ok()?.success();
        ok.then(|| path.to_string_lossy().into_owned())
    }

    #[test]
    fn probes_video_audio_and_image() {
        let Some(v) = fixture("cm_probe.mp4", &["-f", "lavfi", "-i", "testsrc=s=320x240:d=2", "-f", "lavfi", "-i", "sine=d=2", "-shortest", "-pix_fmt", "yuv420p"]) else {
            eprintln!("ffmpeg not installed; skipping");
            return;
        };
        let r = probe_blocking(&v).unwrap();
        assert_eq!(r.kind, "video");
        assert_eq!((r.width, r.height), (Some(320), Some(240)));
        assert!(r.has_audio && (r.duration - 2.0).abs() < 0.2);

        let a = fixture("cm_probe.mp3", &["-f", "lavfi", "-i", "sine=d=1"]).unwrap();
        assert_eq!(probe_blocking(&a).unwrap().kind, "audio");
        let i = fixture("cm_probe.png", &["-f", "lavfi", "-i", "color=red:s=64x64", "-frames:v", "1"]).unwrap();
        let img = probe_blocking(&i).unwrap();
        assert_eq!(img.kind, "image");
        assert!(!img.has_audio);
    }

    #[test]
    fn detects_silence() {
        // 1s tone, 2s silence, 1s tone
        let Some(p) = fixture("cm_silence.wav", &["-f", "lavfi", "-i", "sine=d=1,apad=pad_dur=2,aloop=0", "-f", "lavfi", "-i", "sine=d=1", "-filter_complex", "[0][1]concat=n=2:v=0:a=1"]) else {
            return;
        };
        let log = tauri::async_runtime::block_on(detect_silence(p, -35.0, 0.5)).unwrap();
        assert!(log.contains("silence_start"), "{log}");
        assert!(log.contains("silence_end"), "{log}");
    }

    #[test]
    fn envelope_has_one_value_per_hop_and_sees_clicks() {
        let Some(p) = fixture("cm_clicks.wav", &["-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,0.5),0.03),0.8*sin(2*PI*1000*t),0)':d=4"]) else { return };
        let env = envelope_blocking(&p, 0.0, 4.0).unwrap();
        let expected = (4.0 * ENVELOPE_RATE as f64 / ENVELOPE_HOP as f64).ceil() as usize;
        assert!((env.len() as i64 - expected as i64).abs() <= 2, "{} vs {expected}", env.len());
        let max = env.iter().cloned().fold(0.0, f32::max);
        let quiet = env.iter().filter(|v| **v < max * 0.05).count();
        assert!(quiet > env.len() / 2, "clicks should be sparse");
    }

    #[test]
    fn thumbnail_is_jpeg_data_url() {
        let Some(v) = fixture("cm_thumb.mp4", &["-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-pix_fmt", "yuv420p"]) else { return };
        let url = tauri::async_runtime::block_on(thumbnail(v, 0.5)).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }
}

/// Loudness envelope for beat detection: RMS per 512-sample hop of mono
/// 22.05 kHz audio between `start` and `end` (source seconds).
#[tauri::command]
pub async fn audio_envelope(path: String, start: f64, end: f64) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || envelope_blocking(&path, start, end))
        .await
        .map_err(|e| e.to_string())?
}

pub const ENVELOPE_RATE: u32 = 22_050;
pub const ENVELOPE_HOP: usize = 512;

fn envelope_blocking(path: &str, start: f64, end: f64) -> Result<Vec<f32>, String> {
    let out = command("ffmpeg")
        .args(["-v", "error", "-ss", &format!("{start:.3}"), "-to", &format!("{end:.3}"), "-i", path])
        .args(["-vn", "-ac", "1", "-ar", &ENVELOPE_RATE.to_string(), "-f", "f32le", "-"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Could not read audio: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let samples: Vec<f32> = out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    Ok(samples
        .chunks(ENVELOPE_HOP)
        .map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).sqrt())
        .collect())
}
