# Viral AI Tool

A Windows-first Electron desktop app for AI-powered video localization workflows.

**Current version:** `0.14.0`

## Languages

The app supports:

- Vietnamese
- English

Use the `VI / EN` switch in the top bar. The selected language is persisted between sessions.

## Main workflow

Viral AI Tool currently supports:

- local video import
- speech recognition
- translation
- AI voice
- per-segment timing fit
- original audio background mix
- burned subtitles
- H.264 / AAC MP4 export
- progress / cancel / retry
- Local / Cloud workflows
- account and session management
- Free / Creator / Creator Pro / Business plans
- quota/concurrency/model entitlement enforcement
- subscription lifecycle and billing core
- Usage & Credits
- verified Windows updater

## Run development

```powershell
npm ci
npm start
```

Development backend:

```powershell
npm run dev:backend
```

## Build the Windows installer

```powershell
npm run dist
```

Build output:

```text
release\
```

## Release and production

The production backend baseline includes:

- SQLite durable state
- hashed refresh sessions
- device/session revocation
- audit logging
- rate limiting
- idempotency/restart recovery
- graceful shutdown

The Windows release pipeline includes:

- branded application icon
- NSIS installer
- application startup smoke test
- SHA-256 checksums
- release manifest
- verified updater
- Authenticode guard for Stable tags
- tag/version/master commit validation

See:

- `CHANGELOG.md`
- `docs/PRODUCTION_BACKEND.md`
- `docs/RELEASE_CHECKLIST.md`

## Typography

Viral AI Tool uses the Windows system font stack for reliable Vietnamese rendering:

- Segoe UI Variable Text
- Segoe UI Variable
- Segoe UI
- Noto Sans
- Arial

No runtime font download is required.

## v0.14.0 status

`0.14.0` is the production-hardening/release baseline.

A public Stable paid launch should wait until:

1. Windows code-signing credentials are configured;
2. the production backend is deployed behind HTTPS;
3. a real billing provider is connected;
4. the installer is smoke-tested on a clean Windows user machine.
