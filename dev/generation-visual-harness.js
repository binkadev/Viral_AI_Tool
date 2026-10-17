"use strict";
const { createJob, transition } = require("../services/generation/generation-job");

function fixture(status, stageValue) {
  // Omitted stage preserves the original AI Media preview; malformed values fail closed.
  const stage = stageValue === undefined ? 4 : /^[1-7]$/.test(String(stageValue)) ? Number(stageValue) : null;
  if (stage === null) return null;
  if (!["running", "failed", "interrupted", "completed"].includes(status)) return null;
  const projectId = "dev-generation-visual";
  const jobs = [0, 1, 2, 3].map(index => {
    let job = createJob({projectId, sceneId: "dev-scene-" + index, idempotencyKey: "visual-" + index,
      kind: "video", mode: "text-to-video", prompt: ""},
      {model: {id: "visual-only", provider: null}, estimate: null});
    const target = status === "completed" || index === 0 ? "completed" : index === 1 ? status : "queued";
    if (target === "queued") return job;
    for (const step of ["preparing", "submitting", "running"]) job = transition(job, step);
    job.progress = 46;
    if (target === "completed") {
      job = transition(job, "verifying", {progress: 92});
      job = transition(job, "completed", {progress: 100, completedAt: job.updatedAt,
        asset: {fileName: job.id + ".mp4"}, output: {fileName: job.id + ".mp4"}});
    } else if (target !== "running") job = transition(job, target, target === "failed" ? {errorCode: "PROVIDER_UNAVAILABLE"} : {});
    return job;
  });
  const current = status === "completed" ? "done" : status === "running" ? "current" : status;
  const stageStates = Array.from({length: 7}, (_, index) => index < stage - 1 ? "done" : index === stage - 1 ? current : "pending");
  return {projectId, jobs, selectedId: jobs[1].id, stage, stageStates};
}

function setup(app, env) {
  // Fail closed, including absent/unknown packaging status and invalid states.
  if (app.isPackaged !== false || env.NODE_ENV === "production") return null;
  const data = fixture(env.VIRAL_AI_DEV_GENERATION_STATE, env.VIRAL_AI_DEV_GENERATION_STAGE);
  if (!data) return null;
  const fs = require("fs"), path = require("path"), os = require("os");
  // Must run before the single-instance lock, sessions, or any real services initialize.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-generation-visual-"));
  app.setPath("userData", root);
  app.setPath("sessionData", root);
  return data;
}
module.exports = {fixture, setup};
