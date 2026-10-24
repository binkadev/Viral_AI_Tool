"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const yaml = require("js-yaml");
const { parseTag, assetNames, sha, scan, validateMetadata, validateVersionResources, verifyArtifacts } = require("../scripts/beta-release");
const { validateRelease, releaseNotes } = require("../scripts/publish-beta-release");
const tag = "v0.14.1-beta.4", info = parseTag(tag), bytes = Buffer.from("unit-only installer bytes; not release evidence");
function metadata() { return { version: info.version, path: info.installer, files: [{ url: info.installer, size: bytes.length, sha512: sha(bytes, "sha512", "base64") }], sha512: sha(bytes, "sha512", "base64"), releaseDate: "2026-10-24T00:00:00Z" }; }
test("canonical tag is the only release version authority", () => {
  assert.equal(info.version, "0.14.1-beta.4"); assert.deepEqual(assetNames(tag), [info.installer, "beta.yml", info.installer + ".blockmap"]);
  assert.equal(parseTag("v1.2.3-beta.10").version, "1.2.3-beta.10");
});
for (const value of ["v0.14.1", "v0.14.1-preview.4", "v0.14.1-alpha.4", "0.14.1-beta.4", "v00.14.1-beta.4", "v0.14.1-beta.04", "v0.14.1-beta.0", "v0.14.1-beta.4+build", "v0.14.1-beta.4\n", "v0.14.1-beta.4;evil", "v65536.0.0-beta.1", null]) {
  test("reject unsafe/wrong release authority " + JSON.stringify(value), () => assert.throws(() => parseTag(value)));
}
test("real metadata verifier binds bytes, version, x64 name and SHA-512", () => assert.equal(validateMetadata(metadata(), tag, bytes).version, info.version));
test("Windows resource validation preserves numeric app ProductVersion without admitting a wrong beta", () => {
  const installer = { productName: "Viral AI Tool", fileVersion: info.version, productVersion: info.version, signature: "NotSigned" };
  const app = { ...installer, productVersion: "0.14.1.0" };
  validateVersionResources([installer, app], info.version);
  assert.throws(() => validateVersionResources([installer, { ...app, fileVersion: "0.14.1-beta.3" }], info.version));
  assert.throws(() => validateVersionResources([installer, { ...app, productVersion: "0.14.2.0" }], info.version));
});
for (const [label, mutate] of [
  ["version", m => { m.version = "0.14.1-beta.3"; }], ["architecture", m => { m.path = m.path.replace("x64", "arm64"); }],
  ["arbitrary URL", m => { m.files[0].url = "https://example.invalid/update.exe"; }], ["path traversal", m => { m.files[0].url = "../update.exe"; }],
  ["size", m => { m.files[0].size++; }], ["hash", m => { m.files[0].sha512 = "wrong"; }], ["legacy hash", m => { m.sha512 = "wrong"; }],
  ["multiple installers", m => { m.files.push({ ...m.files[0] }); }], ["date", m => { delete m.releaseDate; }]
]) test("reject mismatched metadata " + label, () => { const m = metadata(); mutate(m); assert.throws(() => validateMetadata(m, tag, bytes)); });
test("artifact verifier fails on missing/corrupt files; public allowlist excludes evidence", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-beta-release-test-"));
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); assert(path.basename(dir).startsWith("viral-beta-release-test-")); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, info.installer), bytes); fs.writeFileSync(path.join(dir, "beta.yml"), yaml.dump(metadata()));
  assert.throws(() => verifyArtifacts(dir, tag, { packaged: false }));
  fs.writeFileSync(path.join(dir, info.installer + ".blockmap"), "blockmap unit fixture"); fs.writeFileSync(path.join(dir, "builder-debug.yml"), "local only");
  const result = verifyArtifacts(dir, tag, { packaged: false }); assert.deepEqual(result.files.map(f => f.file), assetNames(tag));
  fs.appendFileSync(path.join(dir, info.installer), "corrupt"); assert.throws(() => verifyArtifacts(dir, tag, { packaged: false }));
});
test("public metadata rejects credentials, private keys and personal paths", () => {
  for (const text of ["ghp_" + "a".repeat(36), "C:\\Users\\Developer\\source", "/home/developer/source", "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(80) + "\n-----END PRIVATE KEY-----"]) assert.throws(() => scan("beta.yml", Buffer.from(text)));
  assert.doesNotThrow(() => scan("native-crypto-library.dll", Buffer.from("-----BEGIN PRIVATE KEY-----")));
  assert.doesNotThrow(() => scan("beta.yml", Buffer.from("Viral-AI-Tool-0.14.1-beta.4-x64.exe")));
});
test("draft and public readback reject unexpected assets, version, size and digest", () => {
  const verification = { ...info, files: assetNames(tag).map(file => ({ file, size: 100, sha256: "a".repeat(64) })) };
  const release = { tag_name: tag, prerelease: true, draft: true, assets: verification.files.map(f => ({ name: f.file, size: f.size, digest: "sha256:" + f.sha256, state: "uploaded" })) };
  validateRelease(release, verification, { draft: true });
  for (const mutate of [r => { r.prerelease = false; }, r => { r.draft = false; }, r => { r.tag_name = "v0.14.1-beta.2"; }, r => { r.assets.push({ name: "debug.log" }); }, r => { r.assets[0].size++; }, r => { r.assets[0].digest = "wrong"; }]) {
    const changed = structuredClone(release); mutate(changed); assert.throws(() => validateRelease(changed, verification, { draft: true }));
  }
});
test("beta workflow is tag-only, least privilege, exact artifact allowlist, draft-first", () => {
  const workflow = yaml.load(fs.readFileSync(".github/workflows/private-beta-release.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["push"]); assert.deepEqual(Object.keys(workflow.on.push), ["tags"]);
  assert.deepEqual(workflow.on.push.tags, ["v[0-9]+.[0-9]+.[0-9]+-beta.[0-9]+"]);
  assert.equal(workflow.permissions.contents, "read"); assert.equal(workflow.jobs.publish.permissions.contents, "write"); assert.equal(workflow.jobs.publish.needs, "build");
  assert.equal(workflow.jobs.build["runs-on"], "windows-latest"); assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const upload = workflow.jobs.build.steps.find(s => s.uses?.startsWith("actions/upload-artifact@"));
  assert.deepEqual(upload.with.path.trim().split("\n"), ["release/beta-public/${{ steps.beta.outputs.installer }}", "release/beta-public/beta.yml", "release/beta-public/${{ steps.beta.outputs.installer }}.blockmap"]);
  assert(!workflow.jobs.build.steps.some(s => s.env?.GH_TOKEN));
  const publish = fs.readFileSync("scripts/publish-beta-release.js", "utf8"); assert(!publish.includes("--clobber")); assert(!publish.includes('"delete"')); assert(publish.includes("assertAbsent(tag)"));
  const stable = yaml.load(fs.readFileSync(".github/workflows/windows-release.yml", "utf8")); assert(stable.jobs["build-windows"].if.includes("!contains(github.ref_name, '-beta.')"));
  const lock = yaml.load(fs.readFileSync(".github/workflows/lock-dependencies.yml", "utf8")); assert(lock.jobs["lock-and-verify"].if.includes("github.ref_type != 'tag'"));
});
test("release notes disclose unsigned beta limitations and developer-free update flow", () => {
  const notes = releaseNotes(info.version); for (const text of [info.version, "Windows x64", "unsigned", "SmartScreen", "Smart App Control", "Check for updates", "not a commercial stable release"]) assert(notes.includes(text));
});
