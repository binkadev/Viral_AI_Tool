# Viral AI Tool

Ứng dụng desktop Windows bằng Electron dành cho workflow localize video bằng AI.

**Phiên bản hiện tại:** `0.14.0`

## Ngôn ngữ

Ứng dụng hỗ trợ:

- Tiếng Việt
- English

Có thể đổi trực tiếp bằng nút `VI / EN`. Lựa chọn được ghi nhớ giữa các lần mở ứng dụng.

## Workflow chính

Viral AI Tool hiện đã có:

- nhập video local
- nhận diện lời nói
- dịch
- AI voice
- căn timing theo segment
- giữ audio gốc làm nền
- burn subtitle
- xuất MP4 H.264 / AAC
- progress / cancel / retry
- Local / Cloud workflow
- quản lý account/session
- gói Free / Creator / Creator Pro / Business
- quota/concurrency/model entitlement
- subscription lifecycle và billing core
- Usage & Credits
- verified Windows updater

## Chạy development

```powershell
npm ci
npm start
```

Backend development:

```powershell
npm run dev:backend
```

## Build installer Windows

```powershell
npm run dist
```

Build output:

```text
release\
```

## Release & production

Backend production baseline hỗ trợ:

- SQLite durable state
- hashed refresh sessions
- device/session revocation
- audit log
- rate limit
- idempotency/restart recovery
- graceful shutdown

Windows release pipeline hỗ trợ:

- branded icon
- NSIS installer
- startup smoke test
- SHA-256
- release manifest
- verified updater
- Authenticode guard cho Stable tag
- tag/version/master commit validation

Xem:

- `CHANGELOG.md`
- `docs/PRODUCTION_BACKEND.md`
- `docs/RELEASE_CHECKLIST.md`

## Font

App dùng font hệ thống Windows để tiếng Việt hiển thị ổn định:

- Segoe UI Variable Text
- Segoe UI Variable
- Segoe UI
- Noto Sans
- Arial

Không cần tải font ngoài khi chạy app.

## Trạng thái v0.14.0

`0.14.0` là production-hardening/release baseline.

Chưa nên tạo public Stable tag cho paid launch trước khi:

1. cấu hình Windows code-signing certificate;
2. deploy production backend qua HTTPS;
3. nối real billing provider;
4. smoke-test installer trên một máy Windows user sạch.
