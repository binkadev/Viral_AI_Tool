(function attachCoreJobModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreJobModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreJobModel() {
  "use strict";

  const PREPARING = new Set(["validating", "preparing"]);
  const UPLOADING = new Set(["uploading"]);
  const PROCESSING = new Set(["queued", "processing", "translating", "generating", "downloading", "rendering", "cancelling"]);
  const COMPLETED = new Set(["completed", "complete", "done", "success"]);
  const FAILED = new Set(["failed", "error", "interrupted", "stale"]);
  const CANCELLED = new Set(["cancelled", "canceled"]);

  function rawState(jobOrState) {
    if (typeof jobOrState === "string") return jobOrState.toLowerCase();
    return String(jobOrState?.status || jobOrState?.state || "idle").toLowerCase();
  }

  function stateOf(jobOrState) {
    const value = rawState(jobOrState);
    if (PREPARING.has(value)) return "preparing";
    if (UPLOADING.has(value)) return "uploading";
    if (PROCESSING.has(value)) return "processing";
    if (COMPLETED.has(value)) return "completed";
    if (FAILED.has(value)) return "failed";
    if (CANCELLED.has(value)) return "cancelled";
    return "idle";
  }

  function describe(jobOrState) {
    const phase = rawState(jobOrState);
    const state = stateOf(phase);
    return {
      state,
      phase,
      busy: ["preparing", "uploading", "processing"].includes(state),
      terminal: ["completed", "failed", "cancelled"].includes(state),
      successful: state === "completed",
      retryable: state === "failed" || state === "cancelled"
    };
  }

  function isBusy(jobOrState) {
    return describe(jobOrState).busy;
  }

  return { stateOf, describe, isBusy, rawState };
});
