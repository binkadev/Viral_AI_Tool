"use strict";
// Build-time beta authority. Never imported by desktop runtime.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
const repo = "binkadev/Viral_AI_Tool";
function parseTag(tag) {
  assert.equal(typeof tag, "string", "Beta tag required");
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/.exec(tag);
  assert(match && match[0] === tag && match.slice(1).every(n => Number(n) <= 65535), "Expected canonical Windows beta tag vX.Y.Z-beta.N");
  return { tag, version: tag.slice(1), installer: `Viral-AI-Tool-${tag.slice(1)}-x64.exe` };
}
function assetNames(tag) { const info = parseTag(tag); return [info.installer, "beta.yml", info.installer + ".blockmap"]; }
const sha = (data, algorithm = "sha256", encoding = "hex") => crypto.createHash(algorithm).update(data).digest(encoding);
function validateMetadata(metadata, tag, bytes) {
  const info = parseTag(tag);
  assert.equal(metadata?.version, info.version, "Metadata version mismatch");
  assert.equal(metadata.path, info.installer, "Metadata filename/architecture mismatch");
  assert.equal(metadata.files?.length, 1, "Exactly one x64 installer required");
  const file = metadata.files[0];
  assert.equal(file.url, info.installer, "Metadata URL must be the exact release filename");
  assert(bytes.length > 0); assert.equal(file.size, bytes.length, "Installer size mismatch");
  assert.equal(file.sha512, sha(bytes, "sha512", "base64"), "Installer SHA-512 mismatch");
  assert.equal(metadata.sha512, file.sha512, "Legacy SHA-512 mismatch");
  assert(Number.isFinite(Date.parse(metadata.releaseDate)), "Release date missing/invalid");
  return info;
}
function scan(name, bytes) {
  // One exact pinned upstream install-time S3 fixture, expired in 2020, is public.
  const publicFixture = name === "node_modules/ffmpeg-static/install.js" && sha(bytes) === "9801ce3aa35e45f72f7d13339ff04c916011b529040d1a1301c74102ed335fb9";
  for (const text of [bytes.toString("utf8"), bytes.toString("utf16le")]) {
    assert(!/(?:[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'<>\x00]+|\/(?:Users|home)\/[^\s"'<>\x00]+)/i.test(text), "Personal path in " + name);
    assert(publicFixture || !/\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,}|sk-(?:proj-)?[a-zA-Z0-9_-]{40,}|AKIA[A-Z0-9]{16}|\d{8,12}:[A-Za-z0-9_-]{35})\b/.test(text), "Recognizable credential in " + name);
    // Native crypto libraries contain PEM label literals; require key material,
    // not just an isolated BEGIN label, before classifying a credential.
    assert(!/-----BEGIN ((?:RSA |EC |OPENSSH )?PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]{64,}\r?\n-----END \1-----/.test(text), "Private key material in " + name);
  }
}
function windowsInfo(file) {
  return JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$v = (Get-Item -LiteralPath $env:VIRAL_BETA_VERIFY_EXE).VersionInfo; @{productName=$v.ProductName;fileVersion=$v.FileVersion;productVersion=$v.ProductVersion;signature=[string](Get-AuthenticodeSignature -LiteralPath $env:VIRAL_BETA_VERIFY_EXE).Status} | ConvertTo-Json -Compress"],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, VIRAL_BETA_VERIFY_EXE: path.resolve(file) } }));
}
function validateVersionResources(resources, version) {
  assert.equal(resources.length, 2);
  for (const [index, resource] of resources.entries()) {
    assert.equal(resource.productName, "Viral AI Tool"); assert.equal(resource.fileVersion, version);
    // Existing rcedit app resources use numeric ProductVersion; the installer
    // and packaged app.getVersion/FileVersion retain the full beta SemVer.
    assert.equal(resource.productVersion, index === 0 ? version : version.split("-")[0] + ".0");
    assert.equal(resource.signature, "NotSigned");
  }
}
function verifyArtifacts(directory, tag, { commit, packaged = true } = {}) {
  const info = parseTag(tag), names = assetNames(tag), yaml = require("js-yaml");
  const files = names.map(file => {
    const bytes = fs.readFileSync(path.join(directory, file)); assert(bytes.length > 0, "Empty artifact"); scan(file, bytes);
    return { file, size: bytes.length, sha256: sha(bytes) };
  });
  const installer = fs.readFileSync(path.join(directory, info.installer));
  const metadata = yaml.load(fs.readFileSync(path.join(directory, "beta.yml"), "utf8"));
  validateMetadata(metadata, tag, installer);
  let packagedVerification = null, resources = null;
  if (packaged) {
    assert.equal(process.platform, "win32", "Full beta verification requires Windows");
    const archive = path.join(directory, "win-unpacked/resources/app.asar"), asar = require("@electron/asar");
    packagedVerification = require("./verify-private-beta-package").verify(archive);
    require("./verify-muse-package").verify(archive);
    const read = name => asar.extractFile(archive, path.normalize(name));
    const pkg = JSON.parse(read("package.json")), release = JSON.parse(read("release-info.json"));
    // Builder strips the development build object from packaged package.json.
    const effective = JSON.parse(fs.readFileSync(path.join(directory, "beta-build-identity.json"), "utf8"));
    assert.equal(pkg.version, info.version); assert.equal(pkg.name, "viral-ai-tool");
    assert.equal(effective.appId, "com.viralai.tool"); assert.equal(effective.productName, "Viral AI Tool");
    assert.equal(effective.arch, "x64"); assert.equal(effective.version, info.version);
    assert.equal(release.betaTag, tag); assert.equal(release.commit, commit); assert.match(commit, /^[a-f0-9]{40}$/);
    assert.equal(release.source, "private-beta"); assert.equal(release.channel, "beta");
    assert.equal(release.updateManifestUrl, null); assert.equal(release.releasePageUrl, null);
    const provider = yaml.load(fs.readFileSync(path.join(directory, "win-unpacked/resources/app-update.yml"), "utf8"));
    assert.equal(provider.provider, "github"); assert.equal(provider.owner + "/" + provider.repo, repo); assert.equal(provider.channel, "beta");
    assert(!provider.token && !provider.private && !provider.publisherName, "Unexpected authenticated/signed beta provider");
    const executable = path.join(directory, "win-unpacked/Viral AI Tool.exe"), pe = fs.readFileSync(executable);
    assert.equal(pe.readUInt16LE(pe.readUInt32LE(0x3c) + 4), 0x8664, "App payload must be x64");
    resources = [windowsInfo(path.join(directory, info.installer)), windowsInfo(executable)];
    validateVersionResources(resources, info.version);
    const builtins = new Set(require("node:module").builtinModules.flatMap(n => [n, "node:" + n]));
    for (const entry of asar.listPackage(archive)) {
      const name = entry.replaceAll("\\", "/").replace(/^\//, "");
      if (asar.statFile(archive, path.normalize(name)).files) continue;
      const bytes = read(name); scan(name, bytes);
      if (/^(?:services|renderer)\/.*\.js$/.test(name) || ["main.js", "preload.js", "startup-main.js"].includes(name)) {
        for (const match of bytes.toString("utf8").matchAll(/require\(['"]([^.'"][^'"]*)['"]\)/g)) {
          if (builtins.has(match[1]) || match[1] === "electron") continue;
          const owner = match[1].startsWith("@") ? match[1].split("/").slice(0, 2).join("/") : match[1].split("/")[0];
          assert(pkg.dependencies?.[owner], "Undeclared runtime dependency: " + owner);
        }
      }
    }
  }
  return { ...info, commit: commit || null, platform: "win32", arch: "x64", signed: false, files, packagedVerification, resources,
    scan: "Recognizable credential and personal-path heuristic passed; exact public expired upstream S3 fixture allowed. Not a proof against every possible secret format." };
}
function git(...args) { return cp.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function build(tag, output) {
  const info = parseTag(tag), commit = git("rev-parse", "HEAD");
  if (process.env.GITHUB_ACTIONS === "true") {
    assert.equal(process.env.GITHUB_REF_TYPE, "tag"); assert.equal(process.env.GITHUB_REF_NAME, tag); assert.equal(process.env.GITHUB_SHA, commit);
    assert.equal(git("rev-parse", tag + "^{commit}"), commit);
  }
  const target = path.resolve(root, output), relative = path.relative(root, target);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Build output must be inside checkout");
  assert(!fs.existsSync(target), "Fresh beta output directory required");
  const metadataPath = path.join(root, "release-info.json"), original = fs.readFileSync(metadataPath);
  const metadata = JSON.parse(original.toString("utf8")); assert.equal(metadata.source, "private-beta"); assert.equal(metadata.channel, "beta");
  const builtAt = new Date(Number(git("show", "-s", "--format=%ct", commit)) * 1000).toISOString();
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:CSC_|WIN_CSC_|VIRAL_AI_UPDATE_TEST_|GH_TOKEN$|GITHUB_TOKEN$|ELECTRON_RUN_AS_NODE$)/i.test(key)) delete env[key];
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  try {
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, commit, betaTag: tag, builtAt }, null, 2) + "\n");
    cp.execFileSync(process.execPath, [path.join(root, "node_modules/electron-builder/out/cli/cli.js"), "--win", "nsis", "--x64", "--publish", "never",
      "--config.directories.output=" + target, "--config.extraMetadata.version=" + info.version, "--config.afterPack=scripts/verify-beta-build.js",
      "--config.artifactName=Viral-AI-Tool-${version}-${arch}.${ext}"], { cwd: root, env, stdio: "inherit", windowsHide: true });
    const result = verifyArtifacts(target, tag, { commit });
    fs.writeFileSync(path.join(target, "beta-verification.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally { fs.writeFileSync(metadataPath, original); }
}
module.exports = { root, repo, parseTag, assetNames, sha, scan, validateMetadata, validateVersionResources, verifyArtifacts, build };
if (require.main === module) {
  try {
    const [action, tag, output = "release/beta-public"] = process.argv.slice(2);
    assert(["build", "verify"].includes(action), "Use build|verify TAG [OUTPUT]");
    const result = action === "build" ? build(tag, output) : verifyArtifacts(path.resolve(output), tag, { commit: git("rev-parse", "HEAD") });
    if (action === "verify") fs.writeFileSync(path.join(path.resolve(output), "beta-verification.json"), JSON.stringify(result, null, 2) + "\n");
    if (action === "build" && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "installer=" + result.installer + "\n");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
