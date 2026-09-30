const os = require("os");

function send(type, payload = {}) {
  if (typeof process.send === "function") {
    process.send({ type, ...payload });
  }
}

function fail(code, error) {
  send("error", {
    code,
    technicalMessage: error?.message || String(error)
  });
}

function safeThreads(value) {
  const requested = Number(value || 0);
  if (Number.isFinite(requested) && requested >= 1) {
    return Math.max(1, Math.min(8, Math.floor(requested)));
  }
  return Math.max(1, Math.min(6, Math.floor((os.cpus()?.length || 2) / 2)));
}

async function run(payload) {
  let runtime;
  try {
    runtime = require("sherpa-onnx-node");
  } catch (error) {
    fail("LOCAL_RUNTIME_REQUIRED", error);
    return;
  }

  const { wavPath, model, language, numThreads } = payload || {};
  if (!wavPath || !model?.encoder || !model?.decoder || !model?.tokens) {
    fail("LOCAL_WORKER_INVALID", new Error("Missing local recognition inputs."));
    return;
  }

  try {
    send("state", { state: "loading" });

    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
      },
      modelConfig: {
        whisper: {
          encoder: model.encoder,
          decoder: model.decoder,
          language: language && language !== "auto" ? language : "",
          task: "transcribe",
          tailPaddings: -1,
          enableTokenTimestamps: 1,
          enableSegmentTimestamps: 1
        },
        tokens: model.tokens,
        numThreads: safeThreads(numThreads),
        debug: 0,
        provider: "cpu"
      }
    };

    const recognizer = await runtime.OfflineRecognizer.createAsync(config);
    const wave = runtime.readWave(wavPath);

    if (!wave?.samples || !wave?.sampleRate) {
      throw new Error("Prepared audio could not be read.");
    }

    const stream = recognizer.createStream();
    stream.acceptWaveform({
      samples: wave.samples,
      sampleRate: wave.sampleRate
    });

    send("state", { state: "processing", indeterminate: true });
    const result = await recognizer.decodeAsync(stream);

    send("result", {
      result: {
        text: String(result?.text || "").trim(),
        tokens: Array.isArray(result?.tokens) ? result.tokens : [],
        timestamps: Array.isArray(result?.timestamps) ? result.timestamps : [],
        durations: Array.isArray(result?.durations) ? result.durations : [],
        language: String(result?.lang || language || "unknown")
      }
    });
  } catch (error) {
    fail("LOCAL_RECOGNITION_FAILED", error);
  }
}

let started = false;
process.on("message", message => {
  if (started || message?.type !== "start") return;
  started = true;
  run(message.payload).finally(() => {
    setTimeout(() => process.exit(0), 10);
  });
});

process.on("uncaughtException", error => {
  fail("LOCAL_WORKER_CRASHED", error);
  process.exit(1);
});

process.on("unhandledRejection", error => {
  fail("LOCAL_WORKER_CRASHED", error);
  process.exit(1);
});

send("ready");
