"use strict";

// Never required by packaged/production startup. No provider is registered.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { GenerationService } = require("../services/generation/generation-service");
const { createJob, transition } = require("../services/generation/generation-job");
const { normalizeRequest } = require("../services/generation/generation-request");
const { probeVideo } = require("../services/ffmpeg");

const MODES = ["completed", "persistence-failure", "tampered", "noncompleted", "legacy"];
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
let current = null;
function enabled(app, env) {
  return app.isPackaged === false && env.NODE_ENV !== "production" &&
    MODES.includes(env.VIRAL_AI_DEV_HANDOFF_FIXTURE) && uuid(env.VIRAL_AI_DEV_HANDOFF_SESSION);
}

function setup(app, env) {
  if (!enabled(app, env)) return null;
  if (env.VIRAL_AI_DEV_GENERATION_STATE) throw Error("Conflicting DEV fixtures");
  const root = path.join(os.tmpdir(), "viral-ai-handoff-" + env.VIRAL_AI_DEV_HANDOFF_SESSION);
  const marker = path.join(root, "handoff-session.json");
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root);
    fs.writeFileSync(marker, JSON.stringify({ version: 1, session: env.VIRAL_AI_DEV_HANDOFF_SESSION }), { flag: "wx" });
  }
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== path.resolve(root) ||
      fs.lstatSync(marker).isSymbolicLink() ||
      JSON.parse(fs.readFileSync(marker, "utf8")).session !== env.VIRAL_AI_DEV_HANDOFF_SESSION) throw Error("Invalid DEV profile");
  app.setPath("userData", root);
  app.setPath("sessionData", root);
  current = { root, mode: env.VIRAL_AI_DEV_HANDOFF_FIXTURE };
  return current;
}

async function makeVideo(file) {
  const binary = require("ffmpeg-static"); // Already shipped runtime dependency.
  await new Promise((resolve, reject) => {
    const child = spawn(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-n",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "1", "-an",
      "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-crf", "30",
      "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1",
      "-movflags", "+faststart", file], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", data => { error = (error + data).slice(-2048); });
    const timer = setTimeout(() => { child.kill(); reject(Error("DEV MP4 timeout")); }, 20000);
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(error || "DEV MP4 failed")); });
  });
  const stat = fs.lstatSync(file), meta = await probeVideo(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024 ||
      !(meta.duration > 0 && meta.width === 160 && meta.height === 90)) throw Error("Invalid DEV MP4");
  return meta;
}

function runtime(app, env) {
  if (!enabled(app, env) || !current || app.getPath("userData") !== current.root) throw Error("DEV harness unavailable");
  if (current.service) return current;
  const service = new GenerationService({ root: path.join(current.root, "generation") });
  const identityFile = path.join(current.root, "identity.json");
  let identity = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, "utf8")) : null;
  let completing = null, originalBytes = null;
  app.on?.("will-quit", () => {
    if (originalBytes && identity) {
      fs.writeFileSync(path.join(service.context(service.get(identity.jobId)).outputDirectory, identity.jobId + ".mp4"), originalBytes);
      originalBytes = null; // Restore only after the DEV window has closed.
    }
  });
  const allowed = id => { if (!identity || id !== identity.jobId) throw Error("DEV identity mismatch"); };
  // Guard every native read in this isolated runtime, including ordinary IPC.
  const get = service.get.bind(service);
  service.get = id => { allowed(id); return get(id); };
  for (const method of ["submit", "retry", "recover", "cancel", "list"]) {
    service[method] = () => { throw Error("DEV handoff forbids execution/history"); };
  }
  if (service.jobs.length !== (identity ? 1 : 0) || (identity && service.jobs[0].id !== identity.jobId)) throw Error("Unexpected DEV jobs");
  async function complete() {
    if (completing) return completing;
    completing = (async () => {
      const job = service.get(identity.jobId);
      if (job.status !== "queued" || current.mode === "noncompleted") return service.publicJob(job);
      const directory = service.context(job).outputDirectory;
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, job.id + ".mp4");
      await makeVideo(file);
      let running = job;
      for (const status of ["preparing", "submitting", "running"]) running = transition(running, status);
      service.commit(running); // Local fixture lifecycle, never service.submit/provider.start.
      const completed = service.finish(job.id, { status: "completed", fileName: job.id + ".mp4" });
      if (completed.status !== "completed" || service.output(job.id).verified !== true) throw Error("DEV verification failed");
      if (current.mode === "legacy") {
        delete completed.outputVerification;
        service.commit(completed);
      }
      if (current.mode === "tampered") {
        originalBytes = fs.readFileSync(file);
        const bytes = Buffer.from(originalBytes); bytes[bytes.length - 1] ^= 1;
        fs.writeFileSync(file, bytes);
      }
      return service.publicJob(service.get(job.id));
    })();
    return completing;
  }
  current.service = service;
  current.command = async (action, payload) => {
    if (!enabled(app, env)) return null;
    if (action === "state" && payload === undefined) return { mode: current.mode, identity, restarted: fs.existsSync(path.join(current.root, "first-pass.json")) };
    if (action === "enroll" && payload && Object.keys(payload).sort().join() === "projectId,sceneId" && uuid(payload.projectId) && uuid(payload.sceneId)) {
      if (identity) throw Error("DEV job already enrolled");
      const request = normalizeRequest({ ...payload, idempotencyKey: randomUUID(), prompt: "DEV local video handoff", modelId: "local:wan" });
      const job = createJob(request, { model: { id: "local:wan", provider: "local" }, estimate: null });
      identity = { jobId: job.id, projectId: job.projectId, sceneId: job.sceneId };
      fs.writeFileSync(identityFile, JSON.stringify(identity), { flag: "wx" });
      service.commit(job);
      return service.publicJob(job);
    }
    if (action === "complete" && payload === undefined && identity) return complete();
    if (action === "duplicates" && payload === undefined && identity) {
      for (let i = 0; i < 4; i++) service.emit("changed", { id: identity.jobId, status: service.get(identity.jobId).status });
      return true;
    }
    if (action === "report" && payload && typeof payload === "object" && JSON.stringify(payload).length < 16000) {
      const file = path.join(current.root, fs.existsSync(path.join(current.root, "first-pass.json")) ? "restart-pass.json" : "first-pass.json");
      const job = identity && service.get(identity.jobId);
      const evidence = { registeredProviders: service.registry.adapters.size, jobCount: service.jobs.length,
        outputVerification: job?.outputVerification || null };
      fs.writeFileSync(file, JSON.stringify({ ...payload, identity, mode: current.mode, native: evidence }, null, 2), { flag: "wx" });
      await require("electron").session.defaultSession.flushStorageData();
      if (!payload.ok || current.mode !== "completed" || !file.endsWith("restart-pass.json") || env.VIRAL_AI_DEV_HANDOFF_AUTOCLOSE === "1") setTimeout(() => app.quit(), 300);
      return true;
    }
    throw Error("Invalid DEV handoff command");
  };
  return current;
}

module.exports = { enabled, setup, runtime, makeVideo };
