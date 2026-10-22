"use strict";
// Operator-invoked packaged verification. It installs the requested local NSIS
// builds, but all application/Project data and updater cache use a temp profile.
// Browser driver lives outside package.json/runtime and is never shipped.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process"), { randomUUID, createHash } = require("node:crypto"), assert = require("node:assert/strict");
const { chromium } = require(process.env.VIRAL_AI_VERIFICATION_DRIVER || "../release/verification-tools/node_modules/playwright-core");
const release = path.resolve(__dirname, "../release"), sessionFile = path.join(release, "private-beta-update-session.json");
const installedExe = path.join(process.env.LOCALAPPDATA, "Programs/Viral AI Tool/Viral AI Tool.exe");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const projection = p => ({ projectId: p.projectId, schemaVersion: p.schemaVersion, sceneIds: p.scenePlan.scenes.map(s => s.id),
  source: p.source, media: p.media, mediaAssembly: p.mediaAssembly, generationOutputs: p.workflow.generationOutputs });
async function port() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
function environment(session, feed, debug) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:VIRAL_AI_|ELECTRON_|NODE_|npm_)/i.test(key) || key === "FFMPEG_BIN") delete env[key];
  Object.assign(env, { VIRAL_AI_UPDATE_TEST_URL: feed, VIRAL_AI_UPDATE_TEST_PROFILE: session.profile,
    VIRAL_AI_UPDATE_TEST_DEBUG_PORT: String(debug), LOCALAPPDATA: path.join(session.root, "cache") });
  return env;
}
function isolateRestartShortcut(session, debug) {
  // NSIS uses Explorer's environment when opening the existing app shortcut.
  // Give that launcher an explicit temp profile, then restore its exact bytes.
  const shortcut = path.join(process.env.APPDATA, "Microsoft/Windows/Start Menu/Programs/Viral AI Tool.lnk");
  const original = fs.readFileSync(shortcut), configPath = path.join(session.root, "restart-shortcut.json");
  const backup = path.join(session.root, "original-start-menu-" + randomUUID() + ".lnk");
  fs.writeFileSync(backup, original, { flag: "wx" });
  fs.writeFileSync(configPath, JSON.stringify({ shortcut, backup, target: session.installedExe, profile: session.profile, debug }));
  const script = "$fixture = ConvertFrom-Json ([IO.File]::ReadAllText($env:VIRAL_AI_VERIFICATION_SHORTCUT_CONFIG)); " +
    "$launcher = (New-Object -ComObject WScript.Shell).CreateShortcut($fixture.shortcut); " +
    "if ($launcher.TargetPath -ne $fixture.target) { throw 'Unexpected launcher target' }; " +
    "$launcher.Arguments = '\"--user-data-dir=' + $fixture.profile + '\" --remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $fixture.debug; $launcher.Save()";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, VIRAL_AI_VERIFICATION_SHORTCUT_CONFIG: configPath }, windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) { fs.writeFileSync(shortcut, original); throw Error("Could not isolate restart launcher: " + result.stderr); }
  return () => { fs.writeFileSync(shortcut, original); assert(fs.readFileSync(shortcut).equals(original)); };
}
async function connect(debug, version, retries = 60) {
  let browser;
  for (let i = 0; i < 300; i++) {
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:" + debug, { timeout: 500 }); break; } catch { await sleep(200); }
  }
  assert(browser, "No packaged debugging endpoint");
  const context = browser.contexts()[0]; let page = context.pages()[0];
  if (!page) page = await context.waitForEvent("page", { timeout: 20000 });
  page.setDefaultTimeout(20000);
  await page.waitForFunction(() => document.documentElement.dataset.coreFirstPaint === "ready" && window.ViralCoreProjectPersistence && window.desktopAPI);
  if (version !== "0.14.1-beta.1") await page.waitForFunction(() => document.documentElement.dataset.privateBeta === "true");
  const info = await page.evaluate(() => window.desktopAPI.getVersionInfo());
  if (info.version !== version && retries > 0) { await browser.close(); await sleep(250); return connect(debug, version, retries - 1); }
  if (info.version !== version) { await browser.close(); throw Error("Expected " + version + ", got " + info.version); }
  assert.equal(info.packaged, true); assert.equal(context.pages().length, 1);
  assert(page.url().includes("/resources/app.asar/renderer/index.html"));
  return { browser, page, info };
}
async function launch(session, version, feed) {
  const debug = await port(), env = environment(session, feed, debug);
  const child = spawn(installedExe, ["--user-data-dir=" + session.profile, "--remote-debugging-port=" + debug], { env, cwd: session.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(session.root, version + ".log"), { flags: "a" });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once("close", () => log.end());
  return { ...await connect(debug, version), child, debug, env };
}
async function close(app) {
  await app.page.evaluate(() => window.desktopAPI.close());
  await app.page.waitForEvent("close", { timeout: 15000 }).catch(() => {});
  await app.browser.close().catch(() => {}); await sleep(500);
}
async function locale(page, value) {
  await page.locator("#langMenuButton").click(); await page.locator('button[data-locale="' + value + '"]').click();
  await page.waitForFunction(value => state.locale === value, value);
}
async function route(page, value) {
  await page.locator('#nav [data-page="' + value + '"]').click(); await page.waitForFunction(value => state.page === value, value);
}
async function waitState(page, expected, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let result;
  do {
    result = await page.evaluate(() => window.desktopAPI.getAppUpdateState());
    if (result.status === expected) return result;
    await sleep(100);
  } while (Date.now() < deadline);
  throw Error("Expected " + expected + ", got " + JSON.stringify(result));
}
async function feedServer(session, metadataPath) {
  const yaml = require("js-yaml"), metadata = metadataPath ? fs.readFileSync(metadataPath) : null;
  const info = metadata ? yaml.load(metadata.toString()) : null;
  const installer = info ? path.join(path.dirname(metadataPath), "Viral AI Tool-" + info.version + "-x64.exe") : null;
  if (info) {
    assert.equal(createHash("sha512").update(fs.readFileSync(installer)).digest("base64"), info.files[0].sha512);
    assert.equal(fs.statSync(installer).size, info.files[0].size);
  }
  const control = { mode: "normal", requests: [] };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1); control.requests.push({ mode: control.mode, name });
    if (!metadata || control.mode === "404") { res.writeHead(404); res.end(); return; }
    if (name === "beta.yml") { res.writeHead(200, { "Content-Type": "text/yaml" }); res.end(control.mode === "no-newer" ? fs.readFileSync(path.join(release, "beta2/beta.yml")) : metadata); return; }
    if (name.endsWith(".blockmap")) { res.writeHead(404); res.end(); return; }
    if (name === info.files[0].url) {
      if (control.mode === "download-error") { res.writeHead(503); res.end(); return; }
      if (control.mode === "corrupt") { const data = Buffer.from("deliberately corrupt local verification artifact"); res.writeHead(200, { "Content-Length": data.length }); res.end(data); return; }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": fs.statSync(installer).size });
      // Actual streamed installer produces native progress, without altering bytes.
      const input = fs.createReadStream(installer, { highWaterMark: 256 * 1024 });
      input.on("data", chunk => { if (!res.write(chunk)) input.pause(); }); res.on("drain", () => input.resume()); input.on("end", () => res.end()); res.on("close", () => input.destroy()); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const feedPort = server.address().port;
  return { control, url: "http://127.0.0.1:" + feedPort + "/",
    pause: () => new Promise(resolve => server.close(resolve)),
    resume: () => new Promise(resolve => server.listen(feedPort, "127.0.0.1", resolve)),
    close: () => new Promise(resolve => server.close(() => resolve())) };
}
async function prepare() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viral-private-beta-update-")), profile = path.join(root, "profile"); fs.mkdirSync(profile);
  const session = { root, profile, installedExe, manualSeed: false, autoUpdate: false };
  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  const server = await feedServer(session);
  let app;
  try {
    app = await launch(session, "0.14.1-beta.1", server.url);
    const page = app.page;
    await route(page, "ai-create"); await page.locator("[data-ai-new-project]").click();
    await page.waitForFunction(() => window.ViralCoreProjectPersistence.activeProjectId());
    await page.evaluate(() => {
      const first = state.scenePlan.scenes[0];
      state.scenePlan = window.ViralCoreScenePlanModel.normalizePlan({ ...state.scenePlan, scenes: [first, { ...first, id: "beta-update-scene-2", order: 1, title: "Update fixture scene 2" }] });
      window.ViralCoreProjectPersistence.flush("update-test-two-scenes");
    });
    const project = await page.evaluate(() => window.ViralCoreProjectPersistence.snapshot());
    assert.equal(project.scenePlan.scenes.length, 2);
    const jobs = [0, 0, 1].map(index => ({ id: randomUUID(), projectId: project.projectId, sceneId: project.scenePlan.scenes[index].id,
      kind: "video", provider: "fixture", status: "completed" }));
    const paths = jobs.map(job => path.join(profile, "generation/outputs", job.id, job.id + ".mp4"));
    fs.mkdirSync(path.dirname(paths[0]), { recursive: true });
    const encoder = path.join(path.dirname(installedExe), "resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe");
    const result = spawnSync(encoder, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=purple:s=320x180:r=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", paths[0]], { windowsHide: true, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
    for (const target of paths.slice(1)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(paths[0], target); }
    await page.evaluate(async ({ jobs, paths }) => {
      const api = window.ViralCoreProjectPersistence;
      for (let i = 0; i < jobs.length; i++) {
        const job = { ...jobs[i], asset: { fileName: jobs[i].id + ".mp4" }, output: { fileName: jobs[i].id + ".mp4" } };
        const meta = await window.desktopAPI.probeVideo(paths[i]);
        api.registerGenerationJob(job); api.attachGeneratedOutput(job, { jobId: job.id, projectId: job.projectId, sceneId: job.sceneId, verified: true, fileName: job.id + ".mp4", path: paths[i] }, meta);
      }
      api.selectSceneMaterial(jobs[0].sceneId, "generation:" + jobs[1].id); api.selectSceneMaterial(jobs[2].sceneId, "generation:" + jobs[2].id);
      await enrichJob(state.jobs.find(job => job.sourcePath)); api.flush("update-test-baseline");
    }, { jobs, paths });
    session.projectA = projection(await page.evaluate(() => window.ViralCoreProjectPersistence.snapshot()));
    session.projectB = await page.evaluate(async () => {
      const api = window.ViralCoreProjectPersistence; await api.createProject({ kind: "ai", projectName: "Update fixture B" }); return api.activeProjectId();
    });
    await page.evaluate(id => window.ViralCoreProjectPersistence.openProject(id), session.projectA.projectId);
    session.sourceHashes = paths.map(file => ({ file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2)); await close(app); app = null;
    console.log(JSON.stringify({ phase: "prepared-installed-beta1", root, profile, projectA: session.projectA.projectId, scenes: session.projectA.sceneIds.length }));
  } finally { if (app) await close(app).catch(() => app.child.kill()); await server.close(); }
}
async function retention(page, session) {
  assert.deepEqual(projection(await page.evaluate(() => window.ViralCoreProjectPersistence.snapshot())), session.projectA);
  const projects = await page.evaluate(() => window.ViralCoreProjectPersistence.listProjects()); assert.equal(projects.length, 2);
  await page.evaluate(id => window.ViralCoreProjectPersistence.openProject(id), session.projectB);
  const second = await page.evaluate(() => window.ViralCoreProjectPersistence.snapshot());
  assert.equal(second.source, null); assert.equal(second.media.assets.length, 0); assert.equal(second.mediaAssembly.slots.length, 0);
  await page.evaluate(id => window.ViralCoreProjectPersistence.openProject(id), session.projectA.projectId);
  for (const item of session.sourceHashes) assert.equal(createHash("sha256").update(fs.readFileSync(item.file)).digest("hex"), item.sha256);
  const jobs = await page.evaluate(async () => { const result = await window.desktopAPI.listGenerationJobs(); return result.value || []; }); assert.equal(jobs.length, 0);
}
async function seed() {
  const session = JSON.parse(fs.readFileSync(sessionFile)); const server = await feedServer(session);
  let app;
  try {
    const debug = await port(), env = environment(session, server.url, debug);
    // Explicit manual invocation of seed installer. beta.1 has no updater.
    const installer = path.join(release, "Viral AI Tool-0.14.1-beta.2-x64.exe");
    const result = process.argv.includes("--inspect-seed") ? 0 : await new Promise((resolve, reject) => {
      const child = spawn(installer, ["/S", "/currentuser", "/D=" + path.dirname(installedExe)], { env, cwd: session.root, windowsHide: true, stdio: "ignore" });
      child.on("error", reject); child.on("close", resolve);
    });
    assert.equal(result, 0, "Manual beta.2 seed installation failed");
    app = await launch(session, "0.14.1-beta.2", server.url); const page = app.page;
    await retention(page, session);
    const expected = ["home", "ai-create", "generation-progress", "library", "settings"];
    assert.deepEqual(await page.locator("#nav [data-page]").evaluateAll(items => items.map(item => item.dataset.page)), expected);
    for (const routeId of expected) { await route(page, routeId); assert(await page.locator("#page").isVisible()); }
    for (const [hidden, safe] of [["accounts", "home"], ["billing", "settings"], ["usage", "settings"]]) {
      await page.evaluate(id => { state.page = id; render(); }, hidden); assert.equal(await page.evaluate(() => state.page), safe);
    }
    await page.evaluate(id => window.ViralCoreProjectPersistence.openProject(id), session.projectB);
    await page.evaluate(() => { state.page = "ai-video"; render(); }); assert.equal(await page.evaluate(() => state.page), "home");
    await page.locator('[data-start-route="download"]').click(); assert.equal(await page.evaluate(() => state.page), "download");
    await page.evaluate(id => window.ViralCoreProjectPersistence.openProject(id), session.projectA.projectId);
    await route(page, "ai-create"); await page.locator('[data-ai-route="ai-video"]').click(); await page.waitForSelector("[data-scene-materials]");
    await page.waitForFunction(() => { const video = document.querySelector("video.preview-video, video.core-player-media"); return video?.videoWidth > 0; });
    for (const lang of ["vi", "en"]) {
      await locale(page, lang); await route(page, "settings"); await page.waitForSelector("#betaUpdates");
      assert.equal(await page.locator(".brand-sub").textContent(), lang === "en" ? "Private Beta" : "Beta nội bộ");
      await page.screenshot({ path: path.join(release, "beta2-settings-" + lang + ".png") });
      await page.locator("#betaUpdates").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(release, "beta2-updates-" + lang + ".png") });
      await route(page, "home"); await page.screenshot({ path: path.join(release, "beta2-home-" + lang + ".png") });
    }
    await route(page, "settings");
    await page.keyboard.press("Tab");
    const expanded = await page.evaluate(() => {
      const copy = window.I18N.messages.en.betaUpdates, automatic = copy.automatic, check = copy.check;
      copy.automatic += " " + automatic.slice(0, Math.ceil(automatic.length * 0.4));
      copy.check += " " + check.slice(0, Math.ceil(check.length * 0.4)); render();
      const panel = document.getElementById("betaUpdates"), button = panel.querySelector('[data-beta-update="check"]');
      button.focus();
      const css = getComputedStyle(button);
      const result = { fits: panel.scrollWidth <= panel.clientWidth + 1, focus: document.activeElement === button,
        focusVisible: button.matches(":focus-visible") && (css.outlineStyle !== "none" || css.boxShadow !== "none") };
      copy.automatic = automatic; copy.check = check; render(); return result;
    });
    assert.deepEqual(expanded, { fits: true, focus: true, focusVisible: true });
    await retention(page, session);
    session.manualSeed = true; session.visual = { singleWindow: true, locales: ["vi", "en"], routes: expected, contextualImport: true, contextualStudio: true, decodedMedia: true, textExpansion40Percent: true, focusVisible: true };
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2)); await close(app); app = null;
    console.log(JSON.stringify({ phase: "manual-beta1-to-beta2-passed", root: session.root, visual: session.visual }));
  } finally { if (app) await close(app).catch(() => app.child.kill()); await server.close(); }
}
async function update() {
  const session = JSON.parse(fs.readFileSync(sessionFile)); assert(session.manualSeed);
  const cache = path.resolve(session.root, "cache/viral-ai-tool-updater");
  assert(/^viral-private-beta-update-[a-z0-9-]+$/i.test(path.basename(session.root)) && path.relative(session.root, cache) === path.join("cache", "viral-ai-tool-updater"));
  fs.rmSync(cache, { recursive: true, force: true });
  const server = await feedServer(session, path.join(release, "beta3/beta.yml")); let app, restoreShortcut;
  try {
    app = await launch(session, "0.14.1-beta.2", server.url); let page = app.page;
    await route(page, "settings");
    await waitState(page, "available");
    await page.waitForSelector(".beta-update-notice:not([hidden])");
    await page.locator('.beta-update-notice [data-beta-update="later"]').click();
    await page.locator('[data-beta-update="check"]').click();
    await waitState(page, "available");
    assert.equal(await page.locator(".beta-update-notice:visible").count(), 0, "Later persists for this session");
    const states = await page.evaluate(() => { window.__updateStates = []; window.desktopAPI.onAppUpdateState(s => window.__updateStates.push(s)); return true; }); assert(states);
    const check = () => page.evaluate(() => window.desktopAPI.checkAppUpdate());
    const download = () => page.evaluate(() => window.desktopAPI.downloadAppUpdate());
    await server.pause(); assert.equal((await check()).status, "error"); await server.resume();
    server.control.mode = "no-newer"; assert.equal((await check()).status, "not-available");
    server.control.mode = "404"; assert.equal((await check()).status, "error");
    server.control.mode = "download-error"; await check(); assert.equal((await download()).status, "error");
    server.control.mode = "corrupt"; await check(); assert.equal((await download()).status, "error");
    server.control.mode = "normal"; await check();
    await page.locator('[data-beta-update="download"]').click();
    await waitState(page, "downloaded", 120000);
    assert(await page.evaluate(() => window.__updateStates.some(s => s.status === "downloading" && s.percent > 0)));
    const blocked = await page.evaluate(async () => {
      state.voice.job = { status: "generating" };
      return window.desktopAPI.installAppUpdate();
    });
    assert.equal(blocked.errorCode, "UPDATE_SAVE_REQUIRED", JSON.stringify(blocked));
    await page.evaluate(() => { state.voice.job = null; });
    await retention(page, session); await route(page, "settings");
    await page.locator("#betaUpdates").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(release, "beta2-update-ready.png") });
    session.progress = await page.evaluate(() => window.__updateStates.filter(s => s.status === "downloading").map(s => s.percent));
    const debug = app.debug;
    // Also prove that the user's explicit opt-out persists through the update;
    // Explorer need not inherit the local feed after the app has restarted.
    await page.evaluate(() => window.desktopAPI.setAppUpdateAutomatic(false));
    restoreShortcut = isolateRestartShortcut(session, debug);
    const closed = page.waitForEvent("close", { timeout: 20000 });
    await page.locator('[data-beta-update="install"]').click();
    await closed; await app.browser.close().catch(() => {}); app = null;
    // Connect to the process NSIS itself relaunched, not a harness-spawned app.
    const restarted = await connect(debug, "0.14.1-beta.3"); app = restarted; page = restarted.page;
    await retention(page, session);
    assert.equal((await page.evaluate(() => window.desktopAPI.getAppUpdateState())).automatic, false);
    session.autoUpdate = true; session.installedVersion = restarted.info.version; session.notificationDeduplicated = true;
    session.failurePaths = { feedUnreachable: true, metadata404: true, downloadError: true, corruptArtifactRejected: true, unsafeInstallBlocked: true, noNewerVersion: true };
    session.feedRequests = server.control.requests; session.checkedAt = new Date().toISOString();
    restoreShortcut(); restoreShortcut = null;
    session.restartShortcutRestored = true; session.updatePreferenceRetained = true;
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2)); await close(app); app = null;
    console.log(JSON.stringify({ phase: "beta2-to-beta3-auto-update-passed", installedVersion: session.installedVersion, root: session.root, progressEvents: session.progress.length, failurePaths: session.failurePaths }));
  } finally { if (restoreShortcut) restoreShortcut(); if (app) await close(app).catch(() => app.child?.kill()); await server.close(); }
}
const phases = { prepare, seed, update };
if (require.main === module) {
  const phase = process.argv[2];
  if (!phases[phase]) throw Error("Choose prepare, seed or update");
  phases[phase]().catch(error => { console.error(error); console.error("Verification session:", sessionFile); process.exitCode = 1; });
}
