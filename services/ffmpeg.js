const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const activeRenders = new Map();

function resolveBinaryPath() {
  if (!ffmpegStatic) throw new Error("FFmpeg binary was not found.");
  return ffmpegStatic.replace("app.asar", "app.asar.unpacked");
}

function assertVideoPath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("Invalid video path.");
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) throw new Error("Video file does not exist.");
  if (!VIDEO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Unsupported video format.");
  }
  return resolved;
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
    const ffmpegPath = resolveBinaryPath();
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options.spawnOptions
    });

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
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
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
    const args = [
      "-y",
      "-ss", String(seek),
      "-i", safePath,
      "-frames:v", "1",
      "-vf", "scale=480:-2",
      "-q:v", "4",
      outputPath
    ];
    await run(args);
  }

  const data = fs.readFileSync(outputPath);
  return {
    dataUrl: `data:image/jpeg;base64,${data.toString("base64")}`,
    metadata
  };
}

function makeOutputPath(inputPath, outputDir) {
  const safeInput = assertVideoPath(inputPath);
  const resolvedDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  const base = path
    .basename(safeInput, path.extname(safeInput))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 90);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");

  return path.join(resolvedDir, `${base}_rendered_${stamp}.mp4`);
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
    if (key === "progress") state.progressState = value;
  }
}

async function renderVideo({ jobId, inputPath, outputDir, onProgress }) {
  if (!jobId || typeof jobId !== "string") throw new Error("Missing render job id.");
  const safeInput = assertVideoPath(inputPath);
  if (typeof outputDir !== "string" || !outputDir.trim()) throw new Error("Missing output folder.");

  const metadata = await probeVideo(safeInput);
  const outputPath = makeOutputPath(safeInput, outputDir);
  const progressState = { buffer: "", outTime: 0, speed: "", fps: 0, frame: 0, progressState: "" };

  const args = [
    "-y",
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

  await run(args, {
    onStart(child) {
      activeRenders.set(jobId, child);
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
  }).finally(() => {
    activeRenders.delete(jobId);
  });

  onProgress?.({ jobId, percent: 100, speed: "", fps: 0, frame: 0 });

  return {
    outputPath,
    metadata,
    sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
  };
}

function cancelRender(jobId) {
  const child = activeRenders.get(jobId);
  if (!child) return false;

  try {
    child.kill("SIGTERM");
    activeRenders.delete(jobId);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  probeVideo,
  createThumbnail,
  renderVideo,
  cancelRender,
  assertVideoPath
};
