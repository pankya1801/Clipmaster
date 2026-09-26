<p align="center"><img src="src-tauri/icons/128x128.png" width="96" alt="Clipmaster logo"></p>

<h1 align="center">Clipmaster</h1>

<p align="center"><b>A free, open-source desktop video editor.</b><br>
Everything you pay CapCut Pro or Filmora for, with no subscription, no watermark and no account.</p>

---

## Features

| | |
|---|---|
| **Timeline editing** | Multi-track video, audio and text. Trim, split, move and snap clips, ripple delete, duplicate, and unlimited undo/redo. |
| **Any format** | 16:9, 9:16 (Reels / Shorts / TikTok), 1:1, 4:5, 720p–4K, 24–60 fps. |
| **25 caption templates** | Word-by-word highlight, karaoke, one-word pop, neon, boxed, typewriter and more. Captions are rendered with real outlines and animations. |
| **Auto captions** | Runs [whisper.cpp](https://github.com/ggml-org/whisper.cpp) locally, so your audio never leaves your computer. One-click model download; you can also import or export SRT files. |
| **Picture-in-picture** | Position, scale, rotation and opacity for any clip. Drag it in the preview, or use the corner presets. |
| **32 effects** | Color grading (cinematic teal & orange, vintage, noir, warm/cool…), stylize (vignette, film grain, glitch, RGB split, pixelate…) and motion (Ken Burns, slow zoom, punch-in, camera shake). |
| **11 transitions** | Cross dissolve, fade, flash, four slides, zoom pop, blur in, fade out, dip to white. |
| **✨ Auto Edit** | One click removes silences and pauses, hides jump cuts with punch-in zooms, adds captions and applies a color look. |
| **Audio** | Per-clip volume (0–200%), fade in and out, speed 0.25×–4× with pitch-correct audio, and track mute. |
| **Export** | MP4 (H.264/AAC) with progress and cancel. No watermark, no limits. |
| **Safe** | Project files (`.clipmaster`), autosave and crash recovery. |

## Install (users)

Download the installer for your system from the **Releases** page and run it. FFmpeg and whisper.cpp come bundled, so there is nothing else to set up.

- **Windows:** `.msi` or `-setup.exe`
- **macOS:** `.dmg` for Apple Silicon (`aarch64`) or Intel (`x64`). The app isn't notarized yet, so right-click → **Open** the first time.
- **Linux:** `.deb`, `.rpm` or `.AppImage`

**Auto captions:** open **⚙ Settings → Auto captions** and download a model once (75–466 MB). After that, captions work offline.

## Develop

Requirements: [Node 20+](https://nodejs.org), [Rust](https://rustup.rs), FFmpeg on your `PATH`, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS. For auto captions in development, put `whisper-cli` on your `PATH` or set its path in Settings.

```bash
npm install
npm run tauri dev      # run the desktop app with hot reload
npm test               # unit tests + real FFmpeg render tests
npm run typecheck
npm run tauri build    # build an installer for your OS (uses FFmpeg from PATH)

# Build an installer with FFmpeg + whisper.cpp bundled (what releases use):
scripts/fetch-sidecars.sh x86_64-unknown-linux-gnu   # or your target triple
npm run tauri build -- --config src-tauri/tauri.bundle.conf.json
```

Pushing a tag like `v0.2.0` runs the Release workflow, which builds installers for all platforms as a draft GitHub release.

`npm run dev` also opens the editor in a normal browser for quick UI work. Import there is temporary and export is disabled.

### How it works

```
src/core/        Pure TypeScript, fully unit-tested
  project.ts     Timeline model and edit operations (trim, split, move, ripple…)
  ffmpeg.ts      Turns a project into one FFmpeg filter graph for export
  effects.ts     Effect and transition catalogue (FFmpeg filters + CSS preview)
  captions.ts    Caption templates → ASS subtitles (libass), SRT import/export
  autoedit.ts    Silence detection and jump-cut logic
src/components/  React UI (preview, timeline, panels, dialogs)
src-tauri/       Rust backend: ffprobe, thumbnails, export runner, whisper
src-tauri/fonts  Caption fonts (SIL Open Font License)
```

The preview plays your media directly and approximates effects with CSS. Export renders everything exactly with FFmpeg.

## Roadmap

- Keyframe animation for position, scale and opacity
- Stickers, overlays and LUT import
- Beat-synced auto edit for music videos
- Background removal and noise reduction

## Contributing

Pull requests are welcome. Run `npm test` and `npm run typecheck` before opening one, and add yourself to `AUTHORS`.

## License

[MIT](LICENSE) © 2026 The Clipmaster Authors.

Third-party components shipped with the installers keep their own licenses: FFmpeg ([GPL](https://ffmpeg.org/legal.html), run as a separate program; builds from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) and [martin-riedl.de](https://ffmpeg.martin-riedl.de)), [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) and the caption fonts ([SIL Open Font License](src-tauri/fonts/OFL.txt)). Their license texts are included in the app bundle.
