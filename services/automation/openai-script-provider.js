'use strict';

class AutomationScriptProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AutomationScriptProviderError';
    this.code = code;
    this.details = details;
  }
}

function providerError(code, message, details = {}) {
  return new AutomationScriptProviderError(code, message, details);
}

function config() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || '').trim(),
    model: String(process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL || 'gpt-5-mini').trim(),
    baseUrl: String(process.env.OPENAI_BASE_URL || 'https://api.openai.com').trim().replace(/\/+$/, '')
  };
}

function isConfigured() {
  return Boolean(config().apiKey);
}

function stableProviderError(status, payload) {
  const type = payload?.error?.type || '';
  const code = payload?.error?.code || '';

  if (status === 401 || status === 403) {
    return providerError('PROVIDER_AUTH_FAILED', 'Script provider authentication failed.', { status, type, code });
  }
  if (status === 429) {
    return providerError('PROVIDER_RATE_LIMITED', 'Script provider rate limit reached.', { status, type, code });
  }
  if (status >= 500) {
    return providerError('PROVIDER_UNAVAILABLE', 'Script provider is unavailable.', { status, type, code });
  }
  return providerError('PROVIDER_REQUEST_FAILED', 'Script provider rejected the request.', { status, type, code });
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('');
}

function normalizeBrief(brief = {}) {
  return {
    topic: String(brief.topic || '').trim(),
    product: String(brief.product || '').trim(),
    objective: String(brief.objective || '').trim(),
    audience: String(brief.audience || '').trim(),
    platform: String(brief.platform || 'generic').trim(),
    aspectRatio: String(brief.aspectRatio || '9:16').trim(),
    targetDurationSec: Math.max(5, Math.min(1800, Number(brief.targetDurationSec || 30))),
    language: String(brief.language || 'vi').trim(),
    tone: String(brief.tone || '').trim(),
    callToAction: String(brief.callToAction || '').trim(),
    constraints: Array.isArray(brief.constraints) ? brief.constraints.map(String).slice(0, 20) : []
  };
}

async function generateScript({ brief, signal } = {}) {
  const current = config();
  if (!current.apiKey) {
    throw providerError('PROVIDER_NOT_CONFIGURED', 'Script provider is not configured.');
  }

  let url;
  try {
    url = new URL('/v1/responses', current.baseUrl);
  } catch {
    throw providerError('PROVIDER_CONFIG_INVALID', 'Script provider URL is invalid.');
  }

  const input = normalizeBrief(brief);
  if (!input.topic && !input.product) {
    throw providerError('AUTOMATION_BRIEF_INVALID', 'Automation brief requires a topic or product.');
  }

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'hook', 'body', 'callToAction', 'narrationText'],
    properties: {
      title: { type: 'string' },
      hook: { type: 'string' },
      body: { type: 'string' },
      callToAction: { type: 'string' },
      narrationText: { type: 'string' }
    }
  };

  const instructions = [
    'You write concise, high-retention video scripts for a creator workstation.',
    'Follow the requested language, audience, tone, platform, duration and constraints.',
    'Keep claims grounded; do not invent product facts not present in the brief.',
    'The narrationText must be the complete spoken script in natural reading order.',
    'Use a strong opening hook, a coherent body, and a clear call to action when appropriate.',
    'Return only the structured result required by the schema.'
  ].join(' ');

  const body = {
    model: current.model,
    instructions,
    input: JSON.stringify(input),
    text: {
      format: {
        type: 'json_schema',
        name: 'viral_ai_automation_script',
        strict: true,
        schema
      }
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + current.apiKey,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw providerError('PROVIDER_CANCELLED', 'Script provider request was cancelled.');
    throw providerError('PROVIDER_NETWORK', 'Could not reach script provider.', {
      technicalMessage: error?.message || String(error)
    });
  }

  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw stableProviderError(response.status, payload || {});

  const outputText = extractOutputText(payload || {});
  let parsed;
  try { parsed = JSON.parse(outputText); }
  catch { throw providerError('PROVIDER_SCHEMA_INVALID', 'Script provider returned invalid structured output.'); }

  const narrationText = String(parsed?.narrationText || '').trim();
  if (!narrationText) {
    throw providerError('PROVIDER_SCHEMA_INVALID', 'Script provider returned empty narration.');
  }

  return {
    provider: 'openai-compatible',
    model: current.model,
    title: String(parsed.title || '').trim(),
    hook: String(parsed.hook || '').trim(),
    body: String(parsed.body || '').trim(),
    callToAction: String(parsed.callToAction || '').trim(),
    narrationText,
    meta: { structuredOutput: true }
  };
}

module.exports = {
  id: 'openai-compatible',
  isConfigured,
  generateScript,
  config,
  AutomationScriptProviderError
};
