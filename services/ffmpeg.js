const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const activeRenders = new Map();
const reservedRenders = new Map();
const cancelledRenders = new Set();

const MIN_FREE_BYTES = 512 * 1024 * 1024;
const OUTPUT_MULTIPLIER = 2.25;

class ProcessingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProcessingError";
    this.code = code;
    this.details = details;
  }
}

function processingError(code, message, details) {
  return new ProcessingError(code, message, details);
}

function resolveBinaryPath() {
  if (!ffmpegStatic) {
    throw processingError("ENGINE_UNAVAILABLE", "Video processing binary was not found.");
  }
  return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
}

function assertVideoPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw processingError("SOURCE_INVALID", "Invalid video path.");
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw processingError("SOURCE_MISSING", "Source video does not exist.", { inputPath: resolved });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw processingError("SOURCE_INVALID", "Source path is not a file.", { inputPath: resolved });
  }

  if (!VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw processingError("SOURCE_UNSUPPORTED", "Unsupported video format.", {
      extension: path.extname(resolved).toLowerCase()
    });
  }

  if (stat.size <= 0) {
    throw processingError("SOURCE_INVALID", "Source video is empty.", { inputPath: resolved });
  }

  return resolved;
}

function assertOutputDirectory(outputDir) {
  if (typeof outputDir !== "string" || !outputDir.trim()) {
    throw processingError("OUTPUT_REQUIRED", "Missing output folder.");
  }

  const resolved = path.resolve(outputDir);

  try {
    fs.mkdirSync(resolved, { recursive: true });
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw processingError("OUTPUT_UNAVAILABLE", "Output path is not a directory.", { outputDir: resolved });
    }
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    throw processingError("OUTPUT_UNAVAILABLE", "Output folder is not writable.", { outputDir: resolved });
  }

  return resolved;
}

function availableDiskBytes(directory) {
  if (typeof fs.statfsSync !== "function") return null;

  try {
    const stat = fs.statfsSync(directory);
    const availableBlocks = Number(stat.bavail ?? stat.bfree ?? 0);
    const blockSize = Number(stat.bsize ?? 0);
    const bytes = availableBlocks * blockSize;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

function activeRenderForInput(inputPath) {
  const resolved = path.resolve(inputPath);
  const active = [...activeRenders.values()].find(item => item.inputPath === resolved);
  if (active) return active;

  const reserved = [...reservedRenders.entries()].find(([, reservedPath]) => reservedPath === resolved);
  return reserved ? { jobId: reserved[0], inputPath: reserved[1], reserved: true } : null;
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) {
    throw processingError("JOB_INVALID", "Invalid processing job id.");
  }
  return jobId;
}

function preflightExport({ inputPath, outputDir }) {
  const safeInput = assertVideoPath(inputPath);
  const safeOutputDir = assertOutputDirectory(outputDir);

  if (activeRenderForInput(safeInput)) {
    throw processingError("DUPLICATE_ACTIVE", "This source is already being processed.");
  }

  const sourceStat = fs.statSync(safeInput);
  const requiredFreeBytes = Math.max(
    MIN_FREE_BYTES,
    Math.ceil(sourceStat.size * OUTPUT_MULTIPLIER)
  );
  const freeBytes = availableDiskBytes(safeOutputDir);

  if (freeBytes !== null && freeBytes < requiredFreeBytes) {
    throw processingError("LOW_DISK_SPACE", "Not enough free disk space.", {
      freeBytes,
      requiredFreeBytes
    });
  }

  return {
    inputPath: safeInput,
    outputDir: safeOutputDir,
    sourceSizeBytes: sourceStat.size,
    freeBytes,
    requiredFreeBytes
  };
}

function parseTimecode(value) {
  if (!value) return 0;
  const match = String(value).trim().match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseProbeOutput(stderr, stat) {
  const durationMatch = stderr.match(/Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/i);
  const videoLine = stderr.split(/\r?\n/).find(line => /Video:\s*/i.test(line)) || "";
  const audioLine = stderr.split(/\r?\n/).find(line => /Audio:\s*/i.test(line)) || "";

  const resolutionMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = videoLine.match(/([\d.]+)\s*fps/i);
  const videoCodecMatch = videoLine.match(/Video:\s*([^,\s]+)/i);
  const audioCodecMatch = audioLine.match(/Audio:\s*([^,\s]+)/i);

  return {
    duration: durationMatch ? parseTimecode(durationMatch[1]) : 0,
    width: resolutionMatch ? Number(resolutionMatch[1]) : 0,
    height: resolutionMatch ? Number(resolutionMatch[2]) : 0,
    fps: fpsMatch ? Number(fpsMatch[1]) : 0,
    videoCodec: videoCodecMatch ? videoCodecMatch[1] : "",
    audioCodec: audioCodecMatch ? audioCodecMatch[1] : "",
    bitrateKbps: bitrateMatch ? Number(bitrateMatch[1]) : 0,
    sizeBytes: stat?.size || 0
  };
}

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(resolveBinaryPath(), args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...options.spawnOptions
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text, child);
    });

    child.stderr.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text, child);
    });

    child.on("error", reject);
    child.on("close", code => {
      if (options.acceptNonZero || code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        const error = new Error(stderr.trim() || `Video process exited with code ${code}`);
        error.exitCode = code;
        reject(error);
      }
    });

    options.onStart?.(child);
  });
}

async function probeVideo(inputPath) {
  const safePath = assertVideoPath(inputPath);
  const stat = fs.statSync(safePath);
  const result = await run(["-hide_banner", "-i", safePath], { acceptNonZero: true });
  return parseProbeOutput(result.stderr, stat);
}

async function createThumbnail(inputPath, cacheRoot) {
  const safePath = assertVideoPath(inputPath);
  const stat = fs.statSync(safePath);
  const metadata = await probeVideo(safePath);
  const hash = crypto
    .createHash("sha1")
    .update(`${safePath}:${stat.mtimeMs}:${stat.size}`)
    .digest("hex")
    .slice(0, 18);

  const outputDir = path.join(cacheRoot, "viral-ai-tool", "thumbnails");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${hash}.jpg`);

  if (!fs.existsSync(outputPath)) {
    const seek = metadata.duration > 3 ? Math.min(1.5, metadata.duration * 0.12) : 0;
    await run([
      "-y",
      "-ss", String(seek),
      "-i", safePath,
      "-frames:v", "1",
      "-vf", "scale=480:-2",
      "-q:v", "4",
      outputPath
    ]);
  }

  const data = fs.readFileSync(outputPath);
  return {
    dataUrl: `data:image/jpeg;base64,${data.toString("base64")}`,
    metadata
  };
}

function sanitizeBaseName(inputPath) {
  return path
    .basename(inputPath, path.extname(inputPath))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 90) || "video";
}

function makeOutputPath(inputPath, outputDir) {
  const base = sanitizeBaseName(inputPath);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");

  const first = path.join(outputDir, `${base}_exported_${stamp}.mp4`);
  if (!fs.existsSync(first)) return first;

  for (let index = 2; index <= 999; index++) {
    const candidate = path.join(outputDir, `${base}_exported_${stamp}_${index}.mp4`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw processingError("OUTPUT_NAME_UNAVAILABLE", "Could not allocate a unique output name.");
}

function parseProgressChunk(chunk, state) {
  const lines = (state.buffer + chunk).split(/\r?\n/);
  state.buffer = lines.pop() || "";

  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (key === "out_time") state.outTime = parseTimecode(value);
    if (key === "speed") state.speed = value;
    if (key === "fps") state.fps = Number(value) || 0;
    if (key === "frame") state.frame = Number(value) || 0;
  }
}

function removePartialFile(outputPath) {
  if (!outputPath) return;
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  } catch {
    // Cleanup failure should never replace the original processing result.
  }
}

async function renderVideo({ jobId, inputPath, outputDir, onProgress }) {
  validateJobId(jobId);
  const preflight = preflightExport({ inputPath, outputDir });
  const safeInput = preflight.inputPath;
  reservedRenders.set(jobId, safeInput);

  let metadata;
  let outputPath;
  const progressState = { buffer: "", outTime: 0, speed: "", fps: 0, frame: 0 };

  try {
    metadata = await probeVideo(safeInput);

    if (cancelledRenders.has(jobId)) {
      return { cancelled: true, outputPath: null, metadata };
    }

    outputPath = makeOutputPath(safeInput, preflight.outputDir);
  } catch (error) {
    reservedRenders.delete(jobId);
    cancelledRenders.delete(jobId);
    throw error;
  }

  const args = [
    "-n",
    "-i", safeInput,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    outputPath
  ];

  try {
    await run(args, {
      onStart(child) {
        activeRenders.set(jobId, {
          child,
          jobId,
          inputPath: safeInput,
          outputPath,
          startedAt: Date.now()
        });
      },
      onStdout(chunk) {
        parseProgressChunk(chunk, progressState);
        const duration = metadata.duration || 0;
        const percent = duration > 0
          ? Math.max(0, Math.min(99, Math.round((progressState.outTime / duration) * 100)))
          : 0;

        onProgress?.({
          jobId,
          percent,
          speed: progressState.speed,
          fps: progressState.fps,
          frame: progressState.frame
        });
      }
    });
  } catch (error) {
    const wasCancelled = cancelledRenders.has(jobId);
    removePartialFile(outputPath);

    if (wasCancelled) {
      return {
        cancelled: true,
        outputPath: null,
        metadata
      };
    }

    if (error instanceof ProcessingError) throw error;
    throw processingError("PROCESSING_FAILED", "Video processing failed.", {
      technicalMessage: error?.message || String(error)
    });
  } finally {
    activeRenders.delete(jobId);
    reservedRenders.delete(jobId);
    cancelledRenders.delete(jobId);
  }

  onProgress?.({ jobId, percent: 100, speed: "", fps: 0, frame: 0 });

  return {
    cancelled: false,
    outputPath,
    metadata,
    sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
  };
}

function cancelRender(jobId) {
  const active = activeRenders.get(jobId);
  const reserved = reservedRenders.has(jobId);
  if (!active && !reserved) return false;

  cancelledRenders.add(jobId);

  if (!active?.child) {
    return true;
  }

  try {
    active.child.kill("SIGTERM");
    return true;
  } catch {
    cancelledRenders.delete(jobId);
    return false;
  }
}

function cancelAllRenders() {
  let cancelled = 0;
  const ids = new Set([...activeRenders.keys(), ...reservedRenders.keys()]);
  for (const jobId of ids) {
    if (cancelRender(jobId)) cancelled++;
  }
  return cancelled;
}

function getActiveRenderCount() {
  return new Set([...activeRenders.keys(), ...reservedRenders.keys()]).size;
}

function serializeProcessingError(error) {
  return {
    code: error?.code || "PROCESSING_FAILED",
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  probeVideo,
  createThumbnail,
  preflightExport,
  renderVideo,
  cancelRender,
  cancelAllRenders,
  getActiveRenderCount,
  serializeProcessingError,
  assertVideoPath
};
