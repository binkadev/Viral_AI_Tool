(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CoreJobStatus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = new Set([
    "idle",
    "validating",
    "preparing",
    "uploading",
    "queued",
    "processing",
    "translating",
    "generating",
    "downloading",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
    "interrupted"
  ]);

  const BUSY = new Set([
    "validating",
    "preparing",
    "uploading",
    "queued",
    "processing",
    "translating",
    "generating",
    "downloading",
    "cancelling"
  ]);

  const COPY = {
    vi: {
      idle: "Sẵn sàng",
      validating: "Đang kiểm tra",
      preparing: "Đang chuẩn bị",
      uploading: "Đang tải lên",
      queued: "Đang chờ",
      processing: "Đang xử lý",
      translating: "Đang dịch",
      generating: "Đang tạo",
      downloading: "Đang tải về",
      cancelling: "Đang dừng",
      completed: "Hoàn tất",
      failed: "Lỗi",
      cancelled: "Đã hủy",
      interrupted: "Bị gián đoạn"
    },
    en: {
      idle: "Ready",
      validating: "Validating",
      preparing: "Preparing",
      uploading: "Uploading",
      queued: "Queued",
      processing: "Processing",
      translating: "Translating",
      generating: "Generating",
      downloading: "Downloading",
      cancelling: "Cancelling",
      completed: "Complete",
      failed: "Failed",
      cancelled: "Cancelled",
      interrupted: "Interrupted"
    }
  };

  function normalize(value) {
    const state = String(value || "idle").toLowerCase();
    return STATES.has(state) ? state : "idle";
  }

  function fromJob(job, hasResult = false) {
    if (hasResult) return "completed";
    return normalize(job?.status || "idle");
  }

  function isBusy(value) {
    return BUSY.has(normalize(typeof value === "object" ? value?.status : value));
  }

  function label(value, locale = "vi") {
    const state = normalize(typeof value === "object" ? value?.status : value);
    return (COPY[locale] || COPY.en)[state] || state;
  }

  function capabilityState(enabled, implemented = true) {
    if (!implemented) return "coming-soon";
    return enabled ? "functional" : "disabled";
  }

  return {
    STATES,
    BUSY,
    normalize,
    fromJob,
    isBusy,
    label,
    capabilityState
  };
});
