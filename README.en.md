# Viral AI Tool

A Windows-first Electron desktop app for AI video workflows.

## Languages

The app currently supports:
- Vietnamese
- English

Use the `VI / EN` switch in the top bar. The selected language is persisted between sessions.

## Typography

Viral AI Tool uses the Windows system font stack for reliable Vietnamese diacritics:

- Segoe UI Variable Text
- Segoe UI Variable
- Segoe UI
- Noto Sans
- Arial

No runtime font download is required.

## Run the app

```powershell
npm install
npm start
```

## Build the Windows installer

```powershell
npm run dist
```

Build output is written to:

```text
release\
```

## Current prototype

- Dashboard
- Download Studio
- Channel Monitor
- AI Video
- Voice Studio
- Video Editor
- Automation
- Library
- Social Accounts
- Usage & Credits
- Settings
- Native multi-video picker
- Drag and drop
- Output folder selection
- Simulated queue and render progress
- Full VI / EN interface switch

## Next milestone

- FFmpeg engine
- real video metadata
- thumbnail and preview generation
- real MP4 rendering
- speech-to-text
- translation
- AI voice
- subtitle pipeline
- automation worker
