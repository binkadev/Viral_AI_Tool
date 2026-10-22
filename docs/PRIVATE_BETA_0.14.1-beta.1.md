# Private Windows Beta — 0.14.1-beta.1

Built locally on 2026-10-22 for private testing, using product baseline
`46dbcc16dace401fa919a35605846b75c8bf4a73` plus the packaging changes in this commit.
The embedded commit identifies that product baseline. This is not a public release.

## Deliverables

- Installer: `release/Viral AI Tool-0.14.1-beta.1-x64.exe`
- Size: **116,957,613 bytes**
- SHA-256: `EC38CF596F215FD64005AE6F27D7DB7E6CF6B397E2F575E76739D2B834CABDD2`
- Packaged app: `release/win-unpacked/Viral AI Tool.exe`
- Target: Windows x64, assisted NSIS installer, per-user installation by default.
- Signature: **NotSigned**. Windows may show SmartScreen / unknown-publisher warnings.

The installer and unpacked output are ignored build artifacts, not Git content.
No upload, GitHub Release, push, or PR #56 update/merge was performed.

## Packaging audit and versioning

App version advances from `0.14.0` to `0.14.1-beta.1`; the Muse extension remains
`0.3.18`. The existing electron-builder 26.0.12 configuration, Electron 38.2.0,
`com.viralai.tool` identity, product name, icon, Start Menu shortcut, desktop shortcut,
and optional installation-directory selection are retained. No second builder is used.

The normal build command remains `npm run dist -- --x64` with `--publish never`.
For this unsigned build, certificate auto-discovery was disabled in the build process.
The local tool-cache extraction initially failed on unused macOS symlinks; extracting
the downloaded tool archive into its versioned cache with `-xr!darwin` allowed the
existing Windows branding/NSIS pipeline to run without enabling symlink privileges.

`startup-main.js`, main, preload, renderer, application assets, services, production
extension files and declared runtime dependencies are shipped in ASAR. The video
helper, local speech worker, native speech addon and Windows DLLs are unpacked where
required. The existing afterPack hook now also checks renderer assets, 125 relative
runtime imports, native helper files, development-file exclusions, and Beta metadata.

The About/version surface displays the version and localized Private Beta status.
Both embedded update/release URLs are null. Existing update code is preserved but
this build cannot start its background remote update check. No updater dependency,
update feed, publishing, or background download was added.

## Data and installation behavior

Ordinary launches retain the normal `%APPDATA%\viral-ai-tool` user-data directory.
The Project registry lives in Electron local storage; generation output lives under
`userData/generation/outputs`. Projects and media are not written into Program Files.
External imported-media paths continue to refer to their original files.

`deleteAppDataOnUninstall` is explicitly false. Ordinary NSIS uninstall is configured
to preserve user data. The pre-existing explicit `--delete-app-data` uninstaller
option remains a separate opt-in deletion path and was not invoked.

An existing installed Viral AI Tool **0.14.0** was found in the Windows uninstall
registry. Running the same-appId installer/uninstaller could alter that installation,
so actual installation, installed-app launch/relaunch and uninstallation were **not
performed**. Data retention across an actual uninstall is therefore not claimed as
an observed PASS; configuration/template inspection supports the behavior above.

## Packaged smoke test

The packaged executable was launched directly from a temporary working directory
with a new `--user-data-dir` profile and a child PATH containing only Windows
System32. Developer/provider environment overrides were removed. The test driver
used local CDP automation; it was not shipped or required by the application.
The real installed app and real forensic profile were not opened by this test.

Observed PASS:

- One intended app window; startup first paint becomes visible.
- Real pointer navigation and Project creation/open controls respond.
- Project schema v5 and Scene Materials render.
- VI/EN pointer switching and the Private Beta version label work.
- Deterministic MP4 fixtures are created by the packaged video helper, probed through
  the normal preload/native path, attached as canonical Project assets, and decoded
  in the existing Studio player.
- Manual material selection remains separate from library/source selection.
- Close/relaunch retains the registry, both Projects, schema v5, generated-media
  references and manual MediaAssembly selection while the fixture files still exist.
- Switching between populated Project A and empty Project B does not leak assembly.
- Both processes close cleanly. The native generation job store remains empty.

The fixtures exercise Project/Studio persistence; they do not attest a new Muse
execution, ownership decision or provider acquisition. Local report:
`release/private-beta-smoke-report.json` (ignored).

## Validation

- Private Beta packaging tests: 5 passed.
- MediaAssembly model/schema/generated cases: 30 passed; persistence: 11 passed;
  Assets UI: 12 passed (53 total).
- Project registry: 13 passed; base snapshot and Scene Planner guards passed.
- Generated-media controller: 31 passed; isolated Electron handoff harness: 118 passed.
- Muse execution: 471 passed; manual recovery: 54 passed; audit v1/v2: 169 passed.
- Full commercial regression passed.
- Source release preflight: all 32 checks passed. A Windows CRLF-sensitive media-health
  assertion was normalized in the test only; media-health product code is unchanged.
- Packaging/ASAR validation, syntax, UTF-8, and `git diff --check` passed.

The embedded Cloud backend remains unset; Cloud account/services and optional speech
model downloads require their existing configuration/setup. No production Cloud or
billing readiness is asserted by this private installer test. No live Muse request,
E2E #20, or modification of #17/#18/#19 was performed. MediaAssembly Block 1 and all
Muse execution/receipt/recovery/audit semantics are unchanged.
