# Private Beta RC shell and updater foundation

This is a local-only beta.2 seed and beta.3 test update. **The complete automatic
install/restart acceptance is blocked, not passed.** Windows Application Control
currently refuses to launch the installed unsigned executable. No Windows security
policy, checksum verification or signing policy was weakened.

## Source and scope

- Base local HEAD: `913f70064d8935fa53b477c54dbd73ad9c0e6386`.
- Expected remote branch: `feature/muse-generation-execution`,
  `46dbcc16dace401fa919a35605846b75c8bf4a73`.
- The containing local commit is `feat(release): add private beta update foundation`.
  Obtain its SHA with `git log -1 --format=%H`.
- No push, PR #56 update, merge, GitHub Release creation or artifact upload.
- Source/lockfile remain `0.14.1-beta.2`, the first updater-capable seed.
  beta.3 is a separate local test package. Comparing both complete ASARs, including
  unpacked files, found only `package.json` changed (the version).
- `release-info.json` uses `source: private-beta`, `channel: beta`, and
  `commit: null`. Source provenance remains unset until build automation stamps
  the actual build HEAD. No amended SHA is hard-coded into tracked metadata.

Changed source/configuration: `main.js`, `startup-main.js`, `preload.js`,
`package.json`, `package-lock.json`, `release-info.json`, `CHANGELOG.md`;
`services/update/private-beta-updater.js`, `private-beta-ipc.js`;
`renderer/core-private-beta-model.js`, `core-private-beta.js`, `core-private-beta.css`,
`i18n.js`, `index.html`; packaging/preflight scripts; Beta tests;
`dev/run-private-beta-update.js`, the existing DEV handoff navigation assertion,
and this report. Installers, screenshots, test profiles and logs are not committed.

## Product shell

Before: Home, Create with AI, Generation progress, Import, global legacy Studio,
Library, social accounts, usage, billing, Settings.

Private Beta primary navigation now has two groups:

- Create video: Home, Create with AI, Generation progress.
- Manage: Library, Settings.

Import remains available from Home, Create with AI and the existing contextual
import action. Studio uses the existing editor and requires an actual Project
source/media context. There is no second Studio. Hidden social routes fall back
to Home; usage/billing fall back to Settings; empty Studio and stale direct Import
fall back to Home. Legacy implementations are retained. The command palette reads
the filtered navigation. The unused sidebar Cloud placeholders are hidden.

Brand/titlebar show Viral AI Tool, localized Private Beta, and the app version.
New copy lives in `renderer/i18n.js` for VI and EN. The Premium Dark direction is
retained. New controls wrap, have minimum target sizes and focus styles; progress
has a translated accessible label. Progress updates retain focus within Updates.

## Updater authority and behavior

`electron-updater` is pinned to **6.6.2**, matching the electron-builder **26.0.12**
source tag. It was absent before this change. No unrelated runtime dependency was
added. The lockfile records its runtime dependency graph.

Production builder/provider configuration:

```json
{
  "provider": "github",
  "owner": "binkadev",
  "repo": "Viral_AI_Tool",
  "channel": "beta",
  "releaseType": "prerelease"
}
```

The main service separately selects the same owner/repo and explicit `beta`
channel. It sets `allowPrerelease=true`, `allowDowngrade=false`,
`autoDownload=false`, `autoInstallOnAppQuit=false`, and disables web installers.
It rejects alpha, stable, malformed, equal and older candidates before enabling
download. Release Info and Updates both use `beta`, labelled "Beta nội bộ" in VI
and "Private Beta" in EN. The old manifest/release-page URLs stay null.

Startup chooses exactly one authority: when PrivateBetaUpdater exists, only its
startup check runs; otherwise the legacy background checker runs. The legacy
checker additionally rejects `source: private-beta` even if a manifest URL or a
legacy channel is accidentally configured. All four legacy update IPC actions
(check, download, cancel, launch) return `UPDATE_NOT_CONFIGURED` for Private Beta,
before touching downloads, cached installers or native work. Non-Beta legacy
preview/stable behavior, including its signature/checksum checks, is retained.

Only a packaged beta initializes a release provider. One startup check runs after
the window has loaded and a 12-second delay; manual checks remain available.
Automatic checking defaults on and is persisted atomically in
`userData/update-preferences.json`, outside Project. No hourly polling.

State: idle, checking, available, not-available, downloading, downloaded,
installing, error. IPC returns only bounded version/channel, percent, plain
release name/notes, last-check time, preference and safe error codes. Notes are
bounded to 4,000 characters and escaped when rendered. No installer path, auth
header, token, raw exception or stack is returned by these updater IPC methods.

Six bounded request methods and one state event use the preload bridge. Main
requires the current BrowserWindow's exact local main frame and rejects extra
arguments/nonboolean preferences. Renderer does not contact the provider,
download or execute an installer. Electron isolation and sandbox flags remain on.

Settings offer check, explicit download, cancel download, progress, release notes,
Install & Restart and Later. A nonmodal notification offers View update / Later;
each version is announced at most once per session. Ordinary quit never installs.
Native cancellation is used; a cancelled download returns to idle for a fresh
check. Disk/network/verification errors preserve Project and expose retry copy.

Install reuses main's actual generation/render/speech/translation/voice/model
download/media-acquisition count. It then runs a fixed local renderer save barrier,
rejecting active Project workflows, unsupported storage and failed flushes. Main
checks work again after the barrier. Passive imported rows labelled `queued` are
not active render jobs; a packaged test caught and corrected that distinction.
Only explicit consent calls `quitAndInstall(true, true)`.

v26 references: [updater package](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/electron-updater/package.json),
[publish schema](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/builder-util-runtime/src/publishOptions.ts),
[updater implementation](https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/electron-updater/src/AppUpdater.ts).

## Test feed and profile isolation

`VIRAL_AI_UPDATE_TEST_URL` is read only in main. A packaged test may use a generic
provider with literal `http://127.0.0.1` or `http://localhost`. Remote URLs, HTTPS,
credentials, query strings, fragments, IPv6 and ambiguous numeric host forms are
rejected. An invalid configured test URL fails closed; it does not silently fall
back to the Internet. Unset has no effect. No override is stored in Project or
returned to renderer.

Packaged restart verification also supports a main-only
`VIRAL_AI_UPDATE_TEST_PROFILE` under the real OS temp directory, restricted to
`viral-private-beta-update-*/profile` after realpath validation. It requires the
valid loopback feed. Optional `VIRAL_AI_UPDATE_TEST_DEBUG_PORT` is bounded and
applies only after that profile validation. These are not renderer preferences.

NSIS uses Explorer when reopening its existing Start Menu shortcut; that launch
does not reliably retain the testing environment. The updated DEV harness can
temporarily give that exact launcher explicit temp-profile/debug arguments,
restore its original bytes in `finally`, and keep an on-disk original backup for
interrupted-run recovery. It validates the launcher's existing executable target.
**This new launcher-assisted restart branch was not reached after Application
Control began blocking the executable; its end-to-end result remains unverified.**
No launcher was modified by that branch in the recorded final attempts.

## Historical artifacts (unsigned, Windows x64 NSIS)

These are the pre-review builds recorded during the original foundation work.
They were not rebuilt or reinstalled for the narrow authority/channel/provenance
fix. Their recorded hashes remain historical evidence; their older embedded
metadata does not represent the amended source. Rebuild before any distribution
or renewed packaged acceptance. The amended tracked metadata is beta/null.

| Item | Seed | Test update |
| --- | --- | --- |
| Version | 0.14.1-beta.2 | 0.14.1-beta.3 |
| Installer | `release/beta2/Viral AI Tool-0.14.1-beta.2-x64.exe` | `release/beta3/Viral AI Tool-0.14.1-beta.3-x64.exe` |
| Bytes | 117269465 | 117269615 |
| SHA-256 | `220f48cba6b8e66f479d979500a9fe8993c6b15eb394a4467ab1d523fb5b9bc0` | `623497f36dbb7eda18e3b7a3d2fd2fee298112cfb4cb322a6b73664f13d5af75` |
| Generated metadata | `release/beta2/beta.yml` | `release/beta3/beta.yml` |
| Generated blockmap | installer path + `.blockmap` | installer path + `.blockmap` |

Seed provider metadata is `release/beta2/app-update.yml`; update provider metadata
is `release/beta3/win-unpacked/resources/app-update.yml`. Both select GitHub/beta.
Each installer size and SHA-512 was independently compared against its own
build-generated YAML. No checksum or update YAML was invented or weakened.
The local server maps the generated download filename to the exact installer.

No publisher certificate is configured or verification faked. Unsigned Beta is
for family testing, subject to the device's own security policy; it is not the
commercial signing posture. This machine's Application Control block is evidence
that an unsigned build cannot be assumed runnable on every test device.

## Actual desktop results and limitations

1. **beta.1 → beta.2 manual upgrade passed.** The installed beta.1 was used with
   a fresh temporary profile; beta.2 was installed by explicitly invoking NSIS.
   beta.1 was never claimed to auto-update.
2. The fixture has exactly two Projects, two Scenes in A, three fixture video
   assets, candidate references and manual selected assets for both slots.
   Project B has no source/assets/assembly. Native media probe/decode passed.
3. After the manual seed installation and process reopen, exact Project/schema,
   scene IDs, assets, candidate IDs, selected IDs, selectionSource and source refs
   matched. There were no duplicate Projects/assets or A/B leakage. Original
   fixture MP4 hashes matched. Native GenerationService contained zero jobs.
4. **beta.2 update check, notification, Later/deduplication, explicit download,
   native progress, checksum verification and downloaded state passed packaged.**
5. Packaged failure tests passed for refused loopback connection, metadata 404,
   HTTP 503 download, a deliberately corrupt installer rejected by normal
   SHA-512 verification, and an install veto for synthetic active Project work.
   Main active-work/race veto, duplicate checks, cancellation, no-newer version,
   preference errors and safe error normalization also pass focused unit tests.
6. **Explicit Install & Restart invoked the real NSIS updater and installed
   beta.3:** native updater logged its installer invocation and Windows uninstall
   metadata changed to beta.3. **Relaunched beta.3 was not verified.** No debug
   endpoint appeared; a subsequent direct Windows launch reported:
   `An Application Control policy has blocked this file.` No bypass was attempted.
7. Therefore **beta.2 → beta.3 complete automatic E2E and post-update Project /
   MediaAssembly retention are NOT passed**. Manual seed retention is passed;
   it does not substitute for this missing acceptance step. The final installed
   version is beta.2 after preparing a rerun, which the same host policy blocked.
8. Packaged beta.2 desktop screenshots cover Home, Settings and Updates in VI/EN.
   Five nav destinations were clickable; no permanent black/white screen,
   duplicate main window or observed panel overlap. Contextual Import and Studio
   handoff plus media playback passed. The final source also passes actual
   `npm start`, 40% update-copy expansion and keyboard focus-visible checks in a
   separate temporary dev profile; the dev updater remains disabled. These last
   checks are explicitly not a packaged restart result.
9. Real-profile comparison recorded 35 files: 31 unchanged, four LevelDB files
   changed (`000332.log`, `LOG`, `LOG.old`, `MANIFEST-000001`). Do not claim the
   whole real profile remained byte-identical, or infer logical Project equality
   from file hashes. All recorded historical generation/job/audit/operation JSON
   hashes were unchanged. No fixture was intentionally written into that profile.

The release must remain **not accepted for family distribution** until the
complete updater/restart and retention test passes on an authorized test device
where the executable is permitted to run. Resolving host policy is an operator
task, not an instruction to weaken it or modify this code's verification.

## Validation

- Beta tests: 43 passed (20 updater/main authorization tests, four shell/locale
  tests, 19 packaging/startup/legacy authority/channel/provenance tests).
- Audit v1/v2: 169 passed; combined focused run: 212 passed.
- Original foundation Electron generated-media handoff: 118 passed. Its ordinary Studio
  navigation assertion now follows the existing contextual entry for Beta.
- Full commercial regression passed: 737 TAP assertions across ten TAP groups,
  plus the existing assertion-based legacy suites (38 npm invocations including
  the parent command).
- Within that run: MediaAssembly 53; Project registry 13; generated media 31;
  Muse execution 471; manual recovery 54. Scene Planner/model/persistence and the
  player/workflow/editor/source recovery suites passed.
- Release preflight: all 33 checks passed.
- Original pre-review ASARs: 128 relative runtime imports resolved; all renderer assets and
  unpacked native helpers present. Real packaged updater operations proved its
  external dependency graph loads. Packaged Muse extension byte checks passed.
- Modified runtime JS syntax and strict UTF-8 decoding passed; `git diff --check`
  passed. Artifacts remain ignored. Both unrelated patch files are preserved.

The narrow review fix reruns Beta, readiness/preflight, commercial (including
MediaAssembly, Project persistence/registry, Muse execution and manual recovery),
and audit v1/v2 tests. It does not install or launch another packaged executable,
rebuild the historical installers, or change Windows Application Control.

## Reproduction after the host block is resolved

Install the test-only browser driver into ignored artifacts (not production):

```powershell
npm.cmd install --prefix release/verification-tools --no-save --no-package-lock --ignore-scripts playwright-core@1.64.0
```

`node dev/run-private-beta-update.js prepare` requires installed beta.1 and creates
the isolated fixture. `seed` manually installs beta.2; `seed --inspect-seed` only
inspects an already installed beta.2. `update` serves the real generated beta.3
metadata/installer on an ephemeral loopback port, tests failures and performs the
explicit install/restart. It intentionally changes the installed app version.
The operator should first ensure no actual user session/work is running.

`release/private-beta-update-session.json` records the temp root/fixture and
truthful partial result. Build logs, screenshots, ASAR comparison, artifact hashes,
profile hash comparison and source smoke report are also under ignored `release/`.
The updated restart harness keeps a shortcut backup/config in its temp root if
an external termination prevents `finally` restoration.

## Future GitHub release rules

- Beta releases must be **published prereleases**, not Draft. Drafts are invisible
  to the updater. Use the explicit beta channel; do not distribute alpha through it.
- Upload the installer, blockmap and builder-generated update metadata from the
  **same build**. Never fabricate hashes/YAML or mix artifacts between builds.
- Keep normal checksum validation. Do not embed a GitHub token or auth headers.
- Keep `--publish never` during local builds. This work created no real release
  and uploaded nothing. beta.1 first requires the manual beta.2 seed installation.

MediaAssembly Block 1 and Project v5 authority/selection semantics are unchanged.
One Project / Editor / Playback Clock / Job System remain. Muse extension 0.3.18,
executionContract 3, receiptVersion 2, manualRecoveryVersion 1,
executionAuditVersion 2 and 14 audit events are unchanged, along with Gate C/D,
Receipt V2, exact-once, ownership/acquisition and recovery. No live Muse request,
E2E #20, modification of historical #17/#18/#19, PR #56 update/merge, or push.
