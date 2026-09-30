# Viral AI Tool — Desktop prototype

Viral AI Tool là ứng dụng desktop Electron dành cho workflow video AI. App mở thành cửa sổ Windows riêng, không dùng localhost và không cần Python HTTP server.

## Chạy trên Windows

```powershell
npm install
npm start
```

## Build file cài đặt .exe

```powershell
npm run dist
```

File build nằm trong:

```text
release\
```

## V0.2

- Cửa sổ desktop frameless + Minimize / Maximize / Close
- Dashboard / Download / Channel Monitor / AI Video / Voice Studio
- Video Editor / Automation / Library / Accounts / Usage / Settings
- File picker native của Windows
- Multi-select video
- Drag & drop file từ Windows Explorer
- Queue demo trong app
- Cấu trúc sẵn để nối FFmpeg, speech-to-text, translation, TTS và render worker

## Kiến trúc

- `main.js`: Electron main process / native layer
- `preload.js`: bridge an toàn giữa UI và native APIs
- `renderer/`: giao diện desktop
- bước tiếp theo: `services/ffmpeg`, `services/jobs`, local DB và AI providers
