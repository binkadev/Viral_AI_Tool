'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const providerPath = path.join(root, 'services', 'automation', 'openai-script-provider.js');
const devProviderPath = path.join(root, 'services', 'automation', 'dev-template-script-provider.js');
const routerPath = path.join(root, 'services', 'automation', 'script-provider-router.js');
const ipcPath = path.join(root, 'services', 'automation', 'desktop-ipc.js');
const mainEntry = fs.readFileSync(path.join(root, 'main-entry.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const providerSource = fs.readFileSync(providerPath, 'utf8');
const devProviderSource = fs.readFileSync(devProviderPath, 'utf8');
const routerSource = fs.readFileSync(routerPath, 'utf8');
const ipcSource = fs.readFileSync(ipcPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const previousKey = process.env.OPENAI_API_KEY;
const previousModel = process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL;
const previousBaseUrl = process.env.OPENAI_BASE_URL;
const previousDevProvider = process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;
const previousFetch = global.fetch;

function clearModules() {
  for (const file of [providerPath, devProviderPath, routerPath]) {
    try { delete require.cache[require.resolve(file)]; } catch {}
  }
}

async function run() {
  try {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL = 'script-test-model';
    process.env.OPENAI_BASE_URL = 'https://example.test';
    delete process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;

    clearModules();
    const provider = require(providerPath);

    assert.strictEqual(provider.id, 'openai-compatible');
    assert.strictEqual(provider.isConfigured(), true);
    assert.strictEqual(provider.config().model, 'script-test-model');
    assert.strictEqual(provider.config().baseUrl, 'https://example.test');

    let capturedUrl = null;
    let capturedOptions = null;
    global.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output_text: JSON.stringify({
              title: '3 cách phối đồ',
              hook: 'Bạn đang mặc đúng nhưng vẫn chưa nổi bật?',
              body: 'Bắt đầu từ form, màu và một điểm nhấn.',
              callToAction: 'Lưu lại để thử.',
              narrationText: 'Bạn đang mặc đúng nhưng vẫn chưa nổi bật? Bắt đầu từ form, màu và một điểm nhấn. Lưu lại để thử.'
            })
          };
        }
      };
    };

    const result = await provider.generateScript({
      brief: {
        topic: 'Phối đồ nam Hàn Quốc',
        audience: 'Nam 18-28',
        platform: 'tiktok',
        aspectRatio: '9:16',
        targetDurationSec: 30,
        language: 'vi',
        tone: 'tự nhiên',
        constraints: ['Không bịa thông tin sản phẩm']
      }
    });

    assert.strictEqual(capturedUrl, 'https://example.test/v1/responses');
    assert.strictEqual(capturedOptions.method, 'POST');
    assert.strictEqual(capturedOptions.headers.authorization, 'Bearer test-key-not-real');
    const requestBody = JSON.parse(capturedOptions.body);
    assert.strictEqual(requestBody.model, 'script-test-model');
    assert.strictEqual(requestBody.text.format.type, 'json_schema');
    assert.strictEqual(requestBody.text.format.name, 'viral_ai_automation_script');
    const requestInput = JSON.parse(requestBody.input);
    assert.strictEqual(requestInput.topic, 'Phối đồ nam Hàn Quốc');
    assert.strictEqual(result.provider, 'openai-compatible');
    assert.strictEqual(result.model, 'script-test-model');

    process.env.OPENAI_API_KEY = '';
    delete process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;
    clearModules();
    const noKeyRouter = require(routerPath);
    assert.strictEqual(await noKeyRouter.isConfigured(), false, 'no-key production path must stay unavailable by default');
    assert.strictEqual(noKeyRouter.id, 'openai-compatible');

    process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER = '1';
    clearModules();
    const devRouter = require(routerPath);
    assert.strictEqual(await devRouter.isConfigured(), true, 'explicit development provider flag must unlock no-key runtime testing');
    assert.strictEqual(devRouter.id, 'dev-template');
    const devResult = await devRouter.generateScript({
      brief: {
        topic: '5 cách phối đồ nam phong cách Hàn',
        objective: 'Video short thu hút người xem Việt Nam',
        audience: 'Nam 18-28 tuổi',
        language: 'vi',
        callToAction: 'Theo dõi để xem phần tiếp theo'
      }
    });
    assert.strictEqual(devResult.provider, 'dev-template');
    assert.strictEqual(devResult.model, 'deterministic-template-v1');
    assert.strictEqual(devResult.meta.developmentPreview, true);
    assert.strictEqual(devResult.meta.networkUsed, false);
    assert(devResult.narrationText.includes('phối đồ nam phong cách Hàn'));

    for (const required of [
      "ipcMain.handle('automation:script-status'",
      "ipcMain.handle('automation:script-start'",
      "ipcMain.handle('automation:script-cancel'",
      "event.sender.send('automation:script-progress'",
      "require('./script-provider-router')",
      'createScriptEngine({ provider })'
    ]) {
      assert(ipcSource.includes(required), 'Automation desktop IPC is missing: ' + required);
    }

    assert(routerSource.includes("require('./openai-script-provider')"));
    assert(routerSource.includes("require('./dev-template-script-provider')"));
    assert(routerSource.includes('VIRAL_AI_AUTOMATION_DEV_PROVIDER'));
    assert(devProviderSource.includes("provider: 'dev-template'"));
    assert(devProviderSource.includes('networkUsed: false'));
    assert(!devProviderSource.includes('fetch('), 'development provider must remain offline and deterministic');

    assert(mainEntry.includes("require('./services/automation/desktop-ipc')"));
    assert(mainEntry.includes('installAutomationScriptIpc();'));
    assert(mainEntry.indexOf('installAutomationScriptIpc();') < mainEntry.indexOf("require('./main.js')"));

    for (const required of [
      "getAutomationScriptStatus: () => ipcRenderer.invoke('automation:script-status')",
      "startAutomationScript: payload => ipcRenderer.invoke('automation:script-start', payload)",
      "cancelAutomationScript: jobId => ipcRenderer.invoke('automation:script-cancel', jobId)",
      "ipcRenderer.on('automation:script-progress', listener)"
    ]) {
      assert(preload.includes(required), 'Automation preload bridge is missing: ' + required);
    }

    assert(!providerSource.includes('localStorage'));
    assert(!ipcSource.includes('OPENAI_API_KEY'));
    assert(pkg.scripts['test:core-automation-script-provider']);

    console.log('Automation ScriptEngine cloud provider, explicit no-key dev fallback and narrow IPC bridge tests passed.');
  } finally {
    if (previousKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel == null) delete process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL; else process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL = previousModel;
    if (previousBaseUrl == null) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previousBaseUrl;
    if (previousDevProvider == null) delete process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER; else process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER = previousDevProvider;
    global.fetch = previousFetch;
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
