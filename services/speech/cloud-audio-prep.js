const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const { probeVideo, assertVideoPath } = require("../ffmpeg");

const active = new Map();

class CloudAudioPrepError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CloudAudioPrepError";
    this.code = code;
    this.details = details;
  }
}

function prepError(code, message, details) {
  return new CloudAudioPrepError(code, message, details);
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) {
    throw prepError("JOB_INVALID", "Invalid cloud audio preparation job id.");
  }
}

function binaryPath() {
  if (!ffmpegStatic) {
    throw prepError("AUDIO_PREP_UNAVAILABLE", "Audio preparation runtime is unavailable.");
  }
  return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
}

function parseTimecode(value) {
  const match = String(value || "").match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function makeOutputPath(tempRoot, jobId) {
  const dir = path.join(tempRoot, "viral-ai-tool", "speech-cloud");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, jobId + ".mp3");
}

async function prepareCloudAudio({ jobId, inputPath, tempRoot, onProgress }) {
  validateJobId(jobId);
  const safeInput = assertVideoPath(inputPath);

  if (active.has(jobId)) {
    throw prepError("AUDIO_PREP_DUPLICATE", "Cloud audio preparation is already active.");
  }

  const metadata = await probeVideo(safeInput);
  if (!metadata.audioCodec) {
    throw prepError("NO_AUDIO", "The source video does not contain an audio track.");
  }

  const outputPath = makeOutputPath(tempRoot, jobId);
  try { fs.rmSync(outputPath, { force: true }); } catch {}

  const duration = Math.max(0, Number(metadata.duration || 0));

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath(), [
      "-nostdin",
      "-y",
      "-i", safeInput,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libmp3lame",
      "-b:a", "48k",
      "-progress", "pipe:1",
      "-nostats",
      outputPath
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const state = {
      child,
      outputPath,
      cancelled: false,
      stdoutBuffer: "",
      stderr: ""
    };
    active.set(jobId, state);

    onProgress?.({
      jobId,
      state: "preparing",
      percent: 0,
      indeterminate: duration <= 0
    });

    child.stdout.on("data", chunk => {
      const lines = (state.stdoutBuffer + chunk.toString()).split(/\r?\n/);
      state.stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const split = line.indexOf("=");
        if (split < 0) continue;
        const key = line.slice(0, split).trim();
        const value = line.slice(split + 1).trim();

        if (key === "out_time" && duration > 0) {
          const current = parseTimecode(value);
          const percent = Math.max(0, Math.min(99, Math.floor((current / duration) * 100)));
          onProgress?.({
            jobId,
            state: "preparing",
            percent,
            indeterminate: false
          });
        }
      }
    });

    child.stderr.on("data", chunk => {
      if (state.stderr.length < 12000) state.stderr += chunk.toString();
    });

    child.on("error", error => {
      active.delete(jobId);
      try { fs.rmSync(outputPath, { force: true }); } catch {}
      reject(prepError("AUDIO_PREP_FAILED", "Could not prepare cloud audio.", {
        technicalMessage: error?.message || String(error)
      }));
    });

    child.on("close", code => {
      active.delete(jobId);

      if (state.cancelled) {
        try { fs.rmSync(outputPath, { force: true }); } catch {}
        resolve({ cancelled: true, outputPath: null, duration });
        return;
      }

      if (code !== 0 || !fs.existsSync(outputPath)) {
        try { fs.rmSync(outputPath, { force: true }); } catch {}
        reject(prepError("AUDIO_PREP_FAILED", "Could not prepare cloud audio.", {
          technicalMessage: state.stderr.slice(-3000),
          exitCode: code
        }));
        return;
      }

      const stat = fs.statSync(outputPath);
      if (!stat.isFile() || stat.size <= 128) {
        try { fs.rmSync(outputPath, { force: true }); } catch {}
        reject(prepError("NO_AUDIO", "Prepared cloud audio is empty."));
        return;
      }

      onProgress?.({
        jobId,
        state: "preparing",
        percent: 100,
        indeterminate: false
      });

      resolve({
        cancelled: false,
        outputPath,
        duration,
        sizeBytes: stat.size,
        contentType: "audio/mpeg",
        sampleRate: 16000,
        channels: 1
      });
    });
  });
}

function cancelCloudAudioPrep(jobId) {
  const state = active.get(jobId);
  if (!state) return false;

  state.cancelled = true;
  try {
    state.child.kill("SIGTERM");
    return true;
  } catch {
    state.cancelled = false;
    return false;
  }
}

function cleanupCloudAudio(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(path.resolve(filePath), { force: true });
  } catch {
    // Cleanup failure must never replace the recognition result.
  }
}

module.exports = {
  prepareCloudAudio,
  cancelCloudAudioPrep,
  cleanupCloudAudio
};
