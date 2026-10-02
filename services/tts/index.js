const fs = require("fs/promises");
const path = require("path");
const { CloudTtsClient } = require("./cloud-client");

const active = new Map();

class TtsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.details = details;
  }
}

function ttsError(code, message, details) {
  return new TtsError(code, message, details);
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
    const abort = () => finish(reject, ttsError("TTS_CANCELLED", "TTS was cancelled."));

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function validateJobId(value) {
  const jobId = String(value || "");
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(jobId)) {
    throw ttsError("TTS_JOB_INVALID", "Invalid TTS job ID.");
  }
  return jobId;
}

function safeSegmentId(value, index) {
  const id = String(value || "segment-" + (index + 1)).trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id)) {
    throw ttsError("TTS_INPUT_INVALID", "Invalid TTS segment ID.");
  }
  return id;
}

function normalizeSegments(input) {
  if (!Array.isArray(input) || !input.length || input.length > 300) {
    throw ttsError("TTS_INPUT_INVALID", "TTS segments are invalid.");
  }

  const seen = new Set();

  return input.map((item, index) => {
    const id = safeSegmentId(item?.id, index);
    if (seen.has(id)) throw ttsError("TTS_INPUT_INVALID", "Duplicate TTS segment ID.");
    seen.add(id);

    const text = String(item?.text || "").trim();
    if (!text || text.length > 4096) throw ttsError("TTS_INPUT_INVALID", "Invalid TTS text.");

    return {
      id,
      text,
      start: Math.max(0, Number(item?.start || 0)),
      end: Math.max(0, Number(item?.end || 0)),
      speaker: String(item?.speaker || "speaker-1").trim() || "speaker-1"
    };
  });
}

async function saveAssets({
  client,
  serverJobId,
  result,
  cacheRoot,
  signal,
  onProgress,
  jobId
}) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const outputDir = path.join(cacheRoot, serverJobId);
  await fs.mkdir(outputDir, { recursive: true });

  const downloaded = [];

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (signal?.aborted) throw ttsError("TTS_CANCELLED", "TTS asset download was cancelled.");

    if (!segment?.assetId) {
      throw ttsError("TTS_PROTOCOL_INVALID", "TTS result is missing an audio asset.");
    }

    const assetId = String(segment.assetId);
    const targetPath = path.join(outputDir, assetId + ".wav");

    try {
      await fs.access(targetPath);
    } catch {
      const bytes = await client.downloadAsset(serverJobId, assetId, { signal });
      const tempPath = targetPath + ".tmp";
      await fs.writeFile(tempPath, bytes);
      await fs.rename(tempPath, targetPath);
    }

    downloaded.push({
      ...segment,
      localPath: targetPath
    });

    onProgress?.({
      jobId,
      serverJobId,
      state: "downloading",
      percent: 90 + Math.round(((index + 1) / Math.max(1, segments.length)) * 9),
      completedSegments: result.completedSegments || segments.length,
      totalSegments: segments.length
    });
  }

  return {
    version: 1,
    segments: downloaded,
    meta: {
      ...(result?.meta || {}),
      localAssetsReady: true
    }
  };
}

function createService({ backendUrl, getAccessToken, appVersion, userDataPath }) {
  const client = new CloudTtsClient({
    backendUrl,
    getAccessToken,
    appVersion
  });

  const cacheRoot = path.join(userDataPath, "tts-cache");

  return {
    async status() {
      try {
        const data = await client.status();
        return {
          mode: "cloud",
          ready: data?.ready === true,
          code: data?.code || (data?.ready ? "READY" : "TTS_UNAVAILABLE"),
          voices: Array.isArray(data?.voices) ? data.voices : [],
          limits: data?.limits || null
        };
      } catch (error) {
        return {
          mode: "cloud",
          ready: false,
          code: error?.code || "TTS_UNAVAILABLE",
          voices: []
        };
      }
    },

    async start({
      jobId,
      segments,
      defaultVoiceId,
      voiceMap = {},
      speed = 1,
      style = "natural",
      onProgress
    }) {
      const safeJobId = validateJobId(jobId);
      const safeSegments = normalizeSegments(segments);

      if (active.has(safeJobId)) {
        throw ttsError("DUPLICATE_ACTIVE", "TTS job is already active.");
      }

      const controller = new AbortController();
      const state = {
        jobId: safeJobId,
        controller,
        serverJobId: null,
        client
      };
      active.set(safeJobId, state);

      try {
        onProgress?.({
          jobId: safeJobId,
          state: "validating",
          percent: 0,
          completedSegments: 0,
          totalSegments: safeSegments.length
        });

        let remote = await client.createJob({
          jobId: safeJobId,
          defaultVoiceId: String(defaultVoiceId || "linh"),
          voiceMap,
          speed,
          style,
          segments: safeSegments,
          signal: controller.signal
        });

        if (!remote?.jobId) {
          throw ttsError("TTS_PROTOCOL_INVALID", "TTS backend returned an invalid job.");
        }

        state.serverJobId = String(remote.jobId);
        let intervalMs = 800;
        const startedAt = Date.now();
        const maxWaitMs = 60 * 60 * 1000;

        while (Date.now() - startedAt < maxWaitMs) {
          if (controller.signal.aborted) {
            return { cancelled: true, result: null, serverJobId: state.serverJobId };
          }

          const remoteState = String(remote?.state || "").toLowerCase();
          const progress = Number(remote?.progress);
          const completedSegments = Number(remote?.completedSegments || 0);
          const totalSegments = Number(remote?.totalSegments || safeSegments.length);

          if (remoteState === "completed") {
            onProgress?.({
              jobId: safeJobId,
              serverJobId: state.serverJobId,
              state: "downloading",
              percent: 90,
              completedSegments,
              totalSegments
            });

            const localResult = await saveAssets({
              client,
              serverJobId: state.serverJobId,
              result: remote.result,
              cacheRoot,
              signal: controller.signal,
              onProgress,
              jobId: safeJobId
            });

            return {
              cancelled: false,
              result: localResult,
              serverJobId: state.serverJobId
            };
          }

          if (remoteState === "cancelled") {
            return { cancelled: true, result: null, serverJobId: state.serverJobId };
          }

          if (remoteState === "failed") {
            throw ttsError(remote?.error?.code || "TTS_FAILED", "TTS job failed.");
          }

          onProgress?.({
            jobId: safeJobId,
            serverJobId: state.serverJobId,
            state: remoteState === "queued" ? "queued" : "synthesizing",
            percent: Number.isFinite(progress) ? Math.max(0, Math.min(89, progress * 0.89)) : undefined,
            indeterminate: !Number.isFinite(progress),
            completedSegments,
            totalSegments
          });

          await sleep(intervalMs, controller.signal);
          remote = await client.getJob(state.serverJobId, { signal: controller.signal });
          intervalMs = Math.min(3000, Math.round(intervalMs * 1.12));
        }

        throw ttsError("TTS_TIMEOUT", "TTS job did not finish in time.");
      } catch (error) {
        if (controller.signal.aborted || error?.code === "TTS_CANCELLED") {
          return { cancelled: true, result: null, serverJobId: state.serverJobId };
        }
        if (error instanceof TtsError) throw error;
        throw ttsError(error?.code || "TTS_FAILED", error?.message || "TTS failed.");
      } finally {
        active.delete(safeJobId);
      }
    },

    async cancel(jobId) {
      const state = active.get(String(jobId || ""));
      if (!state) return false;

      state.controller.abort();

      if (state.serverJobId) {
        try { await state.client.cancelJob(state.serverJobId); } catch {}
      }

      return true;
    }
  };
}

function activeTtsCount() {
  return active.size;
}

async function cancelAllTts() {
  const entries = [...active.values()];
  let cancelled = 0;

  for (const state of entries) {
    state.controller.abort();
    if (state.serverJobId) {
      try { await state.client.cancelJob(state.serverJobId); } catch {}
    }
    cancelled++;
  }

  return cancelled;
}

function serializeTtsError(error) {
  return {
    code: error?.code || "TTS_FAILED",
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  createService,
  activeTtsCount,
  cancelAllTts,
  serializeTtsError
};
