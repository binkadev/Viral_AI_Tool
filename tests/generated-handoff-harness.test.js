"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const harness = require("../dev/generated-handoff-harness");
const { run } = require("../dev/run-generated-handoff");
const { GenerationService } = require("../services/generation/generation-service");
const { probeVideo } = require("../services/ffmpeg");
const env = () => ({ VIRAL_AI_DEV_HANDOFF_FIXTURE: "completed", VIRAL_AI_DEV_HANDOFF_SESSION: randomUUID() });

test("activation fails closed for packaged/production/unknown packaging, absent or malformed flags/session", async t => {
  const variants = [[true, env()], [undefined, env()], [false, { ...env(), NODE_ENV: "production" }],
    ...[undefined, "", "true", "COMPLETED", "completed "].map(mode => [false, { ...env(), VIRAL_AI_DEV_HANDOFF_FIXTURE: mode }]),
    ...[undefined, "", "../profile", "true"].map(session => [false, { ...env(), VIRAL_AI_DEV_HANDOFF_SESSION: session }])];
  for (let i = 0; i < variants.length; i++) await t.test("guard " + i, () => {
    const [isPackaged, input] = variants[i], app = { isPackaged, setPath() { assert.fail("profile touched"); } };
    assert.equal(harness.enabled(app, input), false);
    assert.equal(harness.setup(app, input), null);
    assert.throws(() => harness.runtime(app, input), /unavailable/);
  });
});

test("production startup never loads DEV code and both IPC capabilities deny access", async () => {
  for (const [isPackaged, nodeEnv] of [[true, undefined], [false, "production"], [undefined, undefined]]) {
    const handlers = {}, listeners = {}, input = { ...env(), NODE_ENV: nodeEnv };
    const app = { isPackaged, requestSingleInstanceLock: () => false, quit() {} };
    vm.runInNewContext(fs.readFileSync("startup-main.js", "utf8"), {
      require(name) {
        if (name === "electron") return { app, BrowserWindow: {}, ipcMain: {
          handle: (name, fn) => { handlers[name] = fn; }, on: (name, fn) => { listeners[name] = fn; }
        } };
        if (["path", "url"].includes(name)) return require(name);
        assert.fail("Production loaded " + name);
      }, process: { env: input }, console: { warn() {} }
    });
    assert.equal(await handlers["dev:generated-handoff"]({}, "complete"), null);
    const event = { sender: {}, senderFrame: {} }; listeners["dev:handoff-storage-fault"](event);
    assert.equal(event.returnValue, false);
  }
});

test("DEV runner rejects production and invalid modes before launching Electron", async () => {
  await assert.rejects(run("../anything", true), /Invalid DEV mode/);
  const previous = process.env.NODE_ENV;
  try { process.env.NODE_ENV = "production"; await assert.rejects(run(), /production/); }
  finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("native completed fixture pins real MP4 bytes through GenerationService.finish/output; restart and tamper remain authoritative", async t => {
  const input = env(), paths = {}, app = { isPackaged: false, setPath: (key, value) => { paths[key] = value; }, getPath: key => paths[key] };
  const data = harness.setup(app, input), native = harness.runtime(app, input);
  assert.equal(paths.userData, paths.sessionData);
  assert.equal(path.dirname(paths.userData), require("node:os").tmpdir());
  assert(native.service instanceof GenerationService);
  assert.equal(native.service.registry.adapters.size, 0);
  const job = await native.command("enroll", { projectId: randomUUID(), sceneId: randomUUID() });
  await t.test("new explicitly enrolled identity only; no historical job reads or history scans", async () => {
    for (const id of ["81379514-7da7-4777-9a12-9b7e6108e20c", "71e52ccf-a0ac-45af-a667-30146d3312c2", randomUUID()]) {
      assert.throws(() => native.service.get(id), /identity mismatch/);
    }
    for (const name of ["submit", "retry", "recover", "cancel", "list"]) assert.throws(() => native.service[name](), /forbids/);
    await assert.rejects(native.command("enroll", { projectId: job.projectId, sceneId: job.sceneId }), /already enrolled/);
  });
  await t.test("uncompleted job cannot expose output", () => assert.throws(() => native.service.output(job.id), /ASSET_UNAVAILABLE/));
  await native.command("complete");
  const completed = native.service.get(job.id), output = native.service.output(job.id);
  await t.test("verification persisted with exact size/digest, regular valid H264 MP4", async () => {
    assert.equal(completed.status, "completed"); assert.equal(output.verified, true);
    assert.equal(completed.outputVerification.version, 1);
    assert.equal(completed.outputVerification.sha256, native.service.outputDigest(output.path));
    const stat = fs.lstatSync(output.path); assert(stat.isFile()); assert(!stat.isSymbolicLink());
    assert.equal(stat.size, completed.outputVerification.size); assert(stat.size < 1024 * 1024);
    const meta = await probeVideo(output.path); assert.equal(meta.width, 160); assert.equal(meta.height, 90); assert(meta.duration > 0);
  });
  await t.test("repeated completion reuses one physical MP4 and immutable identity", async () => {
    const before = fs.statSync(output.path);
    await native.command("complete"); await native.command("duplicates");
    assert.equal(fs.statSync(output.path).mtimeMs, before.mtimeMs);
    assert.deepEqual(fs.readdirSync(path.dirname(output.path)), [job.id + ".mp4"]);
    assert.equal(native.service.jobs.length, 1);
  });
  await t.test("new native service restores pinned output evidence, without provider registration", () => {
    const restarted = new GenerationService({ root: path.join(data.root, "generation") });
    assert.deepEqual(restarted.get(job.id).outputVerification, completed.outputVerification);
    assert.equal(restarted.output(job.id).verified, true); assert.equal(restarted.registry.adapters.size, 0);
  });
  await t.test("same-length byte tamper is rejected; DEV cleanup restores only fixture bytes", () => {
    const original = fs.readFileSync(output.path), bytes = Buffer.from(original); bytes[bytes.length - 1] ^= 1;
    try { fs.writeFileSync(output.path, bytes); assert.throws(() => native.service.output(job.id), /ASSET_UNAVAILABLE/); }
    finally { fs.writeFileSync(output.path, original); }
    assert.equal(native.service.output(job.id).verified, true);
  });
  await t.test("legacy output remains explicitly unverified", () => {
    const legacy = { ...completed }; delete legacy.outputVerification;
    try { native.service.commit(legacy); assert.equal(native.service.output(job.id).verified, false); }
    finally { native.service.commit(completed); }
  });
  await t.test("MP4 generator is byte deterministic on this runtime", async () => {
    const second = path.join(data.root, "determinism-check.mp4");
    await harness.makeVideo(second);
    assert.equal(native.service.outputDigest(second), completed.outputVerification.sha256);
  });
});

test("isolated DEV profile marker and duplicate harness conflict fail closed", () => {
  const input = env();
  assert.throws(() => harness.setup({ isPackaged: false }, { ...input, VIRAL_AI_DEV_GENERATION_STATE: "running" }), /Conflicting/);
  const root = path.join(require("node:os").tmpdir(), "viral-ai-handoff-" + input.VIRAL_AI_DEV_HANDOFF_SESSION);
  fs.mkdirSync(root);
  assert.throws(() => harness.setup({ isPackaged: false, setPath() { assert.fail(); } }, input));
});

for (const mode of ["completed", "persistence-failure", "tampered", "noncompleted", "legacy"]) {
  test("REAL Electron desktop " + mode, { timeout: 130000 }, async t => {
    const root = await run(mode, true);
    const first = JSON.parse(fs.readFileSync(path.join(root, "first-pass.json")));
    assert.equal(first.ok, true);
    await t.test("no provider registered; only one fresh job", () => {
      assert.equal(first.native.registeredProviders, 0); assert.equal(first.native.jobCount, 1);
    });
    for (const [name, value] of Object.entries(first.checks)) await t.test(name, () => assert.equal(value, true));
    const jobs = JSON.parse(fs.readFileSync(path.join(root, "generation", "jobs.json"))).jobs;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].id, first.identity.jobId);
    if (mode !== "noncompleted") {
      const output = path.join(root, "generation", "outputs", jobs[0].id);
      await t.test("no physical duplicate output", () => assert.deepEqual(fs.readdirSync(output), [jobs[0].id + ".mp4"]));
    }
    if (mode === "completed") {
      const restarted = JSON.parse(fs.readFileSync(path.join(root, "restart-pass.json")));
      assert.deepEqual(restarted.identity, first.identity);
      for (const [name, value] of Object.entries(restarted.checks)) await t.test("restart " + name, () => assert.equal(value, true));
      assert.equal(jobs[0].outputVerification.size, first.output.metadata.sizeBytes);
      assert.deepEqual(first.native.outputVerification, restarted.native.outputVerification);
    }
  });
}

test("harness stays outside release bundle, uses ordinary Studio and never edits imported-media implementation", () => {
  const pkg = require("../package.json");
  assert(!pkg.build.files.some(file => file.startsWith("dev/") || file === "**/*"));
  const native = fs.readFileSync("dev/generated-handoff-harness.js", "utf8");
  const renderer = fs.readFileSync("dev/generated-handoff-renderer.js", "utf8");
  for (const source of [native, renderer]) for (const forbidden of ["muse-operation.json", "MetaMuseExtensionBridge", "submitGeneration(", "acquireGenerationResult(", "recoverGeneration(", "listGenerationJobs(", "copyFile", "fetch("]) assert(!source.includes(forbidden), forbidden);
  for (const forbidden of ["state.media =", "media.assets.push", "attachGeneratedOutput(", "<video"]) assert(!renderer.includes(forbidden), forbidden);
  assert(renderer.includes('studio.click()')); assert(renderer.includes('api.getGenerationOutput('));
  const c = { window: {} }; vm.runInNewContext(fs.readFileSync("renderer/i18n.js", "utf8"), c);
  for (const locale of ["vi", "en"]) for (const key of ["running", "passed", "negativePassed", "failed", "projectA", "projectB"]) assert(c.window.I18N.messages[locale].devHandoff[key]);
});
