"use strict";
// One command owns both launches. No existing profile/lock is touched.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn } = require("node:child_process"), { randomUUID } = require("node:crypto");
async function run(mode = "completed", verify = false) {
  if (process.env.NODE_ENV === "production") throw Error("DEV harness unavailable in production");
  if (!["completed", "persistence-failure", "tampered", "noncompleted", "legacy"].includes(mode)) throw Error("Invalid DEV mode");
  const session = randomUUID(), root = path.join(os.tmpdir(), "viral-ai-handoff-" + session);
  const env = { ...process.env, VIRAL_AI_DEV_HANDOFF_FIXTURE: mode, VIRAL_AI_DEV_HANDOFF_SESSION: session,
    VIRAL_AI_DEV_HANDOFF_AUTOCLOSE: verify ? "1" : "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VIRAL_AI_DEV_GENERATION_STATE;
  const launch = () => new Promise((resolve, reject) => {
    const child = spawn(require("electron"), ["."], { cwd: path.resolve(__dirname, ".."), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const log = fs.createWriteStream(path.join(os.tmpdir(), "viral-ai-handoff-" + session + ".log"), { flags: "a" });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    // Timeout terminates only this explicitly launched DEV child, never another app.
    const timer = verify ? setTimeout(() => { child.kill(); reject(Error("DEV desktop timeout; log: " + log.path)); }, 60000) : null;
    child.on("error", reject);
    child.on("close", code => { clearTimeout(timer); log.end(); code === 0 ? resolve() : reject(Error("DEV desktop exit " + code + "; log: " + log.path)); });
  });
  console.log("DEV handoff profile:", root);
  await launch();
  const first = JSON.parse(fs.readFileSync(path.join(root, "first-pass.json"), "utf8"));
  if (!first.ok) throw Error(JSON.stringify(first));
  if (mode === "completed") {
    await launch(); // Same profile/identity, actual new Electron process.
    const restarted = JSON.parse(fs.readFileSync(path.join(root, "restart-pass.json"), "utf8"));
    if (!restarted.ok) throw Error(JSON.stringify(restarted));
  }
  console.log("DEV handoff passed:", mode, root);
  return root;
}
module.exports = { run };
if (require.main === module) run(process.argv.find(value => value.startsWith("--mode="))?.slice(7) || "completed", process.argv.includes("--verify"))
  .catch(error => { console.error(error); process.exitCode = 1; });
