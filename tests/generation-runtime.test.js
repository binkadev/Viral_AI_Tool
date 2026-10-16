"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { TRANSITIONS, transition } = require("../services/generation/generation-job");
const { normalizeRequest } = require("../services/generation/generation-request");
const { ProviderRegistry } = require("../services/generation/provider-registry");
const { GenerationService } = require("../services/generation/generation-service");
const { GenerationStore } = require("../services/generation/generation-store");
const { registerGenerationIpc } = require("../services/generation/generation-ipc");
const request = (key = "request-1") => ({ projectId: "project-1", idempotencyKey: key, prompt: "A bird flying", goal: "economy" });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generation-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = new ProviderRegistry();
  const calls = [];
  // Test-only adapter; never registered by the application.
  const adapter = { id: "local", modelIds: ["local:wan"], readiness: async () => ({ ready: true }),
    preflight: async () => ({ ready: true }), start: async c => { calls.push(c); return { status: "pending" }; },
    reconcile: async () => ({ status: "pending" }), cancel: async () => ({ confirmed: true }), ...overrides };
  registry.register(adapter);
  return { root, registry, adapter, calls, service: new GenerationService({ root, registry }) };
}
test("job transitions accept only declared lifecycle edges and keep identity", () => {
  for (const from of Object.keys(TRANSITIONS)) for (const to of Object.keys(TRANSITIONS)) {
    const job = { id: "immutable", status: from };
    if (TRANSITIONS[from].includes(to)) assert.equal(transition(job, to, { id: "bad" }).id, "immutable");
    else assert.throws(() => transition(job, to), { code: "INVALID_TRANSITION" });
    assert.equal(job.status, from);
  }
});
test("requests normalize defaults and reject invalid, secret, reference and routing inputs", () => {
  assert.equal(normalizeRequest(request()).durationSeconds, 5);
  assert.equal(normalizeRequest({ ...request(), prompt: " hello " }).prompt, "hello");
  for (const change of [{ apiKey: "secret" }, { prompt: " " }, { prompt: "x".repeat(8001) }, { goal: "other" },
    { durationSeconds: NaN }, { durationSeconds: Infinity }, { durationSeconds: "5" }, { durationSeconds: -1 },
    { resolution: "8k" }, { withAudio: "false" }, { mode: "image-to-video" }, { projectId: "../escape" }, { sourcePath: "C:/secret" }]) {
    assert.throws(() => normalizeRequest({ ...request(), ...change }), { code: "INVALID_REQUEST" });
  }
});
test("registry is fail closed and rejects incomplete, duplicate and mismatched adapters", async t => {
  const empty = new ProviderRegistry(); assert.equal((await empty.readiness()).ready, false);
  assert.throws(() => empty.register({ id: "local" }), { code: "INVALID_PROVIDER" });
  const f = fixture(t);
  assert.throws(() => f.registry.register(f.adapter), { code: "INVALID_PROVIDER" });
  assert.equal((await f.registry.readiness()).availability.runway, false);
  f.adapter.readiness = async () => { throw new Error("secret"); };
  assert.equal((await f.registry.readiness()).ready, false);
  await assert.rejects(f.service.submit(request()), { code: "NO_GENERATION_ROUTE" });
  assert.equal(f.service.jobs.length, 0);
});
test("concurrent idempotency, payload conflicts and active duplicate protection", async t => {
  const f = fixture(t);
  const jobs = await Promise.all([f.service.submit(request()), f.service.submit(request())]);
  assert.equal(jobs[0].id, jobs[1].id);
  await assert.rejects(f.service.submit({ ...request(), prompt: "Other" }), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(f.service.submit(request("request-2")), { code: "DUPLICATE_JOB" });
  await tick(); await tick(); assert.equal(f.calls.length, 1);
  const restart = new GenerationService(f);
  assert.equal((await restart.submit(request())).id, jobs[0].id);
  await assert.rejects(restart.retry(jobs[0].id, "retry"), { code: "RETRY_UNSAFE" });
});
test("queued cancel never submits; retry creates a separate durable attempt", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  assert.equal((await f.service.cancel(job.id)).status, "cancelled");
  await tick(); assert.equal(f.calls.length, 0);
  const retry = await f.service.retry(job.id, "retry-1");
  assert.notEqual(retry.id, job.id); assert.equal(retry.retryOf, job.id);
  assert.equal((await f.service.retry(job.id, "retry-1")).id, retry.id);
  await f.service.cancel(retry.id);
});
test("cancel ignores late completion and requires remote confirmation", async t => {
  let finish;
  const f = fixture(t, { start: () => new Promise(resolve => { finish = resolve; }) });
  const job = await f.service.submit(request()); await tick();
  assert.equal(f.service.get(job.id).status, "processing");
  assert.equal((await f.service.cancel(job.id)).status, "cancelled");
  finish({ status: "completed", fileName: "fake.mp4" }); await tick();
  assert.equal(f.service.get(job.id).status, "cancelled");
  f.adapter.cancel = async () => ({ confirmed: false });
  const next = await f.service.retry(job.id, "retry"); await tick();
  assert.equal((await f.service.cancel(next.id)).status, "recovery_required");
  await assert.rejects(f.service.retry(next.id, "unsafe"), { code: "RETRY_UNSAFE" });
  finish({ status: "pending" }); await tick();
});
test("restart preserves uncertain work and reconciles without resubmitting", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request()); await tick(); await tick();
  const restart = new GenerationService(f);
  assert.equal(restart.get(job.id).status, "recovery_required");
  const calls = f.calls.length;
  assert.equal((await restart.recover(job.id)).status, "recovery_required");
  f.adapter.reconcile = async () => ({ status: "failed", error: "secret" });
  assert.equal((await restart.recover(job.id)).status, "failed");
  assert.equal(f.calls.length, calls);
  const retry = await restart.retry(job.id, "retry"); await restart.cancel(retry.id);
});
test("restart converts every active state to recovery and corrupt stores fail closed", async t => {
  const f = fixture(t); const job = await f.service.submit(request()); await f.service.cancel(job.id);
  for (const status of ["queued", "processing", "cancelling"]) {
    f.service.store.save([{ ...job, status }]);
    assert.equal(new GenerationService(f).get(job.id).status, "recovery_required");
  }
  fs.writeFileSync(path.join(f.root, "jobs.json"), "broken");
  assert.throws(() => new GenerationService(f), { code: "STORE_UNAVAILABLE" });
  assert.equal(fs.readFileSync(path.join(f.root, "jobs.json"), "utf8"), "broken");
});
test("storage and preflight failure prevent provider submission", async t => {
  const f = fixture(t);
  f.service.store.save = () => { throw Object.assign(new Error("disk"), { code: "STORE_UNAVAILABLE" }); };
  await assert.rejects(f.service.submit(request()), { code: "STORE_UNAVAILABLE" });
  await tick(); assert.equal(f.calls.length, 0); assert.equal(f.service.jobs.length, 0);
  f.adapter.preflight = async () => ({ ready: false });
  await assert.rejects(f.service.submit(request()), { code: "PROVIDER_UNAVAILABLE" });
});
test("no fake progress/assets and adapter secrets never reach durable jobs or IPC", async t => {
  const secret = "provider-secret-do-not-expose";
  const f = fixture(t, { start: async () => ({ status: "completed", fileName: "missing.mp4", apiKey: secret, progress: 99 }) });
  const events = []; f.service.on("changed", e => events.push(e));
  const job = await f.service.submit(request()); await tick(); await tick();
  assert.equal(f.service.get(job.id).asset, null);
  assert.equal(f.service.get(job.id).status, "recovery_required");
  assert(!JSON.stringify(events).includes("progress"));
  assert(!JSON.stringify(f.service.list("project-1")).includes(secret));
  assert(!fs.readFileSync(path.join(f.root, "jobs.json"), "utf8").includes(secret));
  f.adapter.reconcile = async () => { throw Object.assign(new Error(secret), { apiKey: secret }); };
  assert(!JSON.stringify(await f.service.recover(job.id)).includes(secret));
});
test("completion requires an existing assigned output and strips raw response fields", async t => {
  const f = fixture(t, { start: async c => {
    const fileName = c.jobId + ".mp4";
    // Minimal format marker for the runtime boundary, not a production generated asset.
    fs.writeFileSync(path.join(c.outputDirectory, fileName), Buffer.from([0,0,0,12,102,116,121,112,109,112,52,50]));
    return { status: "completed", fileName, token: "secret" };
  } });
  const job = await f.service.submit(request()); await tick(); await tick();
  assert.equal(f.service.get(job.id).status, "completed");
  assert.deepEqual(f.service.get(job.id).asset, { fileName: job.id + ".mp4" });
  assert.equal(new GenerationStore(f.root).load()[0].status, "completed");
});
test("IPC rejects untrusted frames and malformed payloads and hides raw failures", async t => {
  const f = fixture(t); const handlers = {};
  registerGenerationIpc({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, getService: () => f.service, trusted: e => e.trusted === true });
  assert.equal((await handlers["generation:submit"]({}, request())).errorCode, "UNAVAILABLE");
  assert.equal(f.service.jobs.length, 0);
  for (const channel of ["status", "list", "get", "cancel", "recover", "retry", "submit"]) {
    assert.equal((await handlers["generation:" + channel]({ trusted: true }, { secret: "hidden" })).ok, false);
  }
  f.service.readiness = async () => { throw Object.assign(new Error("secret"), { code: "SECRET" }); };
  assert.deepEqual(await handlers["generation:status"]({ trusted: true }), { ok: false, errorCode: "UNAVAILABLE" });
  const main = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert(main.includes("event.sender === mainWindow.webContents"));
  assert(main.includes("event.senderFrame === mainWindow.webContents.mainFrame"));
  assert(main.includes("event.senderFrame.url === pathToFileURL"));
});
test("preload exposes only fixed generation channels", () => {
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8"), { require: name => {
    assert.equal(name, "electron"); return { contextBridge: { exposeInMainWorld: (_, value) => { api = value; } }, ipcRenderer: { invoke: (...args) => calls.push(args) } };
  } });
  api.getGenerationStatus(); api.submitGeneration(request()); api.cancelGeneration("job");
  assert.deepEqual(calls.map(c => c[0]), ["generation:status", "generation:submit", "generation:cancel"]);
});
test("renderer readiness is native-authoritative, fail closed and bilingual", async () => {
  let ready = false; let reject = false;
  const handlers = {}; const button = { disabled: true, setAttribute() {} };
  const context = { window: { addEventListener: (name, fn) => { handlers[name] = fn; }, desktopAPI: {
    getGenerationStatus: async () => { if (reject) throw Error("offline"); return { ok: true, value: { ready } }; }
  } }, document: { readyState: "complete", addEventListener() {}, documentElement: { dataset: {} },
    querySelector: selector => selector === "[data-ai-generate]" ? button : null },
    localStorage: { getItem: key => key.includes("brief") ? "An idea" : "balanced" },
    pages: {}, pageMeta: {}, state: { locale: "en", cloud: { auth: true }, speech: { providerStatus: { ready: true } } }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/core-ai-create.js"), "utf8"), context);
  await tick(); assert.equal(button.disabled, true);
  ready = true; await handlers.focus(); assert.equal(button.disabled, false);
  reject = true; await handlers.focus(); assert.equal(button.disabled, true);
  const en = context.window.I18N.messages.en.aiCreate; const vi = context.window.I18N.messages.vi.aiCreate;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  assert.equal(vi.generate, "Tạo video");
  for (const value of Object.values(vi).flat()) assert(!/\?(?=[^ "])/.test(value), "Vietnamese copy must preserve diacritics");
  for (const lang of ["en", "vi"]) {
    context.state.locale = lang;
    const html = context.pages["ai-create"]();
    assert(!html.includes("undefined")); assert(!html.includes("FFmpeg")); assert(!html.includes("cost-estimator"));
    assert(html.includes(context.window.I18N.messages[lang].aiCreate.generate));
  }
});
test("shutdown prevents new work and cancels queued jobs", async t => {
  const f = fixture(t); const job = await f.service.submit(request()); await f.service.shutdown();
  assert.equal(f.service.get(job.id).status, "cancelled");
  assert.equal((await f.service.readiness()).ready, false);
  await assert.rejects(f.service.submit(request("new")), { code: "UNAVAILABLE" });
});
test("runtime imports resolve and use declared external dependencies", () => {
  const { builtinModules, createRequire } = require("module");
  const root = path.join(__dirname, ".."); const pkg = require("../package.json");
  for (const file of ["main.js", "preload.js", ...fs.readdirSync(path.join(root, "services/generation")).filter(f => f.endsWith(".js")).map(f => "services/generation/" + f)]) {
    const absolute = path.join(root, file); const req = createRequire(absolute);
    for (const match of fs.readFileSync(absolute, "utf8").matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (name.startsWith(".")) assert.doesNotThrow(() => req.resolve(name));
      else if (!builtinModules.includes(name)) assert(pkg.dependencies?.[name] || pkg.devDependencies?.[name], name);
    }
  }
});
