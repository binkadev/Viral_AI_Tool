# Viral AI Tool

Ứng dụng desktop Electron cho quy trình video AI trên Windows.

## Ngôn ngữ

Ứng dụng hiện hỗ trợ:
- Tiếng Việt
- English

Bạn có thể đổi ngôn ngữ trực tiếp bằng nút `VI / EN` trên thanh trên cùng. Lựa chọn được ghi nhớ sau khi mở lại ứng dụng.

## Font

Viral AI Tool dùng font hệ thống Windows để đảm bảo tiếng Việt hiển thị ổn định:

- Segoe UI Variable Text
- Segoe UI Variable
- Segoe UI
- Noto Sans
- Arial

Không cần tải font ngoài khi chạy app.

## Chạy ứng dụng

```powershell
npm install
npm start
```

## Build file cài đặt Windows

```powershell
npm run dist
```

File build nằm trong thư mục:

```text
release\
```

## Chức năng prototype hiện tại

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
- Chọn nhiều video từ Windows
- Drag & drop video
- Chọn thư mục output
- Queue và render progress mô phỏng
- Giao diện song ngữ VI / EN

## Bước tiếp theo

- FFmpeg engine
- đọc metadata video thật
- thumbnail / preview thật
- render MP4 thật
- speech-to-text
- translation
- AI voice
- subtitle pipeline
- automation worker
