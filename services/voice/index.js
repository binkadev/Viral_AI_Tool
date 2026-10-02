const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");
const { CloudVoiceClient } = require("./cloud-client");

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const active = new Map();

class VoiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
    this.details = details;
  }
}

function voiceError(code, message, details) {
  return new VoiceError(code, message, details);
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
    const abort = () => finish(reject, voiceError("VOICE_CANCELLED", "Voice generation was cancelled."));

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{8,160}$/.test(jobId)) {
    throw voiceError("VOICE_JOB_INVALID", "Invalid voice job ID.");
  }
}

function validateLanguage(code) {
  const value = String(code || "").trim();
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw voiceError("VOICE_LANGUAGE_INVALID", "Invalid voice language.");
  }
  return value;
}

function validateSegments(segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 300) {
    throw voiceError("VOICE_INPUT_INVALID", "Voice segments are invalid.");
  }

  return segments.map((item, index) => {
    const id = String(item?.id || "segment-" + (index + 1)).trim();
    const text = String(item?.text || "").trim();
    const start = Math.max(0, Number(item?.start || 0));
    const end = Math.max(start, Number(item?.end || start));
    const speaker = String(item?.speaker || "speaker-1").trim() || "speaker-1";

    if (!id || !text || text.length > 4096) {
      throw voiceError("VOICE_INPUT_INVALID", "Voice segment content is invalid.");
    }

    return { id, start, end, text, speaker };
  });
}

function safeSegmentFileName(segmentId) {
  return crypto.createHash("sha256").update(String(segmentId)).digest("hex").slice(0, 28) + ".wav";
}

function assertWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES) {
    throw voiceError("VOICE_AUDIO_INVALID", "Voice audio file is invalid.");
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw voiceError("VOICE_AUDIO_INVALID", "Voice audio file is invalid.");
  }
}

function wavDurationSeconds(buffer) {
  assertWav(buffer);

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (id === "fmt " && size >= 16 && dataOffset + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(dataOffset + 8);
    } else if (id === "data") {
      dataSize = Math.min(size, Math.max(0, buffer.length - dataOffset));
      break;
    }

    offset = dataOffset + size + (size % 2);
  }

  if (!byteRate || !dataSize) {
    throw voiceError("VOICE_AUDIO_INVALID", "Voice WAV metadata is invalid.");
  }

  return dataSize / byteRate;
}

async function replaceDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

function publicVoiceError(error) {
  if (error instanceof VoiceError) return error;

  return voiceError(
    error?.code || "VOICE_FAILED",
    error?.message || "Voice generation failed.",
    error?.details || {}
  );
}

function createService({ backendUrl, getAccessToken, appVersion, userDataPath }) {
  const client = new CloudVoiceClient({
    backendUrl,
    getAccessToken,
    appVersion
  });

  const cacheRoot = path.join(userDataPath, "voice-cache");

  return {
    async status() {
      try {
        const data = await client.status();

        const rawCode = data?.code || (data?.ready ? "READY" : "VOICE_UNAVAILABLE");
        return {
          mode: "cloud",
          ready: data?.ready === true,
          code:
            rawCode === "PLAN_REQUIRED" ? "VOICE_PLAN_REQUIRED" :
            rawCode === "SUBSCRIPTION_INACTIVE" ? "VOICE_SUBSCRIPTION_INACTIVE" :
            rawCode,
          limits: data?.limits || null,
          catalog: Array.isArray(data?.catalog) ? data.catalog : [],
          quota: data?.quota || null,
          entitlements: data?.entitlements || null
        };
      } catch (error) {
        return {
          mode: "cloud",
          ready: false,
          code: error?.code || "VOICE_UNAVAILABLE",
          catalog: []
        };
      }
    },

    async catalog() {
      try {
        const data = await client.catalog();

        return {
          ready: data?.ready === true,
          voices: Array.isArray(data?.voices) ? data.voices : []
        };
      } catch (error) {
        throw publicVoiceError(error);
      }
    },

    async preview({ voiceId, text, language }) {
      const safeLanguage = validateLanguage(language);
      const input = String(text || "").trim();

      if (!input || input.length > 220) {
        throw voiceError("VOICE_PREVIEW_INVALID", "Voice preview text is invalid.");
      }

      const response = await client.preview({
        voiceId,
        text: input,
        language: safeLanguage
      });

      assertWav(response.buffer);
      const duration = wavDurationSeconds(response.buffer);

      const previewDir = path.join(cacheRoot, "previews");
      await fsp.mkdir(previewDir, { recursive: true });

      const fileName = "preview-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + ".wav";
      const filePath = path.join(previewDir, fileName);
      await fsp.writeFile(filePath, response.buffer);

      const existing = await fsp.readdir(previewDir).catch(() => []);
      const old = existing.filter(name => name !== fileName).slice(0, 20);
      await Promise.all(old.map(name => fsp.rm(path.join(previewDir, name), { force: true }).catch(() => {})));

      return {
        voiceId: String(voiceId || ""),
        audioPath: filePath,
        audioUrl: pathToFileURL(filePath).href + "?v=" + Date.now(),
        duration: Number(duration.toFixed(3)),
        aiGenerated: true
      };
    },

    async start({
      jobId,
      language,
      assignments,
      segments,
      onProgress
    }) {
      validateJobId(jobId);
      const safeLanguage = validateLanguage(language);
      const safeSegments = validateSegments(segments);

      if (!assignments || typeof assignments !== "object") {
        throw voiceError("VOICE_ASSIGNMENT_INVALID", "Voice assignment is missing.");
      }

      if (active.has(jobId)) {
        throw voiceError("DUPLICATE_ACTIVE", "Voice job is already active.");
      }

      const controller = new AbortController();
      const state = {
        jobId,
        controller,
        serverJobId: null,
        client
      };
      active.set(jobId, state);

      try {
        onProgress?.({ jobId, state: "validating", percent: 0 });

        const created = await client.createJob({
          jobId,
          language: safeLanguage,
          assignments,
          segments: safeSegments,
          signal: controller.signal
        });

        if (!created?.jobId) {
          throw voiceError("VOICE_PROTOCOL_INVALID", "Voice backend returned an invalid job.");
        }

        state.serverJobId = String(created.jobId);
        let remote = created;
        let intervalMs = 900;
        const startedAt = Date.now();
        const maxWaitMs = 2 * 60 * 60 * 1000;

        while (Date.now() - startedAt < maxWaitMs) {
          if (controller.signal.aborted) {
            return { cancelled: true, result: null, serverJobId: state.serverJobId };
          }

          const remoteState = String(remote?.state || "").toLowerCase();

          if (remoteState === "completed") {
            if (!remote.result || !Array.isArray(remote.result.segments)) {
              throw voiceError("VOICE_PROTOCOL_INVALID", "Voice job completed without audio metadata.");
            }

            const jobCacheDir = path.join(cacheRoot, jobId);
            await replaceDir(jobCacheDir);

            const localSegments = [];

            for (let index = 0; index < remote.result.segments.length; index++) {
              if (controller.signal.aborted) {
                await fsp.rm(jobCacheDir, { recursive: true, force: true }).catch(() => {});
                return { cancelled: true, result: null, serverJobId: state.serverJobId };
              }

              const segment = remote.result.segments[index];
              const downloaded = await client.downloadAudio(segment.audioUrl, {
                signal: controller.signal
              });

              assertWav(downloaded.buffer);

              const fileName = safeSegmentFileName(segment.id);
              const filePath = path.join(jobCacheDir, fileName);
              await fsp.writeFile(filePath, downloaded.buffer);

              localSegments.push({
                ...segment,
                audioPath: filePath,
                audioUrl: pathToFileURL(filePath).href
              });

              onProgress?.({
                jobId,
                serverJobId: state.serverJobId,
                state: "downloading",
                percent: 90 + Math.round(((index + 1) / remote.result.segments.length) * 9),
                indeterminate: false
              });
            }

            return {
              cancelled: false,
              serverJobId: state.serverJobId,
              result: {
                ...remote.result,
                segments: localSegments,
                cachedAt: new Date().toISOString()
              }
            };
          }

          if (remoteState === "cancelled") {
            return { cancelled: true, result: null, serverJobId: state.serverJobId };
          }

          if (remoteState === "failed") {
            throw voiceError(remote?.error?.code || "VOICE_FAILED", "Voice generation failed.");
          }

          const progress = Number(remote?.progress);
          const normalized = Number.isFinite(progress)
            ? Math.max(0, Math.min(89, Math.round(progress * 0.89)))
            : undefined;

          onProgress?.({
            jobId,
            serverJobId: state.serverJobId,
            state: remoteState === "queued" ? "queued" : "generating",
            percent: normalized,
            indeterminate: !Number.isFinite(normalized)
          });

          await sleep(intervalMs, controller.signal);
          remote = await client.getJob(state.serverJobId, { signal: controller.signal });
          intervalMs = Math.min(3000, Math.round(intervalMs * 1.12));
        }

        throw voiceError("VOICE_TIMEOUT", "Voice job did not finish in time.");
      } catch (error) {
        if (controller.signal.aborted || error?.code === "VOICE_CANCELLED") {
          return { cancelled: true, result: null, serverJobId: state.serverJobId };
        }

        throw publicVoiceError(error);
      } finally {
        active.delete(jobId);
      }
    },

    async cancel(jobId) {
      const state = active.get(jobId);
      if (!state) return false;

      state.controller.abort();

      if (state.serverJobId) {
        try { await state.client.cancelJob(state.serverJobId); } catch {}
      }

      return true;
    }
  };
}

function activeVoiceCount() {
  return active.size;
}

async function cancelAllVoice() {
  const entries = [...active.values()];
  let cancelled = 0;

  for (const state of entries) {
    state.controller.abort();

    if (state.serverJobId && state.client) {
      try { await state.client.cancelJob(state.serverJobId); } catch {}
    }

    cancelled++;
  }

  return cancelled;
}

function serializeVoiceError(error) {
  const normalized = publicVoiceError(error);

  return {
    code: normalized.code,
    details: normalized.details || {},
    technicalMessage: normalized.message || String(error)
  };
}

module.exports = {
  createService,
  activeVoiceCount,
  cancelAllVoice,
  serializeVoiceError
};
