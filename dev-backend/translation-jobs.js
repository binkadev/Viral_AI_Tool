const crypto = require("crypto");
const translationProvider = require("./providers/translation");

const MAX_SEGMENTS = 300;
const MAX_TOTAL_CHARS = 60000;
const BATCH_SIZE = 30;

const jobs = new Map();
const idempotency = new Map();

let quotaHooks = {
  reserve: null,
  settle: null
};

function configureQuotaHooks(hooks = {}) {
  quotaHooks = {
    reserve: typeof hooks.reserve === "function" ? hooks.reserve : null,
    settle: typeof hooks.settle === "function" ? hooks.settle : null
  };
}

function estimateBillableMinutes(segments, totalChars) {
  const maxEnd = (segments || []).reduce((max, item) => Math.max(max, Number(item?.end || 0)), 0);
  if (maxEnd > 0) return Math.max(1, Math.ceil(maxEnd / 60));
  return Math.max(1, Math.ceil(Math.max(1, Number(totalChars || 0)) / 900));
}

function reserveQuota(job) {
  if (!job || Number(job.reservedMinutes || 0) > 0) return Number(job?.reservedMinutes || 0);
  const minutes = Math.max(1, Number(job.estimatedMinutes || 1));
  if (quotaHooks.reserve) {
    const result = quotaHooks.reserve({
      userId: job.userId,
      service: "translation",
      jobId: job.id,
      minutes
    });
    job.reservedMinutes = Math.max(1, Number(result?.minutes || minutes));
  } else {
    job.reservedMinutes = minutes;
  }
  return job.reservedMinutes;
}

function settleQuota(job, outcome) {
  const reserved = Math.max(0, Number(job?.reservedMinutes || 0));
  if (!job || reserved <= 0) return;

  job.reservedMinutes = 0;

  try {
    const result = quotaHooks.settle?.({
      userId: job.userId,
      service: "translation",
      jobId: job.id,
      minutes: reserved,
      outcome
    });

    if (outcome === "completed") {
      job.chargedMinutes = Math.max(
        0,
        Number(job.chargedMinutes || 0) + Number(result?.chargedMinutes ?? reserved)
      );
    }
  } catch (error) {
    console.error("[TranslationQuota]", error?.code || "ERROR", error?.message || String(error));
  }
}

class TranslationJobError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TranslationJobError";
    this.code = code;
    this.details = details;
  }
}

function jobError(code, message, details) {
  return new TranslationJobError(code, message, details);
}

function stableJobId() {
  return "tr_" + crypto.randomBytes(12).toString("hex");
}

function normalizeLanguage(value, fallback = "") {
  const code = String(value || fallback).trim();
  if (!code) return "";
  if (code === "auto") return code;
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(code) ? code : "";
}

function normalizeSegments(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_SEGMENTS) {
    throw jobError("TRANSLATION_INPUT_INVALID", "Translation segments are invalid.");
  }

  const ids = new Set();
  let totalChars = 0;

  const segments = input.map((item, index) => {
    const id = String(item?.id || "segment-" + (index + 1)).trim();
    const text = String(item?.text || "").trim();
    const start = Math.max(0, Number(item?.start || 0));
    const end = Math.max(start, Number(item?.end || start));
    const speaker = item?.speaker ? String(item.speaker).trim() : null;

    if (!id || ids.has(id) || !text) {
      throw jobError("TRANSLATION_INPUT_INVALID", "Translation segment IDs or text are invalid.");
    }

    ids.add(id);
    totalChars += text.length;

    return { id, start, end, text, speaker };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw jobError("TRANSLATION_TOO_LARGE", "Translation input is too large.", {
      maxChars: MAX_TOTAL_CHARS,
      totalChars
    });
  }

  return { segments, totalChars };
}

function validateCreateBody(body) {
  const clientJobId = String(body?.clientJobId || "").trim();
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(clientJobId)) {
    throw jobError("TRANSLATION_INPUT_INVALID", "Client job ID is invalid.");
  }

  const sourceLanguage = normalizeLanguage(body?.sourceLanguage, "auto");
  const targetLanguage = normalizeLanguage(body?.targetLanguage);
  if (!sourceLanguage || !targetLanguage || targetLanguage === "auto") {
    throw jobError("TRANSLATION_LANGUAGE_INVALID", "Translation languages are invalid.");
  }

  const normalized = normalizeSegments(body?.segments);

  return {
    clientJobId,
    sourceLanguage,
    targetLanguage,
    preserveTone: body?.preserveTone !== false,
    segments: normalized.segments,
    totalChars: normalized.totalChars
  };
}

function fingerprint(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      preserveTone: input.preserveTone,
      segments: input.segments.map(item => ({ id: item.id, text: item.text, speaker: item.speaker }))
    }))
    .digest("hex");
}

function publicJob(job) {
  const payload = {
    jobId: job.id,
    state: job.state
  };

  if (Number.isFinite(job.progress)) payload.progress = job.progress;
  payload.estimate = { minutes: Number(job.estimatedMinutes || 0) };
  if (Number(job.chargedMinutes || 0) > 0) payload.chargedMinutes = Number(job.chargedMinutes);
  if (job.result) payload.result = job.result;
  if (job.errorCode) payload.error = { code: job.errorCode };

  return payload;
}

function publicErrorCode(error) {
  const code = error?.code || "";
  if (code === "PROVIDER_CANCELLED") return "CANCELLED";
  if (code === "PROVIDER_SCHEMA_INVALID") return "TRANSLATION_RESULT_INVALID";
  if ([
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_NETWORK",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_CONFIG_INVALID"
  ].includes(code)) {
    return "SERVICE_UNAVAILABLE";
  }
  if (code === "PROVIDER_NOT_CONFIGURED") return "SERVICE_UNAVAILABLE";
  return "TRANSLATION_FAILED";
}

function timingMeta(source, translatedText) {
  const sourceLength = Math.max(1, String(source.text || "").length);
  const translatedLength = String(translatedText || "").length;
  const ratio = translatedLength / sourceLength;
  const duration = Math.max(0, Number(source.end || 0) - Number(source.start || 0));

  return {
    lengthRatio: Number(ratio.toFixed(2)),
    timingRisk: duration > 0 && ratio >= 1.65
  };
}

async function processJob(job) {
  if (!job || job.started || job.state !== "queued") return;

  job.started = true;
  job.state = "processing";
  job.progress = 0;
  job.controller = new AbortController();

  const translatedById = new Map();

  try {
    for (let offset = 0; offset < job.segments.length; offset += BATCH_SIZE) {
      if (job.cancelRequested || job.controller.signal.aborted) {
        throw jobError("CANCELLED", "Translation was cancelled.");
      }

      const batch = job.segments.slice(offset, offset + BATCH_SIZE);
      const response = await translationProvider.translate({
        segments: batch,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        preserveTone: job.preserveTone,
        signal: job.controller.signal
      });

      for (const item of response.segments) {
        translatedById.set(String(item.id), String(item.text || "").trim());
      }

      const completed = Math.min(job.segments.length, offset + batch.length);
      job.progress = Math.min(99, Math.round((completed / job.segments.length) * 100));
    }

    const outputSegments = job.segments.map(source => {
      const text = translatedById.get(source.id);
      if (!text) throw jobError("TRANSLATION_RESULT_INVALID", "A translated segment is missing.");
      const meta = timingMeta(source, text);

      return {
        id: source.id,
        start: source.start,
        end: source.end,
        sourceText: source.text,
        text,
        speaker: source.speaker,
        speaker: source.speaker || null,
        lengthRatio: meta.lengthRatio,
        timingRisk: meta.timingRisk
      };
    });

    job.result = {
      version: 1,
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      text: outputSegments.map(item => item.text).join(" "),
      segments: outputSegments,
      meta: {
        providerMode: "cloud",
        timingPreserved: true,
        warningCount: outputSegments.filter(item => item.timingRisk).length,
        createdAt: new Date().toISOString()
      }
    };

    job.state = "completed";
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    settleQuota(job, "completed");
  } catch (error) {
    if (job.cancelRequested || job.controller?.signal.aborted || ["CANCELLED", "PROVIDER_CANCELLED"].includes(error?.code)) {
      job.state = "cancelled";
      job.progress = 0;
      settleQuota(job, "cancelled");
    } else {
      job.state = "failed";
      job.progress = 0;
      job.errorCode = publicErrorCode(error);
      settleQuota(job, "failed");
      console.error("[TranslationProvider]", error?.code || "ERROR", error?.message || String(error));
    }
  } finally {
    job.controller = null;
  }
}

function status() {
  const configured = translationProvider.isConfigured();

  return {
    ready: configured,
    code: configured ? "READY" : "TRANSLATION_PROVIDER_NOT_CONFIGURED",
    limits: {
      maxSegments: MAX_SEGMENTS,
      maxCharacters: MAX_TOTAL_CHARS,
      batchSize: BATCH_SIZE
    }
  };
}

function create(userId, idempotencyKey, body) {
  const input = validateCreateBody(body);
  if (input.clientJobId !== idempotencyKey) {
    throw jobError("TRANSLATION_INPUT_INVALID", "Idempotency key mismatch.");
  }

  const scopedKey = userId + ":" + idempotencyKey;
  const inputFingerprint = fingerprint(input);
  const existingId = idempotency.get(scopedKey);

  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw jobError("JOB_CONFLICT", "Idempotency key was reused with different translation input.");
      }

      if (["failed", "cancelled"].includes(existing.state) && !existing.started) {
        reserveQuota(existing);
        existing.state = "queued";
        existing.progress = 0;
        existing.errorCode = null;
        existing.cancelRequested = false;
        setImmediate(() => processJob(existing));
      }

      return { created: false, job: publicJob(existing) };
    }
    idempotency.delete(scopedKey);
  }

  if (!translationProvider.isConfigured()) {
    throw jobError("SERVICE_UNAVAILABLE", "Translation provider is not configured.");
  }

  const job = {
    id: stableJobId(),
    userId,
    clientJobId: input.clientJobId,
    fingerprint: inputFingerprint,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    preserveTone: input.preserveTone,
    segments: input.segments,
    totalChars: input.totalChars,
    estimatedMinutes: estimateBillableMinutes(input.segments, input.totalChars),
    reservedMinutes: 0,
    chargedMinutes: 0,
    state: "queued",
    progress: 0,
    result: null,
    errorCode: null,
    started: false,
    cancelRequested: false,
    controller: null,
    createdAt: new Date().toISOString()
  };

  reserveQuota(job);
  jobs.set(job.id, job);
  idempotency.set(scopedKey, job.id);
  setImmediate(() => processJob(job));

  return { created: true, job: publicJob(job) };
}

function get(userId, jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "Translation job was not found.");
  }
  return publicJob(job);
}

function cancel(userId, jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job || job.userId !== userId) {
    throw jobError("JOB_NOT_FOUND", "Translation job was not found.");
  }

  if (["completed", "failed", "cancelled"].includes(job.state)) {
    return { cancelled: job.state === "cancelled" };
  }

  job.cancelRequested = true;

  if (job.state === "processing") {
    job.state = "cancelling";
    try { job.controller?.abort(); } catch {}
  } else {
    job.state = "cancelled";
    job.progress = 0;
    settleQuota(job, "cancelled");
  }

  return { cancelled: true };
}

module.exports = {
  status,
  create,
  get,
  cancel,
  configureQuotaHooks,
  TranslationJobError
};
