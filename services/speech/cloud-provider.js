const {
  CloudSpeechClient,
  CloudClientError,
  normalizeBaseUrl
} = require("./cloud-client");
const {
  prepareCloudAudio,
  cancelCloudAudioPrep,
  cleanupCloudAudio
} = require("./cloud-audio-prep");

const active = new Map();

function providerError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.details = details;
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
      fn(value);
    };

    const timer = setTimeout(() => finish(resolve), ms);
    const abort = () => {
      finish(reject, providerError("CLOUD_CANCELLED", "Cloud speech was cancelled."));
    };

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function mapCloudError(error) {
  if (!error) return providerError("CLOUD_UNAVAILABLE", "Cloud speech is unavailable.");
  if (error instanceof CloudClientError) return error;
  if (error.code) return error;
  return providerError("CLOUD_UNAVAILABLE", error?.message || "Cloud speech failed.");
}

class CloudSpeechProvider {
  constructor({
    backendUrl,
    tempPath,
    getAccessToken,
    appVersion
  }) {
    this.mode = "cloud";
    this.backendUrl = typeof backendUrl === "string" ? backendUrl.trim() : "";
    this.tempPath = tempPath;
    this.client = new CloudSpeechClient({
      backendUrl: this.backendUrl,
      getAccessToken,
      appVersion
    });
  }

  async status() {
    try {
      normalizeBaseUrl(this.backendUrl);
    } catch (error) {
      return {
        mode: this.mode,
        ready: false,
        code: error.code || "CLOUD_CONFIG_INVALID"
      };
    }

    let token;
    try {
      token = this.client.accessToken();
    } catch {
      return {
        mode: this.mode,
        ready: false,
        code: "CLOUD_AUTH_REQUIRED"
      };
    }

    if (!token) {
      return {
        mode: this.mode,
        ready: false,
        code: "CLOUD_AUTH_REQUIRED"
      };
    }

    try {
      const payload = await this.client.status();
      const serviceReady = payload?.ready !== false;

      if (!serviceReady) {
        return {
          mode: this.mode,
          ready: false,
          code: payload?.code || "CLOUD_UNAVAILABLE"
        };
      }

      if (payload?.quota?.remainingMinutes !== undefined && Number(payload.quota.remainingMinutes) <= 0) {
        return {
          mode: this.mode,
          ready: false,
          code: "CLOUD_QUOTA_EXCEEDED",
          quota: payload.quota
        };
      }

      return {
        mode: this.mode,
        ready: true,
        code: "READY",
        quota: payload?.quota || null,
        limits: payload?.limits || null,
        retention: payload?.retention || null
      };
    } catch (error) {
      const mapped = mapCloudError(error);
      return {
        mode: this.mode,
        ready: false,
        code: mapped.code || "CLOUD_UNAVAILABLE"
      };
    }
  }

  async transcribe({
    jobId,
    inputPath,
    language = "auto",
    onProgress
  }) {
    if (active.has(jobId)) {
      throw providerError("DUPLICATE_ACTIVE", "Cloud speech job is already active.");
    }

    const controller = new AbortController();
    const state = {
      jobId,
      controller,
      serverJobId: null,
      preparedPath: null
    };
    active.set(jobId, state);

    try {
      onProgress?.({ jobId, state: "preparing", percent: 0 });

      const prepared = await prepareCloudAudio({
        jobId,
        inputPath,
        tempRoot: this.tempPath,
        onProgress
      });

      if (prepared.cancelled || controller.signal.aborted) {
        return {
          cancelled: true,
          language: language === "auto" ? "unknown" : language,
          duration: prepared.duration || 0,
          text: "",
          segments: [],
          meta: { timingAvailable: false }
        };
      }

      state.preparedPath = prepared.outputPath;

      onProgress?.({ jobId, state: "preparing", percent: 100 });

      const audioSha256 = await this.client.sha256(prepared.outputPath);
      if (controller.signal.aborted) {
        return {
          cancelled: true,
          language: language === "auto" ? "unknown" : language,
          duration: prepared.duration || 0,
          text: "",
          segments: [],
          meta: { timingAvailable: false }
        };
      }

      const created = await this.client.createJob({
        clientJobId: jobId,
        language,
        duration: prepared.duration,
        audioSizeBytes: prepared.sizeBytes,
        audioSha256,
        contentType: prepared.contentType,
        signal: controller.signal
      });

      if (!created?.jobId) {
        throw providerError("CLOUD_PROTOCOL_INVALID", "Cloud backend returned an invalid job contract.");
      }

      state.serverJobId = String(created.jobId);
      const createdState = String(created.state || "awaiting_upload").toLowerCase();

      onProgress?.({
        jobId,
        state: createdState === "awaiting_upload" ? "uploading" :
          createdState === "queued" ? "queued" : "processing",
        percent: Number.isFinite(Number(created.progress)) ? Number(created.progress) : 0,
        indeterminate: ["queued", "processing"].includes(createdState) && !Number.isFinite(Number(created.progress)),
        serverJobId: state.serverJobId,
        estimatedMinutes: created?.estimate?.minutes ?? null
      });

      if (createdState === "completed" && created.result) {
        return {
          ...created.result,
          duration: Number(created.result.duration || prepared.duration || 0),
          meta: {
            ...(created.result.meta || {}),
            timingAvailable: created.result?.meta?.timingAvailable === true
          }
        };
      }

      if (createdState === "cancelled") {
        return {
          cancelled: true,
          language: language === "auto" ? "unknown" : language,
          duration: prepared.duration || 0,
          text: "",
          segments: [],
          meta: { timingAvailable: false }
        };
      }

      if (createdState === "failed") {
        throw providerError(created?.error?.code || "CLOUD_PROCESSING_FAILED", "Cloud speech processing failed.");
      }

      if (createdState === "awaiting_upload" || createdState === "uploaded") {
        if (createdState === "awaiting_upload") {
          if (!created?.upload?.url) {
            throw providerError("CLOUD_PROTOCOL_INVALID", "Cloud backend did not provide an upload target.");
          }

          await this.client.uploadFile({
            upload: created.upload,
            filePath: prepared.outputPath,
            signal: controller.signal,
            onProgress: progress => {
              onProgress?.({
                jobId,
                state: "uploading",
                percent: Math.max(0, Math.min(99, Number(progress.percent || 0))),
                serverJobId: state.serverJobId
              });
            }
          });
        }

        if (controller.signal.aborted) {
          return {
            cancelled: true,
            language: language === "auto" ? "unknown" : language,
            duration: prepared.duration || 0,
            text: "",
            segments: [],
            meta: { timingAvailable: false }
          };
        }

        await this.client.commitJob(state.serverJobId, {
          signal: controller.signal
        });
      }

      const started = Date.now();
      const maxWaitMs = 2 * 60 * 60 * 1000;
      let intervalMs = 1200;

      while (Date.now() - started < maxWaitMs) {
        if (controller.signal.aborted) {
          return {
            cancelled: true,
            language: language === "auto" ? "unknown" : language,
            duration: prepared.duration || 0,
            text: "",
            segments: [],
            meta: { timingAvailable: false }
          };
        }

        const remote = await this.client.getJob(state.serverJobId, {
          signal: controller.signal
        });
        const remoteState = String(remote?.state || "").toLowerCase();

        if (remoteState === "completed") {
          if (!remote.result || typeof remote.result !== "object") {
            throw providerError("CLOUD_PROTOCOL_INVALID", "Cloud job completed without a transcript result.");
          }

          return {
            ...remote.result,
            duration: Number(remote.result.duration || prepared.duration || 0),
            meta: {
              ...(remote.result.meta || {}),
              timingAvailable: remote.result?.meta?.timingAvailable === true
            }
          };
        }

        if (remoteState === "cancelled") {
          return {
            cancelled: true,
            language: language === "auto" ? "unknown" : language,
            duration: prepared.duration || 0,
            text: "",
            segments: [],
            meta: { timingAvailable: false }
          };
        }

        if (remoteState === "failed") {
          const code = remote?.error?.code || "CLOUD_PROCESSING_FAILED";
          throw providerError(code, "Cloud speech processing failed.");
        }

        if (remoteState === "queued") {
          onProgress?.({
            jobId,
            state: "queued",
            indeterminate: true,
            serverJobId: state.serverJobId
          });
        } else {
          onProgress?.({
            jobId,
            state: "processing",
            serverJobId: state.serverJobId,
            indeterminate: !Number.isFinite(Number(remote?.progress)),
            percent: Number.isFinite(Number(remote?.progress))
              ? Math.max(0, Math.min(99, Number(remote.progress)))
              : undefined
          });
        }

        await sleep(intervalMs, controller.signal);
        intervalMs = Math.min(5000, Math.round(intervalMs * 1.2));
      }

      throw providerError("CLOUD_TIMEOUT", "Cloud speech job did not finish in time.");
    } catch (error) {
      if (controller.signal.aborted || error?.code === "CLOUD_CANCELLED") {
        return {
          cancelled: true,
          language: language === "auto" ? "unknown" : language,
          duration: 0,
          text: "",
          segments: [],
          meta: { timingAvailable: false }
        };
      }
      throw mapCloudError(error);
    } finally {
      cleanupCloudAudio(state.preparedPath);
      active.delete(jobId);
    }
  }

  async cancel(jobId) {
    const state = active.get(jobId);
    const prepCancelled = cancelCloudAudioPrep(jobId);

    if (!state) return prepCancelled;

    state.controller.abort();

    let remoteCancelled = false;
    if (state.serverJobId) {
      try {
        await this.client.cancelJob(state.serverJobId);
        remoteCancelled = true;
      } catch {
        // Local cancellation still succeeds even if the remote cancellation request is unavailable.
      }
    }

    return prepCancelled || remoteCancelled || true;
  }
}

module.exports = { CloudSpeechProvider };
