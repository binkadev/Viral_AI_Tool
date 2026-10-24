# Remote unsigned private beta

The beta authority is a fresh canonical lightweight tag `vX.Y.Z-beta.N` pointing
to the exact reviewed release commit. Never reuse an existing tag or release.
Do not push the feature branch behind PR #56 to publish a beta. A tag-only push
can make the exact release source available without changing that PR's head.

`private-beta-release.yml` runs only for beta tags and validates them again in
Node tooling. The existing Windows stable/preview job skips beta tags. Build
permissions are contents:read; only the dependent publish job has contents:write.
There is no signing credential or desktop access token.

Version chain: tag -> validated version -> builder extraMetadata.version ->
packaged package.json/app.getVersion -> beta.yml -> matching prerelease assets.
Development package/lockfile versions remain unchanged. Build-time release-info
stamps the actual source commit/tag and its commit time, retaining source
private-beta and channel beta. The build command restores the checked-in metadata
in finally; do not commit generated release-info after an interrupted build.

## Before a tag push

Audit public repository/releases/tags/permissions; choose the lowest fresh beta
strictly newer than the installed acceptance seed. Run release tooling/updater,
commercial, identity/Registry/guard tests, GATE-001, BASE-VOICE-RESTORE, npm start,
preflight and patch integrity checks. Validate a real local build where practical:

```text
node --test tests/beta-release.test.js
node scripts/beta-release.js build vX.Y.Z-beta.N out/beta-candidate
```

Output must be a fresh directory. Local build does not publish or create a tag.
The reproducible recipe uses locked dependencies, Electron/builder versions,
validated tag and exact source commit; byte-for-byte reproducible NSIS output is
not claimed because executable/archive build timestamps can differ.

Create one implementation commit after checks. Immediately recheck remote tag,
release and conflicting version absence, then push only its fresh tag. Do not
force push, overwrite tags, replace assets or modify historical beta.2. Preserve
the existing patch files. A release collision is a stop condition.

## Publication guards

Build uses Windows x64 NSIS and publish never. Full verification checks actual
version resources, app identity, x64 application payload, packaged dependencies,
provider, real YAML size/SHA-512, nonempty blockmap and recognizable secrets/paths.
The public allowlist contains exactly the hyphenated installer, beta.yml and its
blockmap. CI diagnostics/config/source/evidence/test helpers are excluded.

The publish job refuses any existing release, creates its own draft prerelease,
uploads the exact allowlist without clobber, checks API size/digest and downloads
the draft assets to compare bytes. Only that invocation's newly created draft ID
may be made public. Public anonymous release/asset reads then verify every hash.
Failure before publication leaves an unpublished draft for operator investigation;
reruns never silently replace an existing draft or published release.

GATE-003 remains a distinct legacy development/preview/stable JSON manifest gate.
The beta updater consumes genuine builder beta.yml. No dummy JSON or beta-to-preview
reclassification is part of this release.

## Operator remote acceptance

Use the separately accepted Windows machine with installed beta.3 and Project
`private beta`. Stop the loopback feed, quit normally, then launch from the normal
installed shortcut without test helpers or VIRAL_AI_UPDATE_TEST_URL. Check through
Settings -> Advanced -> Version & Updates. Confirm the fresh candidate before
Download; then use the application's Install/Restart action, never a manual EXE
upgrade. Record automatic reopening/version, both Scenes, Scene 1 material,
Scene 2 content and Midnight / Sinh động hơn / Lớn settings. Quit/reopen again;
same-version check must say latest. No data copy/repair before comparisons.

Only those actual observations establish remote installed-update acceptance.
Anonymous HTTP download verification alone is not desktop updater proof.

## Family flow after acceptance

1. Open the exact public GitHub beta release link and download its Windows installer.
2. Install and launch Viral AI. No GitHub token, source checkout, Node, editor or
   developer terminal is required.
3. Future beta versions: normal app check -> Download -> Install/Restart.

This is an **unsigned Windows x64 private/internal beta**, not commercial stable.
Normal SmartScreen warnings may appear; some Smart App Control/organizational
policies block unsigned apps. Keep Windows security unchanged and use a compatible
test system. Do not claim signing or universal Windows compatibility.
