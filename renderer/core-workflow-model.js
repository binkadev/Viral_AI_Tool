(function attachCoreWorkflowModel(root, factory) {
  const dependency = (typeof module !== "undefined" && module.exports)
    ? require("./core-job-model")
    : root?.ViralCoreJobModel;
  const api = factory(dependency);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreWorkflowModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createCoreWorkflowModel(jobModel) {
  "use strict";

  function canonicalJobState(job) {
    if (jobModel?.stateOf) return jobModel.stateOf(job);
    const value = String(job?.status || job?.state || "idle").toLowerCase();
    if (["validating", "preparing"].includes(value)) return "preparing";
    if (value === "uploading") return "uploading";
    if (["queued", "processing", "translating", "generating", "downloading", "rendering", "cancelling"].includes(value)) return "processing";
    if (["completed", "complete", "done", "success"].includes(value)) return "completed";
    if (["failed", "error", "interrupted", "stale"].includes(value)) return "failed";
    if (["cancelled", "canceled"].includes(value)) return "cancelled";
    return "idle";
  }

  function jobState(job) {
    const state = canonicalJobState(job);
    return ["preparing", "uploading"].includes(state) ? "processing" : state;
  }

  function isBusy(job) {
    if (jobModel?.isBusy) return jobModel.isBusy(job);
    return ["preparing", "uploading", "processing"].includes(canonicalJobState(job));
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

  function latestRenderJob(saved, source) {
    const jobs = Array.isArray(saved?.jobs) ? saved.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      if (!job?.isRenderOutput) continue;
      if (source?.sourcePath && job.sourcePath && String(job.sourcePath) !== String(source.sourcePath)) continue;
      return job;
    }
    return null;
  }

  function latestRenderOutput(saved, source) {
    const job = latestRenderJob(saved, source);
    return job && jobState(job) === "completed" && job?.outputPath ? job : null;
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
    const renderJob = latestRenderJob(saved, source);
    const renderOutput = latestRenderOutput(saved, source);

    const speechState = speechResult ? "completed" : jobState(speechJob);
    const translationState = translationResult ? "completed" : jobState(translationJob);
    const voiceState = voiceResult ? "completed" : jobState(voiceJob);
    const renderState = renderOutput ? "completed" : jobState(renderJob);

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
        status: renderState === "idle" ? (!translationResult ? "blocked" : "active") : renderState,
        reason: renderOutput
          ? "Đã có file render thành công."
          : renderState === "processing"
            ? "Đang render video."
            : renderState === "failed"
              ? "Render chưa hoàn tất. Hãy kiểm tra lỗi và thử lại."
              : translationResult
                ? "Đủ input tối thiểu để render."
                : "Cần bản dịch trước."
      }
    ];

    const anyBusy = Boolean(
      (!speechResult && isBusy(speechJob)) ||
      (!translationResult && isBusy(translationJob)) ||
      (!voiceResult && isBusy(voiceJob)) ||
      (!renderOutput && isBusy(renderJob))
    );

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
        enabled: Boolean(renderOutput) && renderState === "completed",
        reason: renderOutput ? "" : renderState === "processing" ? "Đang render; Export sẽ mở khi hoàn tất." : "Chỉ Export sau khi render thành công."
      }
    };

    return {
      source,
      missingSource,
      analyzed,
      speechResult,
      translationResult,
      voiceResult,
      renderJob,
      renderOutput,
      stages,
      controls,
      jobs: {
        speech: speechResult ? "completed" : canonicalJobState(speechJob),
        translation: translationResult ? "completed" : canonicalJobState(translationJob),
        voice: voiceResult ? "completed" : canonicalJobState(voiceJob),
        render: renderOutput ? "completed" : canonicalJobState(renderJob)
      }
    };
  }

  return { derive, jobState, latestSourceJob, latestRenderJob, latestRenderOutput };
});
