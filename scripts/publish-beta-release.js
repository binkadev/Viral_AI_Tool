"use strict";
// Operator/CI release tooling only. Importing this module cannot publish.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { repo, parseTag, assetNames, sha, verifyArtifacts } = require("./beta-release");
function gh(...args) { return cp.execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024, windowsHide: true }).trim(); }
function api(endpoint) { return JSON.parse(gh("api", endpoint)); }
function assertAbsent(tag) {
  parseTag(tag);
  try { api(`repos/${repo}/releases/tags/${tag}`); }
  catch (error) { if (String(error.stderr).includes("HTTP 404")) return; throw error; }
  throw Error("Release already exists; refusing to edit or overwrite it");
}
function validateRelease(release, verification, { draft }) {
  assert.equal(release.tag_name, verification.tag); assert.equal(release.prerelease, true); assert.equal(release.draft, draft);
  assert.deepEqual(release.assets.map(a => a.name).sort(), assetNames(verification.tag).sort(), "Unexpected public asset list");
  for (const expected of verification.files) {
    const actual = release.assets.find(a => a.name === expected.file);
    assert.equal(actual.state, "uploaded", "Incomplete remote asset");
    assert.equal(actual.size, expected.size);
    if (actual.digest) assert.equal(actual.digest, "sha256:" + expected.sha256, "Remote asset digest mismatch");
  }
}
function releaseNotes(version) {
  return `Viral AI Tool ${version} — private/internal beta for Windows x64.\n\n` +
    "This installer is unsigned. SmartScreen may warn, and Smart App Control or organizational policy may block it on some Windows configurations. Keep Windows protections unchanged; use a compatible test system.\n\n" +
    "On compatible Windows systems, future beta versions are available through the application's normal Check for updates, Download, and Install/Restart actions. Existing local projects stay in the same application profile.\n\n" +
    "This is limited private-beta testing, not a commercial stable release. Download only the Windows installer below; the application handles update metadata automatically.\n";
}
async function publicVerify(tag, expected) {
  parseTag(tag);
  const json = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/vnd.github+json" } });
  assert.equal(json.status, 200, "Anonymous release request failed");
  const release = await json.json(); validateRelease(release, expected, { draft: false });
  const downloads = [];
  for (const file of expected.files) {
    const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file.file)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, 200, "Anonymous asset request failed: " + file.file);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.length, file.size); assert.equal(sha(data), file.sha256);
    downloads.push({ file: file.file, url, size: data.length, sha256: sha(data), anonymous: true });
  }
  return { tag, url: release.html_url, prerelease: true, draft: false, publicAnonymous: "PASS", downloads };
}
async function publish(tag, directory) {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Publish only through the beta workflow");
  assert.equal(process.env.GITHUB_REPOSITORY, repo);
  const info = parseTag(tag), commit = gh("api", `repos/${repo}/git/ref/tags/${tag}`, "--jq", ".object.sha");
  assert.equal(commit, process.env.GITHUB_SHA, "Remote tag must point at the exact workflow commit");
  assert.equal(process.env.GITHUB_REF_TYPE, "tag"); assert.equal(process.env.GITHUB_REF_NAME, tag);
  assert.equal(api(`repos/${repo}`).private, false, "Beta repository must remain public");
  const verification = verifyArtifacts(directory, tag, { packaged: false });
  assertAbsent(tag);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "viral-beta-publish-"));
  const request = path.join(scratch, "create.json");
  fs.writeFileSync(request, JSON.stringify({ tag_name: tag, target_commitish: commit, name: `Viral AI Tool ${info.version} — unsigned private beta`,
    body: releaseNotes(info.version), draft: true, prerelease: true, make_latest: "false" }));
  // Only the draft ID created in THIS invocation may be updated below.
  const created = JSON.parse(gh("api", "--method", "POST", `repos/${repo}/releases`, "--input", request));
  assert.equal(created.tag_name, tag); assert.equal(created.draft, true); assert.equal(created.prerelease, true);
  console.log("Created new draft prerelease", created.id, tag);
  gh("release", "upload", tag, ...assetNames(tag).map(name => path.join(directory, name)), "--repo", repo);
  const draft = api(`repos/${repo}/releases/${created.id}`); validateRelease(draft, verification, { draft: true });
  const downloaded = path.join(scratch, "assets"); fs.mkdirSync(downloaded);
  gh("release", "download", tag, "--repo", repo, "--dir", downloaded);
  for (const file of verification.files) assert.equal(sha(fs.readFileSync(path.join(downloaded, file.file))), file.sha256, "Draft readback mismatch");
  // Revalidate the freshly created draft immediately before making it public.
  validateRelease(api(`repos/${repo}/releases/${created.id}`), verification, { draft: true });
  assert.equal(api(`repos/${repo}/git/ref/tags/${tag}`).object.sha, commit, "Tag changed during draft validation");
  const edit = path.join(scratch, "publish.json"); fs.writeFileSync(edit, JSON.stringify({ draft: false, prerelease: true, make_latest: "false" }));
  const published = JSON.parse(gh("api", "--method", "PATCH", `repos/${repo}/releases/${created.id}`, "--input", edit));
  validateRelease(published, verification, { draft: false });
  let result, lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { result = await publicVerify(tag, verification); break; }
    catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 3000)); }
  }
  if (!result) throw lastError;
  fs.writeFileSync(path.join(directory, "publication-verification.json"), JSON.stringify({ ...result, commit, releaseId: created.id }, null, 2));
  return result;
}
module.exports = { assertAbsent, validateRelease, releaseNotes, publicVerify, publish };
if (require.main === module) {
  const [action, tag, directory = "release/beta-public"] = process.argv.slice(2);
  Promise.resolve().then(() => {
    assert(["publish", "public"].includes(action), "Use publish|public TAG [DIRECTORY]");
    return action === "publish" ? publish(tag, path.resolve(directory)) : publicVerify(tag, verifyArtifacts(path.resolve(directory), tag, { packaged: false }));
  }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
