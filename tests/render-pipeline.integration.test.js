const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");

const {
  probeVideo,
  preflightLocalizedExport,
  renderLocalizedVideo
} = require("../services/ffmpeg");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || "ffmpeg exited with code " + code));
    });
  });
}

async function createFixtures(root) {
  const source = path.join(root, "source.mp4");
  const voiceRoot = path.join(root, "voice-cache");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(voiceRoot, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const voice1 = path.join(voiceRoot, "voice-1.wav");
  const voice2 = path.join(voiceRoot, "voice-2.wav");

  await runFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", "color=c=black:s=640x360:r=30:d=5",
    "-f", "lavfi",
    "-i", "sine=frequency=220:sample_rate=48000:duration=5",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    source
  ]);

  await runFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=660:sample_rate=48000:duration=2.2",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    voice1
  ]);

  await runFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", "sine=frequency=880:sample_rate=48000:duration=0.8",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    voice2
  ]);

  return { source, voiceRoot, outputDir, voice1, voice2 };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-render-e2e-"));

  try {
    const fixtures = await createFixtures(root);

    const voiceSegments = [
      {
        id: "voice-1",
        start: 0.5,
        end: 1.5,
        text: "Xin chao",
        audioPath: fixtures.voice1,
        audioDuration: 2.2,
        timingRisk: true
      },
      {
        id: "voice-2",
        start: 2.4,
        end: 3.4,
        text: "Viral AI Tool",
        audioPath: fixtures.voice2,
        audioDuration: 0.8,
        timingRisk: false
      }
    ];

    const subtitleSegments = [
      {
        id: "sub-1",
        start: 0.5,
        end: 1.5,
        text: "Xin chào"
      },
      {
        id: "sub-2",
        start: 2.4,
        end: 3.4,
        text: "Viral AI Tool"
      }
    ];

    const preflight = preflightLocalizedExport({
      inputPath: fixtures.source,
      outputDir: fixtures.outputDir,
      voiceSegments,
      subtitleSegments,
      allowedAudioRoot: fixtures.voiceRoot,
      burnSubtitles: true
    });

    assert.strictEqual(preflight.voiceSegmentCount, 2);
    assert.strictEqual(preflight.subtitleSegmentCount, 2);
    assert.strictEqual(preflight.timingWarningCount, 1);

    const outsideVoice = path.join(root, "outside.wav");
    fs.copyFileSync(fixtures.voice2, outsideVoice);

    assert.throws(
      () => preflightLocalizedExport({
        inputPath: fixtures.source,
        outputDir: fixtures.outputDir,
        voiceSegments: [{
          ...voiceSegments[1],
          audioPath: outsideVoice
        }],
        subtitleSegments,
        allowedAudioRoot: fixtures.voiceRoot,
        burnSubtitles: true
      }),
      error => error?.code === "VOICE_AUDIO_UNTRUSTED"
    );

    const progress = [];
    const result = await renderLocalizedVideo({
      jobId: "render-e2e-test",
      inputPath: fixtures.source,
      outputDir: fixtures.outputDir,
      voiceSegments,
      subtitleSegments,
      allowedAudioRoot: fixtures.voiceRoot,
      burnSubtitles: true,
      mixOriginalAudio: true,
      originalAudioVolume: 0.1,
      onProgress: event => progress.push({
        phase: event.phase,
        percent: event.percent
      })
    });

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.localized, true);
    assert(fs.existsSync(result.outputPath));
    assert(result.sizeBytes > 0);

    assert.deepStrictEqual(result.pipeline, {
      voiceSegmentCount: 2,
      subtitleSegmentCount: 2,
      timingWarningCount: 1,
      originalAudioMixed: true,
      burnSubtitles: true
    });

    const output = await probeVideo(result.outputPath);

    assert(output.duration >= 4.8 && output.duration <= 5.2, "output duration should preserve source duration");
    assert.strictEqual(output.width, 640);
    assert.strictEqual(output.height, 360);
    assert.strictEqual(output.videoCodec, "h264");
    assert.strictEqual(output.audioCodec, "aac");

    const phases = new Set(progress.map(item => item.phase));
    assert(phases.has("preparing"));
    assert(phases.has("rendering"));
    assert(phases.has("finalizing"));

    assert(progress.some(item => item.percent === 100));
    assert(
      progress.filter(item => item.phase === "rendering")
        .every(item => item.percent >= 0 && item.percent <= 99)
    );

    console.log("Localized render end-to-end test passed.", {
      duration: output.duration,
      sizeBytes: result.sizeBytes,
      phases: [...phases]
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
