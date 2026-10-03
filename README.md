[Tiếng Việt](README.vi.md) · [English](README.en.md)

# Viral AI Tool

Viral AI Tool là ứng dụng desktop Windows bằng Electron dành cho quy trình localize video bằng AI: nhận diện lời nói, dịch, AI voice, căn timeline, mix audio, subtitle và xuất MP4.

**Phiên bản hiện tại:** `0.14.0`

## Trạng thái hiện tại

Các phần nền tảng chính đã hoạt động:

- Desktop UI/UX và workflow Local / Cloud
- Cloud account, secure session và quản lý thiết bị đăng nhập
- Free / Creator / Creator Pro / Business entitlements
- Quota, concurrency và model-tier enforcement
- Subscription lifecycle + billing core
- Cloud Speech / Translation / AI Voice
- Localized render pipeline:
  - timing fit
  - AI voice mix
  - original audio background
  - burn subtitle
  - H.264 / AAC MP4
- Durable production backend baseline với SQLite
- Audit log, rate limit, idempotency và restart recovery
- Verified Windows updater với SHA-256
- Windows NSIS build, installer smoke-test và release CI
- Provider-neutral billing readiness contract cho Stable release
- One-command source release preflight: `npm run release:preflight`

## Chạy development trên Windows

```powershell
npm ci
npm start
```

Backend development:

```powershell
npm run dev:backend
```

## Build Windows installer

```powershell
npm run dist
```

Artifact được tạo trong:

```text
release\
```

## Kiểm thử

```powershell
npm run test:backend-state
npm run test:backend-restart
npm run test:backend-production
npm run test:release-policy
npm run test:release-assets
npm run test:release-readiness
npm run test:generated-manifest
```

## Production release

Stable release được bảo vệ bởi GitHub Actions:

- tag phải khớp `package.json`
- tag phải trỏ đúng commit hiện tại trên `master`
- tagged release bắt buộc có Windows code-signing certificate
- runtime dependency audit phải pass
- backend persistence/restart/production tests phải pass
- installer phải cài, khởi động và uninstall được trong smoke test
- Authenticode phải hợp lệ ở tagged release
- release manifest phải pass cùng policy mà app dùng
- SHA-256 checksum được tạo cho release artifacts

Xem thêm:

- `CHANGELOG.md`
- `docs/PRODUCTION_BACKEND.md`
- `docs/RELEASE_CHECKLIST.md`

## Lưu ý release công khai

`v0.14.0` là production-hardening/release baseline. Không nên tạo public Stable tag trước khi:

1. Windows code-signing secrets được cấu hình.
2. Production backend được deploy qua HTTPS.
3. Real billing provider được nối cho paid public launch.
4. Installer được smoke-test trên một máy Windows user sạch.

## Kiến trúc chính

- `main.js`: Electron main process / native boundary
- `preload.js`: context-isolated renderer bridge
- `renderer/`: desktop UI
- `services/`: FFmpeg, speech, translation, voice, auth, billing, updater
- `dev-backend/`: backend baseline + production SQLite mode
- `.github/workflows/`: CI và Windows release pipeline
