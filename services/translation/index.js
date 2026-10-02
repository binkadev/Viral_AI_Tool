const { CloudTranslationClient } = require("./cloud-client");

const active = new Map();

class TranslationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.details = details;
  }
}

function translationError(code, message, details) {
  return new TranslationError(code, message, details);
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
    const abort = () => finish(reject, translationError("TRANSLATION_CANCELLED", "Translation was cancelled."));

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function validateJobId(jobId) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9._-]{8,160}$/.test(jobId)) {
    throw translationError("TRANSLATION_JOB_INVALID", "Invalid translation job ID.");
  }
}

function validateLanguage(code, { allowAuto = false } = {}) {
  const value = String(code || "").trim();
  if (allowAuto && value === "auto") return value;
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw translationError("TRANSLATION_LANGUAGE_INVALID", "Invalid translation language.");
  }
  return value;
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 300) {
    throw translationError("TRANSLATION_INPUT_INVALID", "Translation segments are invalid.");
  }

  const ids = new Set();

  return segments.map((item, index) => {
    const id = String(item?.id || "segment-" + (index + 1)).trim();
    const text = String(item?.text || "").trim();
    const start = Math.max(0, Number(item?.start || 0));
    const end = Math.max(start, Number(item?.end || start));

    if (!id || ids.has(id) || !text) {
      throw translationError("TRANSLATION_INPUT_INVALID", "Translation segment content is invalid.");
    }
    ids.add(id);

    return { id, start, end, text };
  });
}

function createService({ backendUrl, getAccessToken, appVersion }) {
  const client = new CloudTranslationClient({
    backendUrl,
    getAccessToken,
    appVersion
  });

  return {
    async status() {
      try {
        const data = await client.status();
        const rawCode = data?.code || (data?.ready ? "READY" : "TRANSLATION_UNAVAILABLE");
        return {
          mode: "cloud",
          ready: data?.ready === true,
          code: rawCode === "PLAN_REQUIRED" ? "TRANSLATION_PLAN_REQUIRED" : rawCode,
          limits: data?.limits || null,
          quota: data?.quota || null,
          entitlements: data?.entitlements || null
        };
      } catch (error) {
        return {
          mode: "cloud",
          ready: false,
          code: error?.code || "TRANSLATION_UNAVAILABLE"
        };
      }
    },

    async start({
      jobId,
      sourceLanguage,
      targetLanguage,
      preserveTone = true,
      segments,
      onProgress
    }) {
      validateJobId(jobId);
      const safeSourceLanguage = validateLanguage(sourceLanguage || "auto", { allowAuto: true });
      const safeTargetLanguage = validateLanguage(targetLanguage);
      const safeSegments = normalizeSegments(segments);

      if (safeSourceLanguage !== "auto" && safeSourceLanguage.toLowerCase() === safeTargetLanguage.toLowerCase()) {
        throw translationError("TRANSLATION_SAME_LANGUAGE", "Source and target languages are the same.");
      }

      if (active.has(jobId)) {
        throw translationError("DUPLICATE_ACTIVE", "Translation job is already active.");
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
          sourceLanguage: safeSourceLanguage,
          targetLanguage: safeTargetLanguage,
          preserveTone: preserveTone !== false,
          segments: safeSegments,
          signal: controller.signal
        });

        if (!created?.jobId) {
          throw translationError("TRANSLATION_PROTOCOL_INVALID", "Translation backend returned an invalid job.");
        }

        state.serverJobId = String(created.jobId);
        let remote = created;
        let intervalMs = 900;
        const startedAt = Date.now();
        const maxWaitMs = 60 * 60 * 1000;

        while (Date.now() - startedAt < maxWaitMs) {
          if (controller.signal.aborted) {
            return { cancelled: true, result: null };
          }

          const remoteState = String(remote?.state || "").toLowerCase();

          if (remoteState === "completed") {
            if (!remote.result || typeof remote.result !== "object") {
              throw translationError("TRANSLATION_PROTOCOL_INVALID", "Translation completed without a result.");
            }
            return {
              cancelled: false,
              result: remote.result,
              serverJobId: state.serverJobId
            };
          }

          if (remoteState === "cancelled") {
            return { cancelled: true, result: null, serverJobId: state.serverJobId };
          }

          if (remoteState === "failed") {
            throw translationError(remote?.error?.code || "TRANSLATION_FAILED", "Translation failed.");
          }

          const progress = Number(remote?.progress);
          const indeterminate = !Number.isFinite(progress);

          onProgress?.({
            jobId,
            serverJobId: state.serverJobId,
            state: remoteState === "queued" ? "queued" : "translating",
            percent: indeterminate ? undefined : Math.max(0, Math.min(99, progress)),
            indeterminate
          });

          await sleep(intervalMs, controller.signal);
          remote = await client.getJob(state.serverJobId, { signal: controller.signal });
          intervalMs = Math.min(3500, Math.round(intervalMs * 1.15));
        }

        throw translationError("TRANSLATION_TIMEOUT", "Translation job did not finish in time.");
      } catch (error) {
        if (controller.signal.aborted || error?.code === "TRANSLATION_CANCELLED") {
          return { cancelled: true, result: null, serverJobId: state.serverJobId };
        }
        if (error instanceof TranslationError) throw error;
        throw translationError(error?.code || "TRANSLATION_FAILED", error?.message || "Translation failed.");
      } finally {
        active.delete(jobId);
      }
    },

    async cancel(jobId) {
      const state = active.get(jobId);
      if (!state) return false;

      state.controller.abort();

      if (state.serverJobId) {
        try { await client.cancelJob(state.serverJobId); } catch {}
      }

      return true;
    }
  };
}

function activeTranslationCount() {
  return active.size;
}

async function cancelAllTranslations() {
  const entries = [...active.entries()];
  let cancelled = 0;

  for (const [, state] of entries) {
    state.controller.abort();

    if (state.serverJobId && state.client) {
      try {
        await state.client.cancelJob(state.serverJobId);
      } catch {
        // Shutdown must continue even if the remote service cannot be reached.
      }
    }

    cancelled++;
  }

  return cancelled;
}

function serializeTranslationError(error) {
  return {
    code: error?.code || "TRANSLATION_FAILED",
    details: error?.details || {},
    technicalMessage: error?.message || String(error)
  };
}

module.exports = {
  createService,
  activeTranslationCount,
  cancelAllTranslations,
  serializeTranslationError
};
