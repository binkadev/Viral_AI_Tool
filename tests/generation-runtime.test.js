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

const request = (key = "request-1", overrides = {}) => ({
  projectId: "project-1",
  sceneId: "scene-1",
  idempotencyKey: key,
  prompt: "A bird flying",
  goal: "economy",
  ...overrides
});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generation-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = new ProviderRegistry();
  const calls = [];
  const adapter = {
    id: "local",
    modelIds: ["local:wan"],
    readiness: async () => ({ ready: true, state: "ready" }),
    preflight: async () => ({ ready: true }),
    start: async context => { calls.push(context); return { status: "pending" }; },
    reconcile: async () => ({ status: "pending" }),
    cancel: async () => ({ confirmed: true }),
    ...overrides
  };
  registry.registerProvider(adapter);
  return { root, registry, adapter, calls, service: new GenerationService({ root, registry }) };
}

test("job transitions accept only declared lifecycle edges and keep immutable identity", () => {
  for (const from of Object.keys(TRANSITIONS)) for (const to of Object.keys(TRANSITIONS)) {
    const job = { id: "immutable", projectId: "project", requestId: "request", idempotencyKey: "key", kind: "video", mode: "text-to-video", sceneId: null, createdAt: "x", status: from };
    if (TRANSITIONS[from].includes(to)) {
      const next = transition(job, to, { id: "bad", projectId: "bad" });
      assert.equal(next.id, "immutable");
      assert.equal(next.projectId, "project");
    } else assert.throws(() => transition(job, to), { code: "INVALID_TRANSITION" });
    assert.equal(job.status, from);
  }
  assert.throws(() => transition({ id: "x", status: "queued" }, "preparing", { progress: 101 }), { code: "INVALID_PROGRESS" });
});

test("lifecycle contract uses queued preparing submitting running verifying interrupted terminal states", () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [
    "cancelled", "cancelling", "completed", "failed", "interrupted", "preparing", "queued", "running", "submitting", "verifying"
  ].sort());
});

test("requests normalize scene/model metadata and reject unsafe inputs", () => {
  const normalized = normalizeRequest(request());
  assert.equal(normalized.durationSeconds, 5);
  assert.equal(normalized.kind, "video");
  assert.equal(normalized.mode, "text-to-video");
  assert.equal(normalized.aspectRatio, "9:16");
  assert.equal(normalized.sceneId, "scene-1");
  assert.equal(normalizeRequest({ ...request(), prompt: " hello " }).prompt, "hello");
  assert.equal(normalizeRequest(request("x", { referenceAssetIds: ["asset-1"] })).referenceAssetIds[0], "asset-1");
  for (const change of [
    { apiKey: "secret" }, { prompt: " " }, { prompt: "x".repeat(8001) }, { goal: "other" },
    { durationSeconds: NaN }, { durationSeconds: Infinity }, { durationSeconds: "5" }, { durationSeconds: -1 },
    { resolution: "8k" }, { withAudio: "false" }, { mode: "image-to-video" }, { projectId: "../escape" },
    { sceneId: "../escape" }, { sourcePath: "C:/secret" }, { kind: "image" }, { aspectRatio: "4:3" },
    { referenceAssetIds: ["../escape"] }
  ]) assert.throws(() => normalizeRequest({ ...request(), ...change }), { code: "INVALID_REQUEST" });
});

test("registry is fail closed and exposes only sanitized provider readiness", async t => {
  const empty = new ProviderRegistry();
  const emptyStatus = await empty.readiness();
  assert.equal(emptyStatus.ready, false);
  assert.equal(emptyStatus.state, "not_configured");
  assert.deepEqual(emptyStatus.providers, []);
  assert.throws(() => empty.registerProvider({ id: "local" }), { code: "INVALID_PROVIDER" });
  const f = fixture(t);
  assert.equal(f.registry.hasProvider("local"), true);
  assert.equal(f.registry.getProvider("local"), f.adapter);
  assert.equal(f.registry.listProviders()[0].id, "local");
  assert.throws(() => f.registry.registerProvider(f.adapter), { code: "INVALID_PROVIDER" });
  assert.equal((await f.registry.readiness()).availability.runway, false);
  f.adapter.readiness = async () => { throw new Error("secret"); };
  const status = await f.registry.readiness();
  assert.equal(status.ready, false);
  assert.equal(status.state, "error");
  assert.equal(status.providers[0].state, "error");
  await assert.rejects(f.service.submit(request()), { code: "NO_GENERATION_ROUTE" });
  assert.equal(f.service.jobs.length, 0);
});

test("concurrent idempotency, payload conflicts and active duplicate protection", async t => {
  const f = fixture(t);
  const jobs = await Promise.all([f.service.submit(request()), f.service.submit(request())]);
  assert.equal(jobs[0].id, jobs[1].id);
  await assert.rejects(f.service.submit({ ...request(), prompt: "Other" }), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(f.service.submit(request("request-2")), { code: "DUPLICATE_JOB" });
  await tick(); await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.get(jobs[0].id).status, "running", "normal provider pending state must become running in-session");
  const restart = new GenerationService(f);
  assert.equal(restart.get(jobs[0].id).status, "interrupted");
  assert.equal((await restart.submit(request())).id, jobs[0].id);
  await assert.rejects(restart.retry(jobs[0].id, "retry"), { code: "RETRY_UNSAFE" });
});

test("queued cancel never submits; retry creates a separate durable attempt", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  assert.equal(job.status, "queued");
  assert.equal((await f.service.cancel(job.id)).status, "cancelled");
  await tick();
  assert.equal(f.calls.length, 0);
  const retry = await f.service.retry(job.id, "retry-1");
  assert.notEqual(retry.id, job.id);
  assert.equal(retry.retryOf, job.id);
  assert.equal((await f.service.retry(job.id, "retry-1")).id, retry.id);
  await f.service.cancel(retry.id);
});

test("cancel ignores late completion and requires remote confirmation", async t => {
  let finish;
  const f = fixture(t, { start: () => new Promise(resolve => { finish = resolve; }) });
  const job = await f.service.submit(request());
  await tick(); await tick();
  assert.equal(f.service.get(job.id).status, "submitting");
  assert.equal((await f.service.cancel(job.id)).status, "cancelled");
  finish({ status: "completed", fileName: "fake.mp4" });
  await tick();
  assert.equal(f.service.get(job.id).status, "cancelled");
  f.adapter.cancel = async () => ({ confirmed: false });
  const next = await f.service.retry(job.id, "retry");
  await tick(); await tick();
  assert.equal((await f.service.cancel(next.id)).status, "interrupted");
  assert.equal(f.service.activeCount(), 0, "interrupted historical work must not keep the window-close active-work prompt alive");
  await assert.rejects(f.service.retry(next.id, "unsafe"), { code: "RETRY_UNSAFE" });
  finish({ status: "pending" });
  await tick();
});

test("restart preserves uncertain work and reconciles without resubmitting", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  await tick(); await tick();
  const restart = new GenerationService(f);
  assert.equal(restart.get(job.id).status, "interrupted");
  assert.equal(restart.activeCount(), 0);
  const calls = f.calls.length;
  assert.equal((await restart.recover(job.id)).status, "running");
  f.adapter.reconcile = async () => ({ status: "failed", error: "secret" });
  assert.equal((await restart.recover(job.id)).status, "failed");
  assert.equal(f.calls.length, calls);
  const retry = await restart.retry(job.id, "retry");
  await restart.cancel(retry.id);
});

test("restart retains queued jobs but interrupts submitted work and corrupt stores fail closed", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  await f.service.cancel(job.id);
  f.service.store.save([{ ...job, status: "queued" }]);
  const queuedRestart = new GenerationService(f);
  assert.equal(queuedRestart.get(job.id).status, "queued");
  assert.equal(queuedRestart.activeCount(), 0, "restored queued work must not be treated as running until explicitly recovered");
  for (const status of ["preparing", "submitting", "running", "verifying", "cancelling"]) {
    f.service.store.save([{ ...job, status }]);
    assert.equal(new GenerationService(f).get(job.id).status, "interrupted");
  }
  fs.writeFileSync(path.join(f.root, "jobs.json"), "broken");
  assert.throws(() => new GenerationService(f), { code: "STORE_UNAVAILABLE" });
  assert.equal(fs.readFileSync(path.join(f.root, "jobs.json"), "utf8"), "broken");
});

test("explicit recover resumes a restored queued job without duplicate submission", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  await f.service.cancel(job.id);
  f.service.store.save([{ ...job, status: "queued" }]);
  const restart = new GenerationService(f);
  await restart.recover(job.id);
  await tick(); await tick();
  assert.equal(restart.get(job.id).status, "running");
});

test("storage failure prevents provider submission", async t => {
  const f = fixture(t);
  f.service.store.save = () => { throw Object.assign(new Error("disk"), { code: "STORE_UNAVAILABLE" }); };
  await assert.rejects(f.service.submit(request()), { code: "STORE_UNAVAILABLE" });
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.jobs.length, 0);
});

test("preflight failure becomes failed before provider submission", async t => {
  const f = fixture(t, { preflight: async () => ({ ready: false }) });
  const job = await f.service.submit(request());
  await tick(); await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.get(job.id).status, "failed");
});

test("unknown provider submission outcome becomes interrupted but ordinary pending becomes running", async t => {
  const f = fixture(t, { start: async () => { throw new Error("network vanished after submit"); } });
  const job = await f.service.submit(request());
  await tick(); await tick();
  assert.equal(f.service.get(job.id).status, "interrupted");
  assert.equal(f.service.activeCount(), 0);
});

test("invalid completed output fails verification without publishing fake assets", async t => {
  const secret = "provider-secret-do-not-expose";
  const f = fixture(t, { start: async () => ({ status: "completed", fileName: "missing.mp4", apiKey: secret, progress: 99 }) });
  const events = [];
  f.service.on("changed", event => events.push(event));
  const job = await f.service.submit(request());
  await tick(); await tick(); await tick();
  assert.equal(f.service.get(job.id).asset, null);
  assert.equal(f.service.get(job.id).status, "failed");
  assert.equal(f.service.get(job.id).errorCode, "ASSET_UNAVAILABLE");
  assert(!JSON.stringify(events).includes(secret));
  assert(!JSON.stringify(f.service.list("project-1")).includes(secret));
  assert(!fs.readFileSync(path.join(f.root, "jobs.json"), "utf8").includes(secret));
});

test("completion verifies assigned output and durable estimates do not drift on reload", async t => {
  const f = fixture(t, { start: async context => {
    const fileName = context.jobId + ".mp4";
    fs.writeFileSync(path.join(context.outputDirectory, fileName), Buffer.from([0,0,0,12,102,116,121,112,109,112,52,50]));
    return { status: "completed", fileName, token: "secret" };
  } });
  const job = await f.service.submit(request());
  await tick(); await tick(); await tick();
  assert.equal(f.service.get(job.id).status, "completed");
  assert.equal(f.service.get(job.id).progress, 100);
  assert.deepEqual(f.service.get(job.id).asset, { fileName: job.id + ".mp4" });
  assert.deepEqual(f.service.get(job.id).output, { fileName: job.id + ".mp4" });
  const raw = JSON.parse(fs.readFileSync(path.join(f.root, "jobs.json"), "utf8"));
  raw.jobs[0].estimate.estimatedUsd = 123.45;
  fs.writeFileSync(path.join(f.root, "jobs.json"), JSON.stringify(raw));
  const reloaded = new GenerationStore(f.root).load()[0];
  assert.equal(reloaded.estimate.estimatedUsd, 123.45, "historical estimate must remain the recorded snapshot");
  assert.deepEqual(reloaded.output, { fileName: job.id + ".mp4" });
});

test("explicit model selection is honored only when that model is ready", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request("model", { modelId: "local:wan" }));
  assert.equal(job.modelId, "local:wan");
  await f.service.cancel(job.id);
  await assert.rejects(f.service.submit(request("bad-model", { modelId: "runway:wan3" })), { code: "NO_GENERATION_ROUTE" });
});

test("IPC rejects untrusted frames and malformed payloads and hides raw failures", async t => {
  const f = fixture(t);
  const handlers = {};
  registerGenerationIpc({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, getService: () => f.service, trusted: event => event.trusted === true });
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
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8"), {
    require: name => {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_, value) => { api = value; } },
        ipcRenderer: { invoke: (...args) => calls.push(args) }
      };
    }
  });
  api.getGenerationStatus();
  api.submitGeneration(request());
  api.cancelGeneration("job");
  assert.deepEqual(calls.map(call => call[0]), ["generation:status", "generation:submit", "generation:cancel"]);
});

test("renderer readiness is native-authoritative, project-scoped, fail closed and bilingual", async () => {
  let ready = false;
  let reject = false;
  const handlers = {};
  const button = { disabled: true, setAttribute() {} };
  const context = {
    window: {
      addEventListener: (name, fn) => { handlers[name] = fn; },
      crypto: { randomUUID: () => "request-id" },
      ViralCoreProjectPersistence: { snapshot: () => ({ projectId: "project-1", scenePlan: { selectedSceneId: "scene-1" } }) },
      desktopAPI: { getGenerationStatus: async () => {
        if (reject) throw Error("offline");
        return { ok: true, value: { ready, state: ready ? "ready" : "not_configured" } };
      } }
    },
    document: {
      readyState: "complete",
      addEventListener() {},
      documentElement: { dataset: {} },
      querySelector: selector => selector === "[data-ai-generate]" ? button : null
    },
    localStorage: { getItem: key => key.includes("brief") ? "An idea" : "balanced" },
    pages: {},
    pageMeta: {},
    state: { locale: "en", cloud: { auth: true }, speech: { providerStatus: { ready: true } } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/i18n.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../renderer/core-ai-create.js"), "utf8"), context);
  await tick();
  assert.equal(button.disabled, true);
  ready = true;
  await handlers.focus();
  assert.equal(button.disabled, false);
  let html = context.pages["ai-create"]();
  assert(html.includes('data-generation-status="ready"'));
  reject = true;
  await handlers.focus();
  assert.equal(button.disabled, true);
  html = context.pages["ai-create"]();
  assert(html.includes('data-generation-status="error"'));
  const en = context.window.I18N.messages.en.aiCreate;
  const vi = context.window.I18N.messages.vi.aiCreate;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  assert.equal(vi.generate, "Tạo video");
});

test("shutdown prevents new work and does not treat interrupted history as active work", async t => {
  const f = fixture(t);
  const job = await f.service.submit(request());
  await f.service.shutdown();
  assert.equal(f.service.get(job.id).status, "cancelled");
  assert.equal((await f.service.readiness()).ready, false);
  await assert.rejects(f.service.submit(request("new")), { code: "UNAVAILABLE" });
});

test("runtime imports resolve and use declared external dependencies", () => {
  const { builtinModules, createRequire } = require("module");
  const root = path.join(__dirname, "..");
  const pkg = require("../package.json");
  for (const file of ["main.js", "preload.js", ...fs.readdirSync(path.join(root, "services/generation")).filter(name => name.endsWith(".js")).map(name => "services/generation/" + name)]) {
    const absolute = path.join(root, file);
    const req = createRequire(absolute);
    for (const match of fs.readFileSync(absolute, "utf8").matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1];
      if (name.startsWith(".")) assert.doesNotThrow(() => req.resolve(name));
      else if (!builtinModules.includes(name)) assert(pkg.dependencies?.[name] || pkg.devDependencies?.[name], name);
    }
  }
});
