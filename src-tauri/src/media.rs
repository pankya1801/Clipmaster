use base64::Engine;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};

use crate::ExportState;

/// Resolve an FFmpeg tool: `CLIPMASTER_FFMPEG_DIR`, then next to the app, then PATH.
fn tool(name: &str) -> PathBuf {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    if let Ok(dir) = std::env::var("CLIPMASTER_FFMPEG_DIR") {
        let p = PathBuf::from(dir).join(&exe);
        if p.exists() {
            return p;
        }
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        let p = dir.join(&exe);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(exe)
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
        let mut cmd = Command::new(&whisper_bin);
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
    fn thumbnail_is_jpeg_data_url() {
        let Some(v) = fixture("cm_thumb.mp4", &["-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-pix_fmt", "yuv420p"]) else { return };
        let url = tauri::async_runtime::block_on(thumbnail(v, 0.5)).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }
}
