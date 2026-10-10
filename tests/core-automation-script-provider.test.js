"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

async function run() {
  const root = path.resolve(__dirname, "..");
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const providerSource = read("services/automation/openai-script-provider.js");
  const devProviderSource = read("services/automation/dev-template-script-provider.js");
  const routerSource = read("services/automation/script-provider-router.js");
  const ipcSource = read("services/automation/desktop-ipc.js");
  const preload = read("preload.js");
  const mainEntry = read("main-entry.js");
  const pkg = JSON.parse(read("package.json"));
  const provider = require("../services/automation/openai-script-provider");
  const devProvider = require("../services/automation/dev-template-script-provider");

  assert.strictEqual(provider.id, "openai-responses");
  assert.strictEqual(provider.DEFAULT_MODEL, "gpt-5-mini");
  assert.strictEqual(provider.ENDPOINT, "https://api.openai.com/v1/responses");
  assert.strictEqual(devProvider.id, "dev-template");

  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL;
  const originalDev = process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.strictEqual(provider.isConfigured(), false);
    process.env.OPENAI_API_KEY = "test-key";
    assert.strictEqual(provider.isConfigured(), true);

    delete process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;
    assert.strictEqual(devProvider.isConfigured(), false);
    process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER = "1";
    assert.strictEqual(devProvider.isConfigured(), true);

    const prompt = provider.buildPrompt({
      topic: "5 cách phối đồ nam phong cách Hàn",
      objective: "Video short thu hút người xem Việt Nam",
      audience: "Nam 18-28 tuổi",
      platform: "tiktok",
      targetDurationSec: 30,
      language: "vi",
      tone: "Tự nhiên, nhanh, trẻ",
      callToAction: "Theo dõi để xem phần tiếp theo"
    });
    assert(prompt.includes("5 cách phối đồ nam phong cách Hàn"));
    assert(prompt.includes("30"));
    assert(prompt.includes("vi"));

    const schema = provider.responseSchema();
    assert.strictEqual(schema.type, "object");
    assert.deepStrictEqual(schema.required, ["title", "hook", "body", "callToAction", "narrationText"]);
    assert.strictEqual(schema.additionalProperties, false);

    let capturedRequest = null;
    const fakeFetch = async (_url, init) => {
      capturedRequest = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "resp-1",
            output: [{
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  title: "5 cách phối đồ nam",
                  hook: "Muốn mặc đẹp hơn?",
                  body: "Bắt đầu từ form dáng, bảng màu và cách layer.",
                  callToAction: "Theo dõi để xem phần tiếp theo",
                  narrationText: "Muốn mặc đẹp hơn? Bắt đầu từ form dáng, bảng màu và cách layer. Theo dõi để xem phần tiếp theo."
                })
              }]
            }],
            usage: { input_tokens: 100, output_tokens: 50 }
          };
        }
      };
    };

    const result = await provider.generateScript({
      brief: {
        topic: "5 cách phối đồ nam phong cách Hàn",
        objective: "Video short thu hút người xem Việt Nam",
        audience: "Nam 18-28 tuổi",
        platform: "tiktok",
        targetDurationSec: 30,
        language: "vi",
        tone: "Tự nhiên, nhanh, trẻ",
        callToAction: "Theo dõi để xem phần tiếp theo"
      },
      signal: new AbortController().signal,
      fetchImpl: fakeFetch
    });

    assert.strictEqual(result.provider, "openai-responses");
    assert.strictEqual(result.title, "5 cách phối đồ nam");
    assert.strictEqual(result.meta.responseId, "resp-1");
    assert(capturedRequest);
    assert.strictEqual(capturedRequest.model, "gpt-5-mini");
    assert.strictEqual(capturedRequest.text.format.type, "json_schema");
    assert.strictEqual(capturedRequest.text.format.strict, true);

    const devResult = await devProvider.generateScript({
      brief: {
        topic: "5 cách phối đồ nam phong cách Hàn",
        objective: "Video short thu hút người xem Việt Nam",
        audience: "Nam 18-28 tuổi",
        language: "vi",
        callToAction: "Theo dõi để xem phần tiếp theo"
      }
    });
    assert.strictEqual(devResult.provider, "dev-template");
    assert.strictEqual(devResult.model, "deterministic-template-v1");
    assert.strictEqual(devResult.meta.developmentPreview, true);
    assert.strictEqual(devResult.meta.networkUsed, false);
    assert(devResult.narrationText.includes("phối đồ nam phong cách Hàn"));

    for (const required of [
      "ipcMain.handle('automation:script-status'",
      "ipcMain.handle('automation:script-start'",
      "ipcMain.handle('automation:script-cancel'",
      "event.sender.send('automation:script-progress'",
      "require('./script-provider-router')",
      "createScriptEngine({ provider })"
    ]) {
      assert(ipcSource.includes(required), "Automation desktop IPC is missing: " + required);
    }

    assert(routerSource.includes("require('./openai-script-provider')"));
    assert(routerSource.includes("require('./dev-template-script-provider')"));
    assert(routerSource.includes("if (openai.isConfigured()) return openai"));
    assert(routerSource.includes("if (devTemplate.isConfigured()) return devTemplate"));
    assert(devProviderSource.includes("VIRAL_AI_AUTOMATION_DEV_PROVIDER"), "dev-only flag belongs at the dev provider boundary");
    assert(devProviderSource.includes("provider: 'dev-template'"));
    assert(devProviderSource.includes("networkUsed: false"));
    assert(!devProviderSource.includes("fetch("), "development provider must remain offline and deterministic");

    assert(mainEntry.includes("require('./services/automation/desktop-ipc')"));
    assert(mainEntry.includes("installAutomationScriptIpc();"));
    assert(mainEntry.indexOf("installAutomationScriptIpc();") < mainEntry.indexOf("require('./main.js')"));

    for (const required of [
      "getAutomationScriptStatus: () => ipcRenderer.invoke('automation:script-status')",
      "startAutomationScript: payload => ipcRenderer.invoke('automation:script-start', payload)",
      "cancelAutomationScript: jobId => ipcRenderer.invoke('automation:script-cancel', jobId)",
      "ipcRenderer.on('automation:script-progress', listener)"
    ]) {
      assert(preload.includes(required), "Automation preload bridge is missing: " + required);
    }

    assert(!providerSource.includes("localStorage"));
    assert(!ipcSource.includes("OPENAI_API_KEY"));
    assert(pkg.scripts["test:core-automation-script-provider"]);

    console.log("Automation ScriptEngine OpenAI-compatible provider, offline dev provider and narrow IPC bridge tests passed.");
  } finally {
    if (originalKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel == null) delete process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL;
    else process.env.VIRAL_AI_OPENAI_SCRIPT_MODEL = originalModel;
    if (originalDev == null) delete process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER;
    else process.env.VIRAL_AI_AUTOMATION_DEV_PROVIDER = originalDev;
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
