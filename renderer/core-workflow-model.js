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

  function normalizeOwnershipPath(value) {
    const raw = String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/$/, "");
    if (/^[A-Za-z]:\//.test(raw) || raw.startsWith("//")) return raw.toLowerCase();
    return raw;
  }

  function sameSourcePath(left, right) {
    const a = normalizeOwnershipPath(left);
    const b = normalizeOwnershipPath(right);
    return Boolean(a && b && a === b);
  }

  function ownershipMatches(entity, source) {
    if (!entity || !source) return false;
    const sourceId = String(source?.id || "");
    const explicitId = String(entity?.sourceJobId || entity?.sourceId || "");
    if (explicitId && sourceId) return explicitId === sourceId;
    if (entity?.sourcePath && source?.sourcePath) return sameSourcePath(entity.sourcePath, source.sourcePath);
    return false;
  }

  function latestSourceJob(saved) {
    const jobs = Array.isArray(saved?.jobs) ? saved.jobs : [];
    // Application history is newest-first (`unshift`). Keep workflow ownership
    // aligned with app.js/project snapshot instead of accidentally selecting an
    // older source from the end of the list.
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job?.sourcePath && !job?.isRenderOutput) return job;
    }
    return null;
  }

  function resultMatches(result, source) {
    return ownershipMatches(result, source);
  }

  function jobMatches(job, source) {
    return ownershipMatches(job, source);
  }

  function latestRenderJob(saved, source) {
    const jobs = Array.isArray(saved?.jobs) ? saved.jobs : [];
    // Render jobs are also newest-first. Never let an orphan/older render job
    // unlock controls for another source video.
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (!job?.isRenderOutput) continue;
      if (source && !ownershipMatches(job, source)) continue;
      return job;
    }
    return null;
  }

  function renderFileUnavailable(job) {
    return job?.fileState === "missing" || job?.fileState === "trashed";
  }

  function latestRenderOutput(saved, source) {
    const job = latestRenderJob(saved, source);
    return job &&
      jobState(job) === "completed" &&
      job?.outputPath &&
      !renderFileUnavailable(job)
      ? job
      : null;
  }

  function derive(saved = {}) {
    const source = latestSourceJob(saved);
    const missingSource = Boolean(source && (source.fileState === "missing" || source.fileState === "trashed"));
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
    const renderOutputMissing = Boolean(
      renderJob &&
      jobState(renderJob) === "completed" &&
      renderJob?.outputPath &&
      renderFileUnavailable(renderJob)
    );

    const speechState = speechResult ? "completed" : jobState(speechJob);
    const translationState = translationResult ? "completed" : jobState(translationJob);
    const voiceState = voiceResult ? "completed" : jobState(voiceJob);
    const rawRenderState = jobState(renderJob);
    const renderState = renderOutput
      ? "completed"
      : renderOutputMissing
        ? "active"
        : rawRenderState;

    const stages = [
      { id:"import", label:"IMPORT", status:missingSource?"failed":hasSource?"completed":"active", reason:missingSource?"File nguồn không còn tồn tại.":hasSource?"Video đã được nhập.":"Chọn video để bắt đầu." },
      { id:"analyze", label:"ANALYZE", status:missingSource?"blocked":analyzed?"completed":hasSource?"processing":"blocked", reason:analyzed?"Metadata video đã sẵn sàng.":hasSource?"Đang kiểm tra video.":"Cần Import trước." },
      { id:"transcript", label:"TRANSCRIPT", status:!analyzed?"blocked":speechState==="idle"?"active":speechState, reason:speechResult?"Transcript và timestamp đã sẵn sàng.":!analyzed?"Cần video hợp lệ.":"Chạy nhận diện lời nói." },
      { id:"edit", label:"EDIT", status:!speechResult?"blocked":(translationJob||translationResult)?"completed":"active", reason:speechResult?"Kiểm tra và chỉnh transcript trước khi localize.":"Cần Transcript trước." },
      { id:"localize", label:"LOCALIZE", status:!speechResult?"blocked":!translationResult?(translationState==="idle"?"active":translationState):voiceState==="idle"?"active":voiceState, reason:voiceResult?"Bản dịch và AI Voice đã sẵn sàng.":translationResult?"Bản dịch đã sẵn sàng. Bản dubbing hiện tại cần tạo AI Voice trước khi Render.":"Dịch transcript trước khi tạo Voice/Subtitle." },
      { id:"render", label:"RENDER", status:renderState==="idle"?(!voiceResult?"blocked":"active"):renderState, reason:renderOutput?"Đã có file render thành công.":renderOutputMissing?"File render không còn khả dụng. Có thể render lại từ project hiện tại.":renderState==="processing"?"Đang render video.":renderState==="failed"?"Render chưa hoàn tất. Hãy kiểm tra lỗi và thử lại.":voiceResult?"Đã đủ input cho pipeline dubbing hiện tại.":translationResult?"Cần AI Voice trước khi render bản dubbing hiện tại.":"Cần bản dịch trước." }
    ];

    const anyBusy = Boolean(
      (!speechResult && isBusy(speechJob)) ||
      (!translationResult && isBusy(translationJob)) ||
      (!voiceResult && isBusy(voiceJob)) ||
      (!renderOutput && !renderOutputMissing && isBusy(renderJob))
    );

    const controls = {
      speech: { enabled: analyzed && !anyBusy, reason: !hasSource ? "Cần Import video trước." : missingSource ? "File nguồn đã bị xóa hoặc di chuyển." : !analyzed ? "Video chưa phân tích xong." : anyBusy ? "Đang có tác vụ xử lý." : "" },
      translate: { enabled: Boolean(speechResult) && !anyBusy, reason: !speechResult ? "Cần Transcript trước." : anyBusy ? "Đang có tác vụ xử lý." : "" },
      voice: { enabled: Boolean(translationResult) && !anyBusy, reason: !translationResult ? "Cần bản dịch trước." : anyBusy ? "Đang có tác vụ xử lý." : "" },
      render: { enabled: Boolean(source && translationResult && voiceResult) && !missingSource && !anyBusy, reason: missingSource ? "File nguồn không còn tồn tại." : !translationResult ? "Cần bản dịch trước khi render." : !voiceResult ? "Cần AI Voice trước khi render bản dubbing hiện tại." : anyBusy ? "Hãy chờ tác vụ hiện tại hoàn tất." : "" },
      export: { enabled: Boolean(renderOutput) && renderState === "completed", reason: renderOutputMissing ? "File render không còn khả dụng. Hãy render lại trước khi Export." : renderOutput ? "" : renderState === "processing" ? "Đang render; Export sẽ mở khi hoàn tất." : "Chỉ Export sau khi render thành công." }
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
      renderOutputMissing,
      stages,
      controls,
      jobs: {
        speech: speechResult ? "completed" : canonicalJobState(speechJob),
        translation: translationResult ? "completed" : canonicalJobState(translationJob),
        voice: voiceResult ? "completed" : canonicalJobState(voiceJob),
        render: renderOutput ? "completed" : renderOutputMissing ? "active" : canonicalJobState(renderJob)
      }
    };
  }

  return {
    derive,
    jobState,
    latestSourceJob,
    latestRenderJob,
    latestRenderOutput,
    renderFileUnavailable,
    resultMatches,
    jobMatches,
    sameSourcePath
  };
});