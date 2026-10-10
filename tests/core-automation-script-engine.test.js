'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createScriptEngine,
  createScriptDocument,
  normalizeBrief,
  activeScriptCount
} = require('../services/automation/script-engine');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
const stateBridge = fs.readFileSync(path.join(root, 'renderer', 'core-automation-script-state.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const brief = normalizeBrief({
  id: 'brief-demo',
  inputSignature: 'brief-v1:demo',
  topic: 'Cách phối đồ nam mùa thu',
  objective: 'Tạo short video dễ xem',
  audience: 'Nam 18-28',
  platform: 'tiktok',
  aspectRatio: '9:16',
  targetDurationSec: 35,
  language: 'vi',
  tone: 'tự nhiên',
  callToAction: 'Theo dõi để xem phần tiếp theo',
  constraints: ['Không watermark']
});
assert.strictEqual(brief.topic, 'Cách phối đồ nam mùa thu');
assert.strictEqual(brief.targetDurationSec, 35);

const document = createScriptDocument({
  brief,
  providerResult: {
    provider: 'fake',
    model: 'fake-1',
    title: 'Phối đồ mùa thu',
    hook: 'Mặc đẹp mùa thu không cần mua quá nhiều đồ.',
    body: 'Chọn một áo khoác trung tính, quần vừa dáng và giày sạch.',
    callToAction: 'Theo dõi để xem phần tiếp theo.'
  },
  now: Date.UTC(2026, 9, 10, 8, 0, 0)
});
assert.strictEqual(document.briefId, 'brief-demo');
assert.strictEqual(document.inputSignature, 'brief-v1:demo');
assert(document.narrationText.includes('Mặc đẹp mùa thu'));
assert(document.outputSignature.startsWith('script-v1:'));

(async () => {
  const progress = [];
  const provider = {
    id: 'fake',
    isConfigured: async () => true,
    async generateScript({ brief: inputBrief, signal }) {
      assert.strictEqual(inputBrief.inputSignature, 'brief-v1:demo');
      assert.strictEqual(signal.aborted, false);
      return {
        provider: 'fake',
        model: 'fake-1',
        title: 'Demo',
        hook: 'Hook',
        body: 'Body',
        callToAction: 'CTA',
        narrationText: 'Hook\n\nBody\n\nCTA'
      };
    }
  };
  const engine = createScriptEngine({ provider, now: () => Date.UTC(2026, 9, 10, 9, 0, 0) });
  const status = await engine.status();
  assert.deepStrictEqual(status, { mode: 'cloud', ready: true, code: 'READY', provider: 'fake' });

  const result = await engine.start({
    jobId: 'script-job-001',
    brief,
    onProgress: event => progress.push(event)
  });
  assert.strictEqual(result.cancelled, false);
  assert.strictEqual(result.result.sourceProvider, 'fake');
  assert.strictEqual(result.result.narrationText, 'Hook\n\nBody\n\nCTA');
  assert.strictEqual(progress[0].state, 'preparing');
  assert.strictEqual(progress.at(-1).state, 'completed');
  assert.strictEqual(activeScriptCount(), 0);

  const blockingProvider = {
    id: 'blocking',
    isConfigured: () => true,
    generateScript({ signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
  };
  const blockingEngine = createScriptEngine({ provider: blockingProvider });
  const pending = blockingEngine.start({ jobId: 'script-job-002', brief });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(await blockingEngine.cancel('script-job-002'), true);
  const cancelled = await pending;
  assert.strictEqual(cancelled.cancelled, true);
  assert.strictEqual(activeScriptCount(), 0);

  const unconfigured = createScriptEngine({
    provider: { id: 'none', isConfigured: () => false, generateScript() { throw new Error('should not run'); } }
  });
  const unavailable = await unconfigured.status();
  assert.strictEqual(unavailable.ready, false);
  await assert.rejects(
    () => unconfigured.start({ jobId: 'script-job-003', brief }),
    error => error?.code === 'PROVIDER_NOT_CONFIGURED'
  );

  assert(index.includes('src="core-automation-script-state.js"'));
  assert(index.indexOf('src="core-automation-state.js"') < index.indexOf('src="core-automation-script-state.js"'));

  for (const required of [
    'window.ViralAutomationScriptState',
    'acceptScript',
    'AUTOMATION_BRIEF_REQUIRED',
    'AUTOMATION_SCRIPT_RESULT_INVALID',
    'STALE_INPUT',
    'automation-script-accepted',
    'automation-script-job-updated'
  ]) {
    assert(stateBridge.includes(required), 'Script state bridge is missing: ' + required);
  }

  assert(!stateBridge.includes('fetch('), 'renderer script state must remain provider-neutral');
  assert(!stateBridge.includes('desktopAPI'), 'renderer script state must not own provider transport');
  assert(pkg.scripts['test:core-automation-script-engine'], 'package.json must expose script engine regression');

  console.log('Automation ScriptEngine provider-neutral generation, cancellation, result identity and persistence bridge tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
