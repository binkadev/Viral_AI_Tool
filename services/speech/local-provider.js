const path = require("path");
const { fork } = require("child_process");
const modelManager = require("./model-manager");
const {
  prepareAudio,
  cancelAudioPrep,
  cleanupAudio
} = require("./audio-prep");
const { segmentTimedResult } = require("./subtitle-segmenter");

const activeWorkers = new Map();

function runtimeAvailable() {
  try {
    require.resolve("sherpa-onnx-node");
    return true;
  } catch {
    return false;
  }
}

function resolveWorkerPath() {
  const source = path.join(__dirname, "local-worker.js");
  return source.replace("app.asar", "app.asar.unpacked");
}

function workerError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function startRecognitionWorker({
  jobId,
  wavPath,
  modelPaths,
  language,
  onProgress
}) {
  return new Promise((resolve, reject) => {
    const worker = fork(resolveWorkerPath(), [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });

    const state = {
      worker,
      settled: false,
      ready: false,
      stderr: ""
    };
    activeWorkers.set(jobId, state);

    const settle = (fn, value) => {
      if (state.settled) return;
      state.settled = true;
      activeWorkers.delete(jobId);
      fn(value);
    };

    worker.stderr?.on("data", chunk => {
      if (state.stderr.length < 12000) {
        state.stderr += chunk.toString();
      }
    });

    worker.on("message", message => {
      if (!message || typeof message !== "object") return;

      if (message.type === "ready" && !state.ready) {
        state.ready = true;
        worker.send({
          type: "start",
          payload: {
            wavPath,
            model: modelPaths,
            language,
            numThreads: 0
          }
        });
        return;
      }

      if (message.type === "state") {
        onProgress?.({
          jobId,
          state: message.state === "loading" ? "preparing" : "processing",
          indeterminate: message.indeterminate !== false
        });
        return;
      }

      if (message.type === "result") {
        settle(resolve, message.result || {});
        return;
      }

      if (message.type === "error") {
        const error = workerError(
          message.code || "LOCAL_RECOGNITION_FAILED",
          message.technicalMessage || "Local recognition failed."
        );
        settle(reject, error);
      }
    });

    worker.on("error", error => {
      settle(reject, workerError(
        "LOCAL_WORKER_CRASHED",
        error?.message || "Local recognition worker failed."
      ));
    });

    worker.on("exit", (code, signal) => {
      activeWorkers.delete(jobId);
      if (state.settled) return;

      if (signal || code !== 0) {
        const suffix = state.stderr ? " " + state.stderr.slice(-2000) : "";
        settle(reject, workerError(
          "LOCAL_WORKER_CRASHED",
          `Local recognition worker exited unexpectedly.${suffix}`
        ));
        return;
      }

      settle(reject, workerError(
        "LOCAL_WORKER_NO_RESULT",
        "Local recognition worker ended without a result."
      ));
    });
  });
}

class LocalSpeechProvider {
  constructor({ userDataPath, tempPath }) {
    this.mode = "local";
    this.userDataPath = userDataPath;
    this.tempPath = tempPath;
  }

  async status() {
    const modelStatus = await modelManager.status(this.userDataPath);

    if (!modelStatus.ready) {
      const code = modelStatus.state === "invalid"
        ? "LOCAL_MODEL_INVALID"
        : modelStatus.state === "partial" || modelStatus.state === "downloading"
          ? "LOCAL_MODEL_INCOMPLETE"
          : "LOCAL_MODEL_REQUIRED";

      return {
        mode: this.mode,
        ready: false,
        code,
        modelInstalled: false,
        modelStatus
      };
    }

    if (!runtimeAvailable()) {
      return {
        mode: this.mode,
        ready: false,
        code: "LOCAL_RUNTIME_REQUIRED",
        modelInstalled: true,
        modelStatus
      };
    }

    return {
      mode: this.mode,
      ready: true,
      code: "READY",
      modelInstalled: true,
      modelStatus
    };
  }

  async transcribe({ jobId, inputPath, language = "auto", onProgress }) {
    const status = await this.status();

    if (!status.modelInstalled) {
      throw workerError(status.code, "Local speech model is not installed.");
    }

    if (!status.ready) {
      throw workerError(status.code, "Local speech runtime is not configured.");
    }

    await modelManager.verifyInstalled(this.userDataPath);

    let prepared;
    try {
      prepared = await prepareAudio({
        jobId,
        inputPath,
        tempRoot: this.tempPath,
        onProgress
      });

      if (prepared.cancelled) {
        return {
          cancelled: true,
          language: language === "auto" ? "unknown" : language,
          duration: 0,
          text: "",
          segments: [],
          meta: { timingAvailable: false }
        };
      }

      onProgress?.({
        jobId,
        state: "processing",
        indeterminate: true
      });

      const raw = await startRecognitionWorker({
        jobId,
        wavPath: prepared.outputPath,
        modelPaths: modelManager.paths(this.userDataPath),
        language,
        onProgress
      });

      const segmented = segmentTimedResult(raw);

      return {
        language: raw.language || (language === "auto" ? "unknown" : language),
        duration: prepared.duration || 0,
        text: segmented.text,
        segments: segmented.segments,
        meta: {
          timingAvailable: segmented.hasTiming
        }
      };
    } finally {
      cleanupAudio(prepared?.outputPath);
    }
  }

  async cancel(jobId) {
    let cancelled = false;

    if (cancelAudioPrep(jobId)) {
      cancelled = true;
    }

    const active = activeWorkers.get(jobId);
    if (active?.worker) {
      try {
        active.worker.kill("SIGTERM");
        cancelled = true;
      } catch {
        // The caller receives whether at least one active stage was cancelled.
      }
    }

    return cancelled;
  }
}

module.exports = { LocalSpeechProvider };
