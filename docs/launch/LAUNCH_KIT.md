# Clipmaster launch kit

Everything needed to launch Clipmaster publicly. **Do these in order.** Nothing here is posted automatically.

## 1. Before going public (checklist)

- [ ] Test the installers on Windows and macOS (Actions → Release → Run workflow; this creates a draft release)
- [ ] Test auto captions: Settings → download "Base · English" → Captions → ✨ Auto captions
- [ ] Publish the draft release (tag `v0.2.0`)
- [ ] Make the repo public: Settings → General → Danger zone → Change visibility
- [ ] Repo **About** box (the ⚙ icon on the repo home page):
  - Description: `Free, open-source video editor: animated captions, Auto Edit, 43 effects, 4K export. No watermark, no subscription, works offline.`
  - Website: `https://pankya1801.github.io/Clipmaster/`
  - Topics: `video-editor` `video-editing` `capcut-alternative` `filmora-alternative` `tauri` `ffmpeg` `whisper` `captions` `subtitles` `reels` `tiktok` `youtube-shorts` `open-source` `desktop-app` `react` `rust`
- [ ] Turn on GitHub Pages: Settings → Pages → Deploy from branch → `main` / `/docs`
- [ ] Upload a social preview image: Settings → General → Social preview → `docs/screenshots/editor.png`
- [ ] Turn on Discussions (Settings → Features) so users can ask questions without opening issues
- [ ] Create 5–10 **good first issue** issues (ideas below) so contributors have somewhere to start

**Good first issue ideas:** a new caption template, a new color look, an "export as GIF" option, a keyboard shortcut cheat-sheet window, translating the UI, an "export audio only (MP3)" option.

## 2. Launch day plan

| When | Where | Notes |
|---|---|---|
| Tue–Thu, 8–10am US Eastern | **Hacker News**: Show HN | Post yourself; answer every comment in the first 2 hours |
| Same day | **Reddit** | One subreddit per hour, never cross-post the same text |
| Same day | **X / Twitter, LinkedIn** | Thread with the screenshots and a short screen recording |
| +1 week | **Product Hunt** | Needs a gallery (use `docs/screenshots`) and a 30–60 s demo video |
| Ongoing | **YouTube** | "I made a free CapCut alternative" and before/after Auto Edit videos |
| Ongoing | Lists | Open PRs to `awesome-selfhosted`-style lists: awesome-tauri, awesome-video, awesome-open-source alternatives (e.g. opensourcealternative.to, alternativeto.net) |

Tips:
- Record a **30-second screen capture**: raw talking clip → ✨ Auto Edit → captions appear → export. That single video sells the project better than any text.
- Be honest about what's missing (for example "no mobile app yet"). Communities reward honesty.
- Reply to feedback with fixes. "Fixed in v0.2.1, thanks!" builds momentum.

## 3. Ready-to-post texts

### Hacker News

**Title:** Show HN: Clipmaster – a free, open-source desktop video editor with offline auto-captions

**Text:**
> I built Clipmaster because the editors people use for Reels/Shorts increasingly put basics like auto-captions and watermark-free export behind subscriptions, and upload your footage to do it.
>
> Clipmaster is a desktop app (Tauri + React, Rust backend) that does everything locally:
> - 25 animated caption styles (word highlight, karaoke, one-word pop) rendered via libass; auto-captions with whisper.cpp, offline
> - Auto Edit: removes silences from talking videos, or detects the beat of a song and cuts your clips to it
> - 43 effects/transitions, picture-in-picture, keyframes, voice noise reduction, 4K export
>
> The whole project is compiled into a single FFmpeg filter graph for export, and the test suite renders every effect/caption template with real FFmpeg. MIT licensed. I'd love feedback, especially on what's missing for your workflow.
>
> https://github.com/pankya1801/Clipmaster

### Reddit: r/opensource, r/software, r/linux (adapt per sub)

**Title:** I made a free, open-source alternative to CapCut/Filmora: captions, auto-edit, no watermark, runs offline

> Hi all! Clipmaster is a desktop video editor for Windows/macOS/Linux, MIT licensed.
>
> What it does: multi-track editing, 25 animated caption templates + offline auto-captions (whisper.cpp), one-click Auto Edit (cuts silences or cuts to the music beat), 43 effects/transitions, picture-in-picture with keyframes, voice noise reduction, 4K MP4 export with no watermark.
>
> Everything runs on your computer. No account, no uploads.
>
> It's early, so I'd really appreciate bug reports and feature requests: [link]

### Reddit: r/NewTubers, r/PartneredYoutube, r/ContentCreators

(Check each subreddit's self-promotion rules first. Some only allow it in weekly threads.)

**Title:** Made a free editor that auto-captions and cuts out pauses in one click (no watermark, no subscription)

> I got tired of paying for captions and watermark removal, so I built Clipmaster, a free open-source editor. Drop in your talking-head clip, hit ✨ Auto Edit: it removes pauses, adds punch-in zooms on the cuts and generates captions (25 styles, including the yellow-highlight "Hormozi" look). It runs offline, so your videos stay on your computer.
>
> Free download: [link]. Feedback very welcome!

### X / Twitter thread

1. I built a free, open-source video editor for creators 🎬 Animated captions, Auto Edit, 43 effects, 4K export. No watermark. No subscription. Your videos never leave your computer. 🧵 [editor.png]
2. 💬 25 caption styles, including word-by-word highlight, karaoke and one-word pop. Auto-captions run offline with whisper.cpp. [caption-templates.png]
3. ✨ Auto Edit: cuts the pauses out of talking videos, or finds the beat of a song and cuts your clips to it. [auto-edit.png]
4. 🖼 Picture-in-picture with keyframes, voice noise reduction, 9:16 / 1:1 / 4:5 for Reels & Shorts. [pip-keyframes.png]
5. It's MIT-licensed, so nobody can paywall it later. Download free, and ⭐ it if it helps: [link]

### Product Hunt

- **Name:** Clipmaster
- **Tagline:** The free, open-source video editor for creators
- **Description:** Animated captions, one-click Auto Edit, 43 effects and 4K export: no subscription, no watermark, and it works offline. For Reels, Shorts, TikTok and YouTube.
- **First comment:** why you built it, what's next (roadmap from the README), and a request for feedback.

## 4. Keep momentum

- Ship small releases often and post the changelog each time
- Add a "Made with Clipmaster" showcase to the README (user videos)
- Answer issues within a day for the first month
- Thank contributors publicly and add them to `AUTHORS`
