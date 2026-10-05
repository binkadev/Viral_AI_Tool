(function attachCoreWorkflowModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreWorkflowModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreWorkflowModel() {
  "use strict";

  const BUSY = new Set(["validating", "preparing", "uploading", "queued", "processing", "translating", "generating", "downloading", "rendering", "cancelling"]);

  function jobState(job) {
    const value = String(job?.status || job?.state || "idle").toLowerCase();
    if (BUSY.has(value)) return "processing";
    if (["completed", "complete", "done", "success"].includes(value)) return "completed";
    if (["failed", "error"].includes(value)) return "failed";
    if (["cancelled", "canceled"].includes(value)) return "cancelled";
    if (["interrupted"].includes(value)) return "failed";
    return "idle";
  }

  function latestSourceJob(saved) {
    const jobs = Array.isArray(saved?.jobs) ? saved.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      if (!job?.isRenderOutput && job?.sourcePath) return job;
    }
    return null;
  }

  function resultMatches(result, source) {
    if (!result || !source) return false;
    if (!result.sourcePath) return true;
    return String(result.sourcePath) === String(source.sourcePath);
  }

  function jobMatches(job, source) {
    if (!job || !source) return false;
    if (!job.sourcePath) return true;
    return String(job.sourcePath) === String(source.sourcePath);
  }

  function latestRenderOutput(saved) {
    const jobs = Array.isArray(saved?.jobs) ? saved.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      if (job?.isRenderOutput && jobState(job) === "completed" && job?.outputPath) return job;
    }
    return null;
  }

  function derive(saved = {}) {
    const source = latestSourceJob(saved);
    const missingSource = Boolean(source && source.fileState === "missing");
    const hasSource = Boolean(source && !missingSource);
    const analyzed = Boolean(hasSource && source.meta && (Number(source.meta.duration) > 0 || Number(source.meta.width) > 0 || Number(source.meta.height) > 0));

    const speechResult = resultMatches(saved?.speech?.result, source) ? saved.speech.result : null;
    const speechJob = jobMatches(saved?.speech?.job, source) ? saved.speech.job : null;
    const translationResult = resultMatches(saved?.translation?.result, source) ? saved.translation.result : null;
    const translationJob = jobMatches(saved?.translation?.job, source) ? saved.translation.job : null;
    const voiceResult = resultMatches(saved?.voice?.result, source) ? saved.voice.result : null;
    const voiceJob = jobMatches(saved?.voice?.job, source) ? saved.voice.job : null;
    const renderOutput = latestRenderOutput(saved);

    const speechState = speechResult ? "completed" : jobState(speechJob);
    const translationState = translationResult ? "completed" : jobState(translationJob);
    const voiceState = voiceResult ? "completed" : jobState(voiceJob);

    const stages = [
      {
        id: "import",
        label: "IMPORT",
        status: missingSource ? "failed" : hasSource ? "completed" : "active",
        reason: missingSource ? "File nguồn không còn tồn tại." : hasSource ? "Video đã được nhập." : "Chọn video để bắt đầu."
      },
      {
        id: "analyze",
        label: "ANALYZE",
        status: missingSource ? "blocked" : analyzed ? "completed" : hasSource ? "processing" : "blocked",
        reason: analyzed ? "Metadata video đã sẵn sàng." : hasSource ? "Đang kiểm tra video." : "Cần Import trước."
      },
      {
        id: "transcript",
        label: "TRANSCRIPT",
        status: !analyzed ? "blocked" : speechState === "idle" ? "active" : speechState,
        reason: speechResult ? "Transcript và timestamp đã sẵn sàng." : !analyzed ? "Cần video hợp lệ." : "Chạy nhận diện lời nói."
      },
      {
        id: "edit",
        label: "EDIT",
        status: !speechResult ? "blocked" : (translationJob || translationResult) ? "completed" : "active",
        reason: speechResult ? "Kiểm tra và chỉnh transcript trước khi localize." : "Cần Transcript trước."
      },
      {
        id: "localize",
        label: "LOCALIZE",
        status: !speechResult ? "blocked" : translationState === "idle" ? "active" : translationState,
        reason: translationResult
          ? (voiceResult ? "Bản dịch và giọng đã sẵn sàng." : "Bản dịch đã sẵn sàng; Voice là tùy chọn.")
          : "Dịch transcript trước khi tạo Voice/Subtitle."
      },
      {
        id: "render",
        label: "RENDER",
        status: renderOutput ? "completed" : !translationResult ? "blocked" : "active",
        reason: renderOutput ? "Đã có file render thành công." : translationResult ? "Đủ input tối thiểu để render." : "Cần bản dịch trước."
      }
    ];

    const anyBusy = [speechState, translationState, voiceState].includes("processing");
    const controls = {
      speech: {
        enabled: analyzed && !anyBusy,
        reason: !hasSource ? "Cần Import video trước." : missingSource ? "File nguồn đã bị xóa hoặc di chuyển." : !analyzed ? "Video chưa phân tích xong." : anyBusy ? "Đang có tác vụ xử lý." : ""
      },
      translate: {
        enabled: Boolean(speechResult) && !anyBusy,
        reason: !speechResult ? "Cần Transcript trước." : anyBusy ? "Đang có tác vụ xử lý." : ""
      },
      voice: {
        enabled: Boolean(translationResult) && !anyBusy,
        reason: !translationResult ? "Cần bản dịch trước." : anyBusy ? "Đang có tác vụ xử lý." : ""
      },
      render: {
        enabled: Boolean(source && translationResult) && !missingSource && !anyBusy,
        reason: missingSource ? "File nguồn không còn tồn tại." : !translationResult ? "Cần bản dịch trước khi render." : anyBusy ? "Hãy chờ tác vụ hiện tại hoàn tất." : ""
      },
      export: {
        enabled: Boolean(renderOutput),
        reason: renderOutput ? "" : "Chỉ Export sau khi render thành công."
      }
    };

    return {
      source,
      missingSource,
      analyzed,
      speechResult,
      translationResult,
      voiceResult,
      renderOutput,
      stages,
      controls,
      jobs: {
        speech: speechState,
        translation: translationState,
        voice: voiceState
      }
    };
  }

  return { derive, jobState, latestSourceJob, latestRenderOutput };
});
