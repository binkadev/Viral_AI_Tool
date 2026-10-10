'use strict';

const crypto = require('crypto');

const active = new Map();

class AutomationScriptError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AutomationScriptError';
    this.code = code;
    this.details = details;
  }
}

function scriptError(code, message, details) {
  return new AutomationScriptError(code, message, details);
}

function safeText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeBrief(brief) {
  if (!brief || typeof brief !== 'object') {
    throw scriptError('AUTOMATION_BRIEF_INVALID', 'Automation brief is invalid.');
  }

  const normalized = {
    id: safeText(brief.id, 160),
    inputSignature: safeText(brief.inputSignature, 200),
    topic: safeText(brief.topic, 1000),
    product: safeText(brief.product, 1000),
    objective: safeText(brief.objective, 2000),
    audience: safeText(brief.audience, 1000),
    platform: safeText(brief.platform, 64) || 'generic',
    aspectRatio: safeText(brief.aspectRatio, 16) || '9:16',
    targetDurationSec: Math.max(5, Math.min(1800, Math.round(Number(brief.targetDurationSec || 30)))),
    language: safeText(brief.language, 32).toLowerCase() || 'vi',
    tone: safeText(brief.tone, 500),
    callToAction: safeText(brief.callToAction, 1000),
    constraints: Array.isArray(brief.constraints)
      ? brief.constraints.map(item => safeText(item, 500)).filter(Boolean).slice(0, 20)
      : []
  };

  if (!normalized.topic && !normalized.product) {
    throw scriptError('AUTOMATION_BRIEF_INVALID', 'Automation brief requires a topic or product.');
  }

  if (!normalized.inputSignature) {
    normalized.inputSignature = 'brief:' + stableHash(JSON.stringify({
      topic: normalized.topic,
      product: normalized.product,
      objective: normalized.objective,
      audience: normalized.audience,
      platform: normalized.platform,
      aspectRatio: normalized.aspectRatio,
      targetDurationSec: normalized.targetDurationSec,
      language: normalized.language,
      tone: normalized.tone,
      callToAction: normalized.callToAction,
      constraints: normalized.constraints
    }));
  }

  return normalized;
}

function validateJobId(jobId) {
  const value = safeText(jobId, 160);
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(value)) {
    throw scriptError('AUTOMATION_SCRIPT_JOB_INVALID', 'Automation script job ID is invalid.');
  }
  return value;
}

function normalizeProviderResult(result) {
  if (!result || typeof result !== 'object') {
    throw scriptError('AUTOMATION_SCRIPT_RESULT_INVALID', 'Script provider returned no result.');
  }

  const title = safeText(result.title, 500);
  const hook = safeText(result.hook, 2000);
  const body = safeText(result.body, 20000);
  const callToAction = safeText(result.callToAction, 2000);
  const narrationText = safeText(result.narrationText || [hook, body, callToAction].filter(Boolean).join('\n\n'), 24000);

  if (!narrationText) {
    throw scriptError('AUTOMATION_SCRIPT_RESULT_INVALID', 'Script provider returned empty narration.');
  }

  return {
    title,
    hook,
    body,
    callToAction,
    narrationText,
    provider: safeText(result.provider, 80) || 'unknown',
    model: safeText(result.model, 160) || 'unknown',
    rawMeta: result.meta && typeof result.meta === 'object' ? { ...result.meta } : null
  };
}

function createScriptDocument({ brief, providerResult, now = Date.now() }) {
  const safeBrief = normalizeBrief(brief);
  const safeResult = normalizeProviderResult(providerResult);
  const createdAt = new Date(now).toISOString();
  const documentSignature = 'script-v1:' + stableHash(JSON.stringify({
    brief: safeBrief.inputSignature,
    narrationText: safeResult.narrationText,
    provider: safeResult.provider,
    model: safeResult.model
  }));

  return {
    version: 1,
    id: 'script-' + documentSignature.slice(-16),
    briefId: safeBrief.id || null,
    title: safeResult.title,
    hook: safeResult.hook,
    body: safeResult.body,
    callToAction: safeResult.callToAction,
    narrationText: safeResult.narrationText,
    sourceProvider: safeResult.provider,
    model: safeResult.model,
    inputSignature: safeBrief.inputSignature,
    outputSignature: documentSignature,
    meta: safeResult.rawMeta,
    createdAt,
    updatedAt: createdAt
  };
}

function serializeScriptError(error) {
  return {
    code: error?.code || 'AUTOMATION_SCRIPT_FAILED',
    details: error?.details && typeof error.details === 'object' ? error.details : {},
    technicalMessage: error?.message || String(error)
  };
}

function createScriptEngine({ provider, now = () => Date.now() } = {}) {
  if (!provider || typeof provider.generateScript !== 'function') {
    throw scriptError('AUTOMATION_SCRIPT_PROVIDER_INVALID', 'Script provider adapter is invalid.');
  }

  async function status() {
    const configured = typeof provider.isConfigured === 'function'
      ? await provider.isConfigured()
      : true;
    return {
      mode: 'cloud',
      ready: configured === true,
      code: configured === true ? 'READY' : 'AUTOMATION_SCRIPT_PROVIDER_NOT_CONFIGURED',
      provider: safeText(provider.id, 80) || 'unknown'
    };
  }

  async function start({ jobId, brief, onProgress } = {}) {
    const safeJobId = validateJobId(jobId);
    const safeBrief = normalizeBrief(brief);

    if (active.has(safeJobId)) {
      throw scriptError('DUPLICATE_ACTIVE', 'Automation script job is already active.');
    }

    if (typeof provider.isConfigured === 'function' && !(await provider.isConfigured())) {
      throw scriptError('PROVIDER_NOT_CONFIGURED', 'Script provider is not configured.');
    }

    const controller = new AbortController();
    const record = {
      jobId: safeJobId,
      briefSignature: safeBrief.inputSignature,
      controller,
      startedAt: now()
    };
    active.set(safeJobId, record);

    try {
      onProgress?.({ jobId: safeJobId, state: 'preparing', percent: 0 });
      onProgress?.({ jobId: safeJobId, state: 'processing', percent: undefined, indeterminate: true });

      const result = await provider.generateScript({
        brief: safeBrief,
        signal: controller.signal
      });

      if (controller.signal.aborted) {
        return { cancelled: true, result: null };
      }

      const document = createScriptDocument({
        brief: safeBrief,
        providerResult: result,
        now: now()
      });

      onProgress?.({ jobId: safeJobId, state: 'completed', percent: 100 });
      return { cancelled: false, result: document };
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'PROVIDER_CANCELLED') {
        return { cancelled: true, result: null };
      }
      if (error instanceof AutomationScriptError) throw error;
      throw scriptError(error?.code || 'AUTOMATION_SCRIPT_FAILED', error?.message || 'Script generation failed.', error?.details || {});
    } finally {
      active.delete(safeJobId);
    }
  }

  async function cancel(jobId) {
    const safeJobId = safeText(jobId, 160);
    const record = active.get(safeJobId);
    if (!record) return false;
    record.controller.abort();
    return true;
  }

  return { status, start, cancel };
}

function activeScriptCount() {
  return active.size;
}

async function cancelAllScripts() {
  const records = [...active.values()];
  for (const record of records) {
    try { record.controller.abort(); } catch {}
  }
  return records.length;
}

module.exports = {
  AutomationScriptError,
  createScriptEngine,
  createScriptDocument,
  normalizeBrief,
  normalizeProviderResult,
  serializeScriptError,
  activeScriptCount,
  cancelAllScripts
};
