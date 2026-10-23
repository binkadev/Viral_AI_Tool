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

function makeOutputPath(inputPath, outputDir, suffix = "exported") {
  const base = sanitizeBaseName(inputPath);
  const safeSuffix = String(suffix || "exported").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "exported";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");

  const first = path.join(outputDir, `${base}_${safeSuffix}_${stamp}.mp4`);
  if (!fs.existsSync(first)) return first;

  for (let index = 2; index <= 999; index++) {
    const candidate = path.join(outputDir, `${base}_${safeSuffix}_${stamp}_${index}.mp4`);
    if (!fs.existsSync(candidate)) return candidate;
  }

  throw processingError("OUTPUT_NAME_UNAVAILABLE", "Could not allocate a unique output name.");
}


function assertVoiceAudioPath(audioPath, allowedAudioRoot) {
  if (typeof audioPath !== "string" || !audioPath.trim()) {
    throw processingError("VOICE_AUDIO_MISSING", "AI voice audio path is missing.");
  }

  const resolved = path.resolve(audioPath);
  const root = path.resolve(String(allowedAudioRoot || ""));

  if (!root || (resolved !== root && !resolved.startsWith(root + path.sep))) {
    throw processingError("VOICE_AUDIO_UNTRUSTED", "AI voice audio is outside the application cache.");
  }

  if (path.extname(resolved).toLowerCase() !== ".wav") {
    throw processingError("VOICE_AUDIO_INVALID", "AI voice audio must be a WAV file.");
  }

  if (!fs.existsSync(resolved)) {
    throw processingError("VOICE_AUDIO_MISSING", "AI voice audio file no longer exists.", {
      audioPath: resolved
    });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 44) {
    throw processingError("VOICE_AUDIO_INVALID", "AI voice audio file is invalid.");
  }

  return resolved;
}

function normalizeTimedSegments(segments, { requireAudio = false, allowedAudioRoot } = {}) {
  if (!Array.isArray(segments) || !segments.length) {
    throw processingError(
      requireAudio ? "VOICE_RESULT_REQUIRED" : "SUBTITLE_RESULT_REQUIRED",
      requireAudio ? "AI voice result is required." : "Subtitle data is required."
    );
  }

  if (segments.length > 300) {
    throw processingError("TOO_MANY_SEGMENTS", "Too many timed segments for one export.", {
      maxSegments: 300
    });
  }

  return segments.map((segment, index) => {
    const start = Number(segment?.start);
    const end = Number(segment?.end);

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 4 * 60 * 60) {
      throw processingError("TIMING_INVALID", "A segment has invalid timing.", { index });
    }

    const normalized = {
      id: String(segment?.id || "segment-" + (index + 1)),
      start,
      end,
      text: String(segment?.text || "").trim().slice(0, 2000),
      speaker: segment?.speaker ? String(segment.speaker) : null
    };

    if (requireAudio) {
      normalized.audioPath = assertVoiceAudioPath(segment?.audioPath, allowedAudioRoot);
      const audioDuration = Number(segment?.audioDuration);
      normalized.audioDuration = Number.isFinite(audioDuration) && audioDuration > 0
        ? audioDuration
        : Math.max(0.01, end - start);
      normalized.timingRisk = segment?.timingRisk === true;
    }

    return normalized;
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

function srtTimestamp(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const totalMs = Math.round(value * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return String(hours).padStart(2, "0") + ":" +
    String(minutes).padStart(2, "0") + ":" +
    String(secs).padStart(2, "0") + "," +
    String(ms).padStart(3, "0");
}

function buildSrt(segments) {
  return segments.map((segment, index) => {
    const text = String(segment.text || "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return [
      String(index + 1),
      srtTimestamp(segment.start) + " --> " + srtTimestamp(segment.end),
      text || " ",
      ""
    ].join("\n");
  }).join("\n");
}

function escapeFilterPath(filePath) {
  return path.resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function atempoFilters(factor) {
  let remaining = Math.max(0.01, Number(factor || 1));
  const filters = [];

  while (remaining > 2.0) {
    filters.push("atempo=2.0");
    remaining /= 2.0;
  }

  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }

  if (Math.abs(remaining - 1) > 0.005) {
    filters.push("atempo=" + remaining.toFixed(5));
  }

  return filters;
}

function preflightLocalizedExport({
  inputPath,
  outputDir,
  voiceSegments,
  subtitleSegments,
  allowedAudioRoot,
  burnSubtitles = true
}) {
  const base = preflightExport({ inputPath, outputDir });
  const voices = normalizeTimedSegments(voiceSegments, {
    requireAudio: true,
    allowedAudioRoot
  });
  const subtitles = burnSubtitles
    ? normalizeTimedSegments(subtitleSegments, { requireAudio: false })
    : [];

  return {
    ...base,
    voiceSegmentCount: voices.length,
    subtitleSegmentCount: subtitles.length,
    timingWarningCount: voices.filter(item => item.timingRisk).length
  };
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
      reservedRenders.delete(jobId);
      cancelledRenders.delete(jobId);
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


async function renderLocalizedVideo({
  jobId,
  inputPath,
  outputDir,
  voiceSegments,
  subtitleSegments,
  allowedAudioRoot,
  burnSubtitles = true,
  mixOriginalAudio = true,
  originalAudioVolume = 0.12,
  onProgress
}) {
  validateJobId(jobId);

  const preflight = preflightLocalizedExport({
    inputPath,
    outputDir,
    voiceSegments,
    subtitleSegments,
    allowedAudioRoot,
    burnSubtitles
  });

  const safeInput = preflight.inputPath;
  const voices = normalizeTimedSegments(voiceSegments, {
    requireAudio: true,
    allowedAudioRoot
  });
  const subtitles = burnSubtitles
    ? normalizeTimedSegments(subtitleSegments, { requireAudio: false })
    : [];

  reservedRenders.set(jobId, safeInput);

  let metadata;
  let outputPath;
  let subtitlePath = null;
  const progressState = { buffer: "", outTime: 0, speed: "", fps: 0, frame: 0 };

  try {
    onProgress?.({
      jobId,
      phase: "preparing",
      percent: 1,
      speed: "",
      fps: 0,
      frame: 0
    });

    metadata = await probeVideo(safeInput);

    if (!metadata?.duration || metadata.duration <= 0) {
      throw processingError("SOURCE_DURATION_INVALID", "Source video duration could not be detected.");
    }

    const duration = metadata.duration;
    const lastVoiceEnd = Math.max(...voices.map(item => item.end));
    if (lastVoiceEnd > duration + 1.5) {
      throw processingError("TIMING_OUTSIDE_VIDEO", "AI voice timing extends beyond the source video.", {
        videoDuration: duration,
        lastVoiceEnd
      });
    }

    outputPath = makeOutputPath(safeInput, preflight.outputDir, "localized");

    if (burnSubtitles) {
      subtitlePath = path.join(
        preflight.outputDir,
        ".viral-ai-" + jobId + "-" + crypto.randomBytes(4).toString("hex") + ".srt"
      );
      fs.writeFileSync(subtitlePath, buildSrt(subtitles), "utf8");
    }

    if (cancelledRenders.has(jobId)) {
      return { cancelled: true, outputPath: null, metadata };
    }

    const args = ["-n", "-i", safeInput];
    voices.forEach(segment => {
      args.push("-i", segment.audioPath);
    });

    const filters = [];
    const voiceLabels = [];

    voices.forEach((segment, index) => {
      const inputIndex = index + 1;
      const slotDuration = Math.max(0.01, segment.end - segment.start);
      const speedFactor = segment.audioDuration > slotDuration * 1.02
        ? segment.audioDuration / slotDuration
        : 1;

      const chain = [
        "aresample=48000",
        "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
        "asetpts=PTS-STARTPTS",
        ...atempoFilters(speedFactor),
        "atrim=duration=" + slotDuration.toFixed(3),
        "adelay=" + Math.max(0, Math.round(segment.start * 1000)) + ":all=1"
      ];

      const label = "voice" + index;
      filters.push("[" + inputIndex + ":a]" + chain.join(",") + "[" + label + "]");
      voiceLabels.push("[" + label + "]");
    });

    const audioInputs = [...voiceLabels];
    const safeOriginalVolume = Math.max(0, Math.min(1, Number(originalAudioVolume || 0)));

    if (mixOriginalAudio && metadata.audioCodec) {
      filters.push(
        "[0:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=" +
        safeOriginalVolume.toFixed(3) + "[original]"
      );
      audioInputs.unshift("[original]");
    }

    if (audioInputs.length === 1) {
      filters.push(
        audioInputs[0] +
        "atrim=duration=" + metadata.duration.toFixed(3) +
        ",alimiter=limit=0.95[aout]"
      );
    } else {
      filters.push(
        audioInputs.join("") +
        "amix=inputs=" + audioInputs.length +
        ":duration=longest:dropout_transition=0:normalize=0," +
        "atrim=duration=" + metadata.duration.toFixed(3) +
        ",alimiter=limit=0.95[aout]"
      );
    }

    if (burnSubtitles && subtitlePath) {
      filters.push(
        "[0:v:0]subtitles=filename='" + escapeFilterPath(subtitlePath) +
        "':force_style='Alignment=2,MarginV=54,Outline=2,Shadow=0'[vout]"
      );
    }

    args.push("-filter_complex", filters.join(";"));
    args.push("-map", burnSubtitles ? "[vout]" : "0:v:0");
    args.push("-map", "[aout]");
    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-t", metadata.duration.toFixed(3),
      "-progress", "pipe:1",
      "-nostats",
      outputPath
    );

    await run(args, {
      onStart(child) {
        activeRenders.set(jobId, {
          child,
          jobId,
          inputPath: safeInput,
          outputPath,
          startedAt: Date.now(),
          localized: true
        });
      },
      onStdout(chunk) {
        parseProgressChunk(chunk, progressState);
        const rawPercent = metadata.duration > 0
          ? Math.max(0, Math.min(99, (progressState.outTime / metadata.duration) * 100))
          : 0;
        const percent = Math.max(3, Math.min(99, Math.round(3 + rawPercent * 0.96)));

        onProgress?.({
          jobId,
          phase: "rendering",
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

    const technicalMessage = error?.message || String(error);
    const subtitleFailure = /subtitles|libass|ass renderer|No such filter/i.test(technicalMessage);

    throw processingError(
      subtitleFailure ? "SUBTITLE_RENDER_UNAVAILABLE" : "PROCESSING_FAILED",
      subtitleFailure ? "Subtitle rendering is unavailable." : "Localized video processing failed.",
      { technicalMessage }
    );
  } finally {
    activeRenders.delete(jobId);
    reservedRenders.delete(jobId);
    cancelledRenders.delete(jobId);

    if (subtitlePath) {
      try { fs.unlinkSync(subtitlePath); } catch {}
    }
  }

  onProgress?.({
    jobId,
    phase: "finalizing",
    percent: 100,
    speed: "",
    fps: 0,
    frame: 0
  });

  return {
    cancelled: false,
    outputPath,
    metadata,
    sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
    localized: true,
    pipeline: {
      voiceSegmentCount: voices.length,
      subtitleSegmentCount: subtitles.length,
      timingWarningCount: voices.filter(item => item.timingRisk).length,
      originalAudioMixed: Boolean(mixOriginalAudio && metadata.audioCodec),
      burnSubtitles: Boolean(burnSubtitles)
    }
  };
}

// Project composition uses the same logical reservations and child lifecycle as
// source exports. Only generated relative filenames enter concat manifests.
function projectAssert(condition, code = "PROJECT_RENDER_INCOMPLETE") {
  if (!condition) throw processingError(code, "Project render input is invalid.");
}
function projectKeys(value, keys) {
  projectAssert(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)));
}
function projectLocal(filePath, kind) {
  const { MEDIA_EXTENSIONS } = require("./media/local-files");
  projectAssert(typeof filePath === "string" && filePath.length <= 32767 && !filePath.includes("\0") && path.isAbsolute(filePath) && !/^(https?:|file:|blob:)/i.test(filePath), "PROJECT_RENDER_MEDIA_MISSING");
  projectAssert(MEDIA_EXTENSIONS[kind]?.includes(path.extname(filePath).slice(1).toLowerCase()), "SOURCE_UNSUPPORTED");
  let stat;
  try { stat = fs.statSync(filePath); } catch { throw processingError("PROJECT_RENDER_MEDIA_MISSING", "Project input is missing."); }
  projectAssert(stat.isFile() && stat.size > 0, "PROJECT_RENDER_MEDIA_MISSING");
  return stat;
}
function validateProjectPayload(p, allowedAudioRoot) {
  projectKeys(p, ["projectId","projectName","renderInputSignature","profile","scenes","settings","voice","subtitles","bgm","duration","subtitleSource","outputDir","jobId"]);
  const id = v => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\x00-\x1f]/.test(v);
  projectAssert(id(p.projectId) && typeof p.projectName === "string" && p.projectName.length <= 512 && /^project-render-v1:[a-f0-9]{64}$/.test(p.renderInputSignature));
  validateJobId(p.jobId);
  projectKeys(p.profile, ["width","height","fps"]);
  projectAssert([[1920,1080],[1080,1920],[1080,1080]].some(([w,h]) => p.profile.width === w && p.profile.height === h) && p.profile.fps === 30, "PROJECT_RENDER_PROFILE_UNRESOLVED");
  projectAssert(Number.isFinite(p.duration) && p.duration > 0 && p.duration <= Number.MAX_SAFE_INTEGER / 48000, "PROJECT_RENDER_TIMING_INVALID");
  projectAssert(Array.isArray(p.scenes) && p.scenes.length > 0 && p.scenes.length <= require("../renderer/core-scene-plan-model").MAX_SCENES);
  projectKeys(p.settings, ["burnSubtitles","textSource","voiceEnabled","voiceVolume","bgmAssetId","bgmVolume","bgmLoop","mixOriginalAudio","originalAudioVolume"]);
  const s = p.settings;
  for (const k of ["burnSubtitles","voiceEnabled","bgmLoop","mixOriginalAudio"]) projectAssert(typeof s[k] === "boolean");
  for (const k of ["voiceVolume","bgmVolume","originalAudioVolume"]) projectAssert(Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 1);
  projectAssert(["auto","source","translation"].includes(s.textSource) && ["source","translation"].includes(p.subtitleSource) && (s.bgmAssetId === null || id(s.bgmAssetId)));
  const files = new Map(), add = (f,k) => { const stat = projectLocal(f,k); files.set(path.resolve(f), stat); return stat; };
  const identityKeys = ["assetId","kind","localPath","updatedAt","meta"];
  const identity = (a,kind) => {
    projectAssert(id(a.assetId) && a.kind === kind && (a.updatedAt === null || typeof a.updatedAt === "string" && a.updatedAt.length <= 100));
    projectKeys(a.meta, ["duration","width","height","sizeBytes"]);
    for (const v of Object.values(a.meta)) projectAssert(v === null || Number.isFinite(v) && v >= 0);
    return add(a.localPath, kind);
  };
  let cursor = 0;
  const sceneIds = new Set();
  for (const e of p.scenes) {
    projectKeys(e, ["sceneId","order",...identityKeys,"projectStart","projectEnd","duration","fit","transition"]);
    projectAssert(id(e.sceneId) && !sceneIds.has(e.sceneId) && Number.isInteger(e.order) && e.order >= 0 && (sceneIds.size === 0 || e.order > p.scenes[sceneIds.size-1].order)); sceneIds.add(e.sceneId);
    projectAssert(["video","image"].includes(e.kind) && e.fit === "contain-pad" && e.transition === "cut");
    projectAssert(Number.isFinite(e.duration) && e.duration > 0 && Math.abs(e.projectStart-cursor) < 1e-6 && Math.abs(e.projectEnd-e.projectStart-e.duration) < 1e-6, "PROJECT_RENDER_TIMING_INVALID");
    identity(e,e.kind); cursor = e.projectEnd;
  }
  projectAssert(Math.abs(cursor-p.duration) < 1e-6, "PROJECT_RENDER_TIMING_INVALID");
  function cues(list, voice) {
    projectAssert(Array.isArray(list) && list.length <= (voice ? 300 : 10000), "PROJECT_RENDER_TIMING_INVALID");
    const ids = new Set(); let end = 0;
    for (const c of list) {
      projectKeys(c, voice ? ["id","start","end","text","speaker","audioPath","audioUrl","audioDuration","timingRisk"] : ["id","start","end","text"]);
      projectAssert(typeof c.id === "string" && c.id.length > 0 && c.id.length <= 2048 && !ids.has(c.id) && typeof c.text === "string" && c.text.length > 0 && c.text.length <= 4096);
      ids.add(c.id);
      projectAssert(Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= end - 1e-6 && c.end > c.start && c.end <= p.duration + 1e-6, "PROJECT_RENDER_TIMING_INVALID"); end = c.end;
      if (voice) {
        projectAssert(id(c.speaker) && Number.isFinite(c.audioDuration) && c.audioDuration > 0 && c.audioDuration <= Number.MAX_SAFE_INTEGER / 48000 && typeof c.timingRisk === "boolean");
        projectAssert(typeof allowedAudioRoot === "string" && path.isAbsolute(allowedAudioRoot), "VOICE_AUDIO_UNTRUSTED");
        assertVoiceAudioPath(c.audioPath, allowedAudioRoot);
        // Also check the real paths: junctions/symlinks cannot escape the cache.
        projectAssert(path.isAbsolute(c.audioPath) && !c.audioPath.includes("\0"), "VOICE_AUDIO_UNTRUSTED");
        const real = fs.realpathSync(c.audioPath), root = fs.realpathSync(allowedAudioRoot);
        projectAssert(real.startsWith(root + path.sep), "VOICE_AUDIO_UNTRUSTED");
        add(c.audioPath,"audio");
        const header = Buffer.alloc(12), fd = fs.openSync(c.audioPath,"r");
        try { fs.readSync(fd,header,0,12,0); } finally { fs.closeSync(fd); }
        projectAssert(header.toString("ascii",0,4) === "RIFF" && header.toString("ascii",8,12) === "WAVE", "VOICE_AUDIO_INVALID");
      }
    }
  }
  if (s.voiceEnabled) {
    projectKeys(p.voice,["projectId","inputSignature","textSource","language","segments"]);
    projectAssert(p.voice.projectId === p.projectId && /^project-voice-v1:[a-f0-9]{64}$/.test(p.voice.inputSignature) && p.voice.textSource === s.textSource && typeof p.voice.language === "string" && p.voice.language.length <= 80 && p.voice.segments?.length > 0, "PROJECT_RENDER_VOICE_REQUIRED");
    cues(p.voice.segments,true);
  } else projectAssert(p.voice === null);
  cues(p.subtitles,false);
  projectAssert(s.burnSubtitles || p.subtitles.length === 0);
  if (s.bgmAssetId !== null) {
    projectKeys(p.bgm,identityKeys); projectAssert(p.bgm.assetId === s.bgmAssetId, "PROJECT_RENDER_BGM_UNAVAILABLE"); identity(p.bgm,"audio");
  } else projectAssert(p.bgm === null);
  return files;
}
async function preflightProjectRender(payload, { allowedAudioRoot, onProbe } = {}) {
  const p = JSON.parse(JSON.stringify(payload));
  const files = validateProjectPayload(p, allowedAudioRoot);
  const outputDir = assertOutputDirectory(p.outputDir);
  const inputBytes=[...files.values()].reduce((n,s) => n+s.size,0);
  // Budget long still-image Projects as well as byte-heavy video inputs. One
  // encoded bit per output pixel/frame is a conservative staging estimate; PCM
  // Voice parts plus merged track and BGM are also covered by the same multiplier.
  const stagedEstimate=p.profile.width*p.profile.height*30*p.duration/8 + p.duration*48000*4*((p.voice?2:0)+(p.bgm?1:0));
  const requiredFreeBytes = Math.max(MIN_FREE_BYTES, Math.ceil(Math.max(inputBytes,stagedEstimate)*OUTPUT_MULTIPLIER));
  // Both volumes matter: stage files live in app temp, final output in destination.
  const tempFree = availableDiskBytes(require("os").tmpdir()), outputFree = availableDiskBytes(outputDir);
  const freeBytes = Math.min(...[tempFree,outputFree].filter(n => n !== null));
  projectAssert(Number.isFinite(freeBytes), "OUTPUT_UNAVAILABLE");
  if (freeBytes < requiredFreeBytes) throw processingError("LOW_DISK_SPACE", "Not enough free disk space.",{freeBytes,requiredFreeBytes});
  const probes = new Map();
  for (const [f,stat] of files) {
    const result = await run(["-hide_banner","-i",f], { acceptNonZero: true, onStart: onProbe });
    probes.set(f,parseProbeOutput(result.stderr,stat));
    const current=fs.statSync(f); projectAssert(current.size===stat.size && current.mtimeMs===stat.mtimeMs && current.ctimeMs===stat.ctimeMs,"PROJECT_RENDER_INPUT_CHANGED");
  }
  for (const e of p.scenes) {
    const probe = probes.get(path.resolve(e.localPath));
    projectAssert(probe.width > 0 && probe.height > 0, "PROJECT_RENDER_INPUT_CHANGED");
    if (e.meta.width) projectAssert(probe.width === e.meta.width, "PROJECT_RENDER_INPUT_CHANGED");
    if (e.meta.height) projectAssert(probe.height === e.meta.height, "PROJECT_RENDER_INPUT_CHANGED");
    if (e.meta.sizeBytes) projectAssert(files.get(path.resolve(e.localPath)).size === e.meta.sizeBytes, "PROJECT_RENDER_INPUT_CHANGED");
    if (e.kind === "video") projectAssert(Math.abs(probe.duration-e.duration) <= .05, "PROJECT_RENDER_INPUT_CHANGED");
  }
  if (p.bgm) projectAssert(!!probes.get(path.resolve(p.bgm.localPath)).audioCodec, "PROJECT_RENDER_BGM_UNAVAILABLE");
  if (p.voice) for (const c of p.voice.segments) projectAssert(!!probes.get(path.resolve(c.audioPath)).audioCodec && probes.get(path.resolve(c.audioPath)).duration > 0, "VOICE_AUDIO_INVALID");
  return { projectId: p.projectId, sceneCount: p.scenes.length, duration: p.duration, ...p.profile, requiredFreeBytes, freeBytes,
    voiceEnabled: p.settings.voiceEnabled, bgmEnabled: !!p.bgm, subtitleCount: p.subtitles.length,
    timingWarningCount: p.voice?.segments.filter(c => c.timingRisk).length || 0 };
}
async function renderProjectVideo(payload, { allowedAudioRoot, onProgress } = {}) {
  const p = JSON.parse(JSON.stringify(payload)), key = "project:" + p.projectId + ":" + p.renderInputSignature;
  validateJobId(p.jobId);
  projectAssert(!activeRenders.has(p.jobId) && !reservedRenders.has(p.jobId) && ![...reservedRenders.values()].includes(key), "PROJECT_RENDER_DUPLICATE");
  reservedRenders.set(p.jobId,key); // synchronous reservation, also covers probing/stage gaps
  let workspace, outputPath, outputOwned = false, success = false;
  const check = () => { if (cancelledRenders.has(p.jobId)) throw processingError("CANCELLED","Render cancelled."); };
  const progress = (phase,percent,extra={}) => { check(); onProgress?.({jobId:p.jobId,projectId:p.projectId,phase,percent,...extra}); check(); };
  const childStarted = child => { activeRenders.set(p.jobId,{child,jobId:p.jobId,inputPath:key,outputPath}); if (cancelledRenders.has(p.jobId)) child.kill("SIGTERM"); };
  async function stage(args,phase,start,span,duration=p.duration,extra={}) {
    check(); progress(phase,start,extra);
    const state = {buffer:"",outTime:0};
    await run(["-hide_banner","-loglevel","error","-nostdin",...args,"-progress","pipe:1","-nostats"], {
      onStart:childStarted, onStdout(chunk) { parseProgressChunk(chunk,state); if (!cancelledRenders.has(p.jobId)) onProgress?.({jobId:p.jobId,projectId:p.projectId,phase,percent:Math.min(99,start+span*Math.min(1,state.outTime/duration)),...extra}); }
    });
    activeRenders.delete(p.jobId); check(); progress(phase,start+span,extra);
  }
  const aformat = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS";
  const vcodec = ["-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-r","30"];
  const acodec = ["-c:a","aac","-ar","48000","-ac","2","-b:a","192k"];
  try {
    progress("preparing",0);
    const identities=validateProjectPayload(p,allowedAudioRoot);
    const checkInputs=()=>{for(const [file,stat] of identities){let current;try{current=fs.statSync(file);}catch{throw processingError("PROJECT_RENDER_INPUT_CHANGED","Project input changed.");}projectAssert(current.size===stat.size&&current.mtimeMs===stat.mtimeMs&&current.ctimeMs===stat.ctimeMs,"PROJECT_RENDER_INPUT_CHANGED");}};
    const preflight = await preflightProjectRender(p,{allowedAudioRoot,onProbe:childStarted}); check(); activeRenders.delete(p.jobId);
    checkInputs();
    const root = path.join(require("os").tmpdir(),"viral-ai-tool","project-render"); fs.mkdirSync(root,{recursive:true});
    workspace = fs.mkdtempSync(path.join(root,p.jobId+"-"));
    fs.writeFileSync(path.join(workspace,"owner.json"),JSON.stringify({pid:process.pid}));
    outputPath = makeOutputPath(sanitizeBaseName(p.projectName),p.outputDir,"render_"+crypto.randomBytes(8).toString("hex"));
    // Atomically reserve a new output; only our own placeholder may be replaced.
    fs.closeSync(fs.openSync(outputPath,"wx")); outputOwned=true;
    const clips = [];
    for (let i=0;i<p.scenes.length;i++) {
      checkInputs();
      const e=p.scenes[i], filename="scene-"+i+".mp4", out=path.join(workspace,filename), probe=await run(["-hide_banner","-i",e.localPath],{acceptNonZero:true,onStart:childStarted}); check();
      const hasAudio = !!parseProbeOutput(probe.stderr).audioCodec && e.kind === "video" && p.settings.mixOriginalAudio;
      const imageInput=path.extname(e.localPath).toLowerCase()===".gif" ? ["-stream_loop","-1"] : ["-loop","1","-framerate","30"];
      const args=["-n",...(e.kind === "image" ? imageInput : []),"-i",e.localPath];
      if (!hasAudio) args.push("-f","lavfi","-i","anullsrc=r=48000:cl=stereo");
      args.push("-map","0:v:0","-map",hasAudio ? "0:a:0" : "1:a:0","-vf",`scale=${p.profile.width}:${p.profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${p.profile.width}:${p.profile.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=0.05`,
        "-af",aformat+",volume="+(hasAudio ? p.settings.originalAudioVolume : 0)+",apad,atrim=duration="+e.duration,
        ...vcodec,...acodec,"-t",String(e.duration),out);
      await stage(args,"scenes",3+52*i/p.scenes.length,52/p.scenes.length,e.duration,{sceneIndex:i+1,sceneCount:p.scenes.length}); clips.push(filename);
    }
    const manifest = (name,list,durations) => { const file=path.join(workspace,name); fs.writeFileSync(file,list.map((f,i) => "file '"+f+"'"+(durations ? "\nduration "+durations[i] : "")).join("\n"),"utf8"); return file; };
    const visual=path.join(workspace,"visual.mp4");
    await stage(["-n","-f","concat","-safe","1","-i",manifest("visual.txt",clips,p.scenes.map(e=>e.duration)),"-c","copy","-t",String(p.duration),visual],"composing",55,4);
    const tracks=[];
    if (p.voice) {
      const parts=[]; let cursor=0;
      async function voicePart(duration,audioPath) {
        if (duration <= 1e-7) return;
        const name="voice-"+parts.length+".wav";
        await stage(["-n",...(audioPath ? ["-i",audioPath] : ["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]),"-vn","-af",aformat+",apad,atrim=duration="+duration,"-t",String(duration),"-c:a","pcm_s16le",path.join(workspace,name)],"voice",59,0,duration);
        parts.push(name);
      }
      for (const c of p.voice.segments) { await voicePart(c.start-cursor); await voicePart(c.end-c.start,c.audioPath); cursor=c.end; }
      await voicePart(p.duration-cursor);
      const voice=path.join(workspace,"voice.wav");
      await stage(["-n","-f","concat","-safe","1","-i",manifest("voice.txt",parts),"-af","volume="+p.settings.voiceVolume,"-t",String(p.duration),"-c:a","pcm_s16le",voice],"voice",59,10); tracks.push(voice);
    }
    if (p.bgm) {
      const bgm=path.join(workspace,"bgm.wav");
      await stage(["-n",...(p.settings.bgmLoop ? ["-stream_loop","-1"] : []),"-i",p.bgm.localPath,"-vn","-af",aformat+",volume="+p.settings.bgmVolume+",apad,atrim=duration="+p.duration,"-t",String(p.duration),"-c:a","pcm_s16le",bgm],"audio",69,7); tracks.push(bgm);
    }
    const args=["-y","-i",visual]; for (const track of tracks) args.push("-i",track);
    const labels=Array.from({length:tracks.length+1},(_,i)=>`[${i}:a:0]`).join("");
    const filters=[labels+`amix=inputs=${tracks.length+1}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${p.duration},alimiter=limit=0.95:level=0[aout]`];
    const subs=p.settings.burnSubtitles && p.subtitles.length;
    if (subs) { const srt=path.join(workspace,"subtitles.srt");
      const safeCues=p.subtitles.map(c=>({...c,text:c.text.replace(/\r/g,"").replace(/\n+/g,"\n").replace(/<[^>]*>/g,"").replace(/[{}]/g,"")}));
      fs.writeFileSync(srt,buildSrt(safeCues),"utf8");
      filters.push("[0:v:0]subtitles=filename='"+escapeFilterPath(srt)+"':force_style='Alignment=2,MarginV=54,Outline=2,Shadow=0'[vout]"); }
    args.push("-filter_complex",filters.join(";"),"-map",subs ? "[vout]" : "0:v:0","-map","[aout]",...vcodec,...acodec,"-movflags","+faststart","-t",String(p.duration),outputPath);
    await stage(args,"finalizing",76,20);
    progress("verifying",96);
    const stat=fs.statSync(outputPath); projectAssert(stat.isFile() && stat.size > 0,"PROJECT_RENDER_VERIFY_FAILED");
    const probe=await run(["-hide_banner","-i",outputPath],{acceptNonZero:true,onStart:childStarted}); check();
    const metadata=parseProbeOutput(probe.stderr,stat);
    checkInputs();
    projectAssert(metadata.width === p.profile.width && metadata.height === p.profile.height && metadata.duration > 0 && Math.abs(metadata.duration-p.duration) <= .08 && Math.abs(metadata.fps-30) < .01 && metadata.videoCodec === "h264" && metadata.audioCodec === "aac", "PROJECT_RENDER_VERIFY_FAILED");
    progress("verifying",100); success=true;
    return { cancelled:false,projectId:p.projectId,renderInputSignature:p.renderInputSignature,outputPath,sizeBytes:stat.size,metadata,
      pipeline:{sceneCount:p.scenes.length,duration:p.duration,profile:p.profile,originalAudioMixed:p.settings.mixOriginalAudio,voiceMixed:!!p.voice,bgmMixed:!!p.bgm,bgmLoop:p.settings.bgmLoop,burnSubtitles:p.settings.burnSubtitles,subtitleCount:p.subtitles.length,timingWarningCount:preflight.timingWarningCount} };
  } catch (error) {
    if (cancelledRenders.has(p.jobId)) return {cancelled:true,outputPath:null,projectId:p.projectId};
    if (error instanceof ProcessingError) throw error;
    throw processingError(/subtitles|libass|No such filter/i.test(error?.message || "") ? "SUBTITLE_RENDER_UNAVAILABLE" : "PROCESSING_FAILED","Project video processing failed.");
  } finally {
    if (!success && outputOwned) removePartialFile(outputPath);
    if (workspace) { try { fs.rmSync(workspace,{recursive:true,force:true}); } catch {} }
    activeRenders.delete(p.jobId); reservedRenders.delete(p.jobId); cancelledRenders.delete(p.jobId);
  }
}

function cleanupProjectRenderWorkspaces() {
  const root=path.join(require("os").tmpdir(),"viral-ai-tool","project-render");
  let count=0;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return count;
    for (const name of fs.readdirSync(root)) {
      if (!/^[A-Za-z0-9._-]{1,128}-[A-Za-z0-9]{6}$/.test(name)) continue;
      const target=path.resolve(root,name);
      if (path.dirname(target) !== path.resolve(root) || fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isDirectory()) continue;
      try {
        const owner=path.join(target,"owner.json"); if (fs.lstatSync(owner).size > 100 || fs.lstatSync(owner).isSymbolicLink()) continue;
        const pid=JSON.parse(fs.readFileSync(owner,"utf8")).pid;
        if (!Number.isInteger(pid) || pid <= 0) continue;
        try { process.kill(pid,0); continue; } catch(e) { if (e.code !== "ESRCH") continue; }
        fs.rmSync(target,{recursive:true,force:true}); count++;
      } catch {}
    }
  } catch {}
  return count;
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
  preflightProjectRender,
  renderProjectVideo,
  cleanupProjectRenderWorkspaces,
  probeVideo,
  createThumbnail,
  preflightExport,
  preflightLocalizedExport,
  renderVideo,
  renderLocalizedVideo,
  cancelRender,
  cancelAllRenders,
  getActiveRenderCount,
  serializeProcessingError,
  assertVideoPath
};
