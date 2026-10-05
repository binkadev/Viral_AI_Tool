(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CoreErrorState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NETWORK = new Set([
    "CLOUD_NETWORK",
    "CLOUD_TIMEOUT",
    "CLOUD_UNAVAILABLE",
    "CLOUD_UPLOAD_FAILED",
    "CLOUD_REQUEST_FAILED",
    "TRANSLATION_NETWORK",
    "TRANSLATION_TIMEOUT",
    "TRANSLATION_UNAVAILABLE",
    "TRANSLATION_REQUEST_FAILED",
    "VOICE_NETWORK",
    "VOICE_TIMEOUT",
    "VOICE_UNAVAILABLE",
    "VOICE_REQUEST_FAILED"
  ]);

  const RETRYABLE = new Set([
    ...NETWORK,
    "SERVICE_RESTARTED",
    "RESULT_NOT_RETAINED",
    "SPEECH_FAILED",
    "TRANSLATION_FAILED",
    "VOICE_FAILED",
    "RENDER_FAILED"
  ]);

  function normalize(code) {
    return String(code || "UNKNOWN_ERROR").trim().toUpperCase() || "UNKNOWN_ERROR";
  }

  function copy(code, locale = "vi") {
    const value = normalize(code);
    const vi = locale === "vi";

    if (value === "CLOUD_AUTH_REQUIRED" || value === "AUTH_REQUIRED") {
      return {
        title: vi ? "Cần đăng nhập" : "Sign in required",
        body: vi ? "Hãy đăng nhập lại để tiếp tục sử dụng xử lý Cloud." : "Sign in again to continue using Cloud processing."
      };
    }
    if (value === "CLOUD_QUOTA_EXCEEDED" || value === "QUOTA_EXCEEDED") {
      return {
        title: vi ? "Đã dùng hết hạn mức" : "Allowance used up",
        body: vi ? "Hạn mức Cloud hiện tại không đủ cho tác vụ này." : "Your current Cloud allowance is not enough for this task."
      };
    }
    if (value === "CLOUD_FILE_TOO_LARGE" || value === "FILE_TOO_LARGE") {
      return {
        title: vi ? "File quá lớn" : "File is too large",
        body: vi ? "Hãy dùng video ngắn hơn hoặc chia video thành phần nhỏ hơn." : "Use a shorter video or split it into smaller parts."
      };
    }
    if (value === "NO_AUDIO" || value === "CLOUD_AUDIO_UNSUPPORTED") {
      return {
        title: vi ? "Không tìm thấy âm thanh phù hợp" : "Usable audio was not found",
        body: vi ? "Hãy kiểm tra video nguồn hoặc thử một file khác." : "Check the source video or try another file."
      };
    }
    if (value === "MISSING_FILE" || value === "FILE_MISSING") {
      return {
        title: vi ? "Không tìm thấy video nguồn" : "Source video is missing",
        body: vi ? "File đã bị di chuyển hoặc xóa. Hãy liên kết lại video để tiếp tục." : "The file was moved or deleted. Relink the video to continue."
      };
    }
    if (value === "CLOUD_CANCELLED" || value === "CANCELLED") {
      return {
        title: vi ? "Đã dừng tác vụ" : "Task stopped",
        body: vi ? "Video gốc vẫn an toàn và không bị thay đổi." : "Your original video is safe and unchanged."
      };
    }
    if (NETWORK.has(value)) {
      return {
        title: vi ? "Chưa thể kết nối xử lý trực tuyến" : "Cloud processing is unavailable",
        body: vi ? "Kết nối hoặc dịch vụ đang tạm thời không ổn định. Hãy thử lại sau ít phút." : "The connection or service is temporarily unstable. Try again shortly."
      };
    }

    return {
      title: vi ? "Chưa thể hoàn tất tác vụ" : "Task could not be completed",
      body: vi ? "Dữ liệu gốc vẫn an toàn. Hãy thử lại hoặc kiểm tra file đầu vào." : "Your original data is safe. Try again or check the input file."
    };
  }

  function describe(code, locale = "vi") {
    const value = normalize(code);
    return {
      code: value,
      ...copy(value, locale),
      retryable: RETRYABLE.has(value),
      technicalDetailsVisible: false
    };
  }

  return {
    NETWORK,
    RETRYABLE,
    normalize,
    describe
  };
});
