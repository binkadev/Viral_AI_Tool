const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const releaseInfo = JSON.parse(fs.readFileSync(path.join(root, "release-info.json"), "utf8"));

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: String(detail || "") });
}

check(
  "Version format",
  /^\d+\.\d+\.\d+$/.test(pkg.version),
  pkg.version
);
check(
  "Lockfile version",
  lock.version === pkg.version && lock.packages?.[""]?.version === pkg.version,
  "package=" + pkg.version + " lock=" + lock.version + " root=" + (lock.packages?.[""]?.version || "missing")
);
check(
  "Changelog entry",
  changelog.includes("## " + pkg.version),
  "CHANGELOG.md contains ## " + pkg.version
);
check(
  "Windows icon",
  fs.existsSync(path.join(root, pkg.build?.win?.icon || "")),
  pkg.build?.win?.icon || "missing"
);
check(
  "Stable manifest URL",
  releaseInfo.updateManifestUrl === "https://github.com/binkadev/Viral_AI_Tool/releases/latest/download/RELEASE-MANIFEST.json",
  releaseInfo.updateManifestUrl
);
check(
  "Release page URL",
  releaseInfo.releasePageUrl === "https://github.com/binkadev/Viral_AI_Tool/releases/latest",
  releaseInfo.releasePageUrl
);
check(
  "Electron builder publish disabled",
  String(pkg.scripts?.dist || "").includes("--publish never"),
  pkg.scripts?.dist || "missing"
);

const commands = [
  ["Release policy", ["npm", ["run", "test:release-policy"]]],
  ["Release assets", ["npm", ["run", "test:release-assets"]]],
  ["Release readiness", ["npm", ["run", "test:release-readiness"]]],
  ["Update client", ["npm", ["run", "test:update-client"]]],
  ["Diagnostics privacy", ["npm", ["run", "test:diagnostics"]]],
  ["Cloud release config", ["npm", ["run", "test:cloud-release-config"]]],
  ["Deployment config", ["npm", ["run", "test:deployment-config"]]],
  ["Cloud speech upload routing", ["npm", ["run", "test:cloud-speech-upload"]]],
  ["Core async job states", ["npm", ["run", "test:core-job-model"]]],
  ["Core player synchronization", ["npm", ["run", "test:core-player"]]],
  ["Core transcript editing", ["npm", ["run", "test:core-transcript"]]],
  ["Core workflow gating", ["npm", ["run", "test:core-workflow"]]],
  ["Core editor layout", ["npm", ["run", "test:core-layout"]]],
  ["Core capability guard", ["npm", ["run", "test:core-capabilities"]]]
];

for (const [name, [command, args]] of commands) {
  const bin = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });

  check(
    name,
    result.status === 0,
    result.status === 0
      ? "passed"
      : (result.stderr || result.stdout || "failed").trim().slice(-800)
  );
}

const width = Math.max(...checks.map(item => item.name.length), 10);
console.log("");
console.log("Viral AI Tool release preflight — v" + pkg.version);
console.log("=".repeat(64));

for (const item of checks) {
  console.log(
    (item.ok ? "PASS" : "FAIL") + "  " +
    item.name.padEnd(width) + "  " +
    item.detail
  );
}

const failures = checks.filter(item => !item.ok);
console.log("=".repeat(64));

if (failures.length) {
  console.error(failures.length + " preflight check(s) failed.");
  process.exitCode = 1;
} else {
  console.log("Source-level release preflight passed.");
  console.log("External Stable blockers still require CI/operator verification: signing certificate, production HTTPS backend, real billing adapter/readiness, and clean-machine smoke test.");
}
