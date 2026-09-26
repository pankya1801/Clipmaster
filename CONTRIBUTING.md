# Contributing to Clipmaster

Thanks for helping build a free video editor for everyone! 🎬

## Getting set up

1. Install [Node 20+](https://nodejs.org), [Rust](https://rustup.rs), FFmpeg, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
2. `npm install`
3. `npm run tauri dev` to run the app, or `npm run dev` for the browser-only UI.

## Before you open a pull request

- `npm run typecheck` and `npm test` pass (the tests render real videos with FFmpeg)
- `cargo test --manifest-path src-tauri/Cargo.toml` passes if you touched Rust
- New editing logic lives in `src/core/` as pure functions **with tests**
- Anything that affects export should have a real-render test in `tests/features.test.ts`
- Add yourself to `AUTHORS`

## Good places to start

- **New effect:** add an entry to `EFFECTS` in `src/core/effects.ts` (an FFmpeg filter plus an optional CSS preview). The test suite renders every effect automatically.
- **New caption template:** add one line to `CAPTION_TEMPLATES` in `src/core/captions.ts`.
- **Translations, docs, bug reports with sample files:** all very welcome.

## Code style

Match the surrounding code: TypeScript strict mode, small pure functions, and comments that explain *why* rather than *what*.

## License

By contributing you agree your work is released under the [MIT License](LICENSE), with copyright held by "The Clipmaster Authors".
