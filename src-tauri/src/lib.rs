mod media;

use std::sync::Mutex;

pub struct ExportState(pub Mutex<Option<u32>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            media::ffmpeg_status,
            media::probe_media,
            media::thumbnail,
            media::export_video,
            media::cancel_export,
            media::temp_dir,
            media::read_text_file,
            media::write_text_file,
            media::detect_silence,
            media::transcribe,
            media::fonts_dir,
            media::whisper_models,
            media::download_model,
            media::audio_envelope,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Clipmaster");
}
