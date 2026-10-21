# Manual recovery v1 validation — 2026-10-22

Base: `5cb69116b3fcbb2446057e100e46a90926705b6d`, branch `feature/muse-generation-execution`.

Implemented prospective admission only, one retained live context and candidate session, a two-minute expiry, at most eight eligible mounted blob videos, exact-tab numbered reveal before confirmation, durable confirmation before bounded transfer, native verification, truthful provider-neutral provenance, existing completed-output handoff, cancellation and local-only restart finalization.

## Results

Counts below are per run and overlap; they must not be added as unique tests.

| Validation | Result |
| --- | --- |
| All 55 relevant regression files, sequential Node runner | 802 passed, 0 failed |
| Final recovery/UI/GenerationService/generated-media focus | 105 passed, 0 failed |
| Existing Muse execution/replay/ownership/readiness/development diagnostics | 492 passed, 0 failed |
| Existing handoff suite, including real Electron desktop cases | 118 passed, 0 failed |
| VI/EN recovery interface including cancellation during acquisition | 5 passed, 0 failed |
| Original `test:core-commercial` command | Passed; its constituent files also passed in the final 55-file run |
| DEV native matrix | 7/7 passed: completion, remount, expiry, source mutation, persistence failure, invalid MP4, more than eight candidates |
| Actual Electron Project/Studio + second-process restart | Passed: same verified output, original project/scene, one asset/source/reference, no physical output duplicate |
| `npm start`, isolated DEV profile | Exit 0; 24 first-pass checks passed, including native decode and visible ordinary Studio preview |
| Syntax and local runtime imports/dependencies | 36 JavaScript files; 155 local imports resolved; 6 runtime package uses declared; no violations |
| `git diff --check` | Passed |

An additional existing `core-media-health.test.js` assertion fails on CRLF because it searches for a literal LF-only source fragment. Both the test and `renderer/core-media-health.js` are unchanged from the base commit. This unrelated extra test is recorded separately and was not modified. A 200 ms readiness transport test timed out under the initial concurrent run; standalone and subsequent sequential full runs passed.

## Locked surfaces

Direct comparison with the base commit confirmed identical `receipt-v2.js`, `acceptance-replay.js`, the automatic `execution-contract.js`, `generation-job.js`, `core-generated-media.js`, `core-project-persistence.js`, `core-project-scene-plan.js`, and `core-media-restore.js`.

The content functions `postAnchorConversationWindow`, `responseBlock`, `submit`, `inspectV2`, and `ownedVideo` also compare identically. Gate C/D, baseline prefix pruning, automatic replacement rejection, exact-once send, durable automatic send intent/tombstones and automatic acquisition authorization retain their original rules. The browser chunk reader and native acquisition body were extracted into shared plumbing; the automatic resolver still performs its original receipt/owned-node checks and returns its original result shape. Automatic acquisition regression cases passed, including legacy rejection, bounds, cancellation, source changes, checksum errors, replay and exclusive publication.

No historical marker migration, historical operation-directory scan, receipt reinterpretation, E2E #15 recovery, live Muse request or E2E #16 run occurred. The historical-ID tests use newly created isolated temporary fixtures. No Chrome permission was added. Project/media schema, output attachment, Studio and playback ownership are unchanged. PR #56 was read only and remained open, draft and unmerged.

The single repeatable DEV command is `node dev/run-manual-recovery.js`. Its extension/browser DOM and worker are virtual; native MP4 verification and the desktop Project/Studio path are real. This establishes deterministic behavior, not live-provider acceptance.

## Changed files

The complete file list is recorded below.

- `dev/generated-handoff-harness.js`
- `dev/generated-handoff-renderer.js`
- `dev/manual-recovery-desktop.js`
- `dev/manual-recovery-fixture.js`
- `dev/run-generated-handoff.js`
- `dev/run-manual-recovery.js`
- `dev/validate-manual-recovery.js`
- `docs/MANUAL_RECOVERY.md`
- `docs/MANUAL_RECOVERY_VALIDATION.md`
- `extensions/meta-muse-bridge/content-manual-recovery.js`
- `extensions/meta-muse-bridge/content-script.js`
- `extensions/meta-muse-bridge/manifest.json`
- `extensions/meta-muse-bridge/manual-recovery-contract.js`
- `extensions/meta-muse-bridge/manual-recovery.js`
- `extensions/meta-muse-bridge/service-worker.js`
- `extensions/meta-muse-bridge/worker-manual-recovery.js`
- `main.js`
- `package.json`
- `preload.js`
- `renderer/core-generation-progress.css`
- `renderer/core-generation-progress.js`
- `renderer/i18n.js`
- `scripts/verify-muse-package.js`
- `services/generation/bridge/extension-bundle.js`
- `services/generation/bridge/extension-distribution.js`
- `services/generation/bridge/extension-distribution.json`
- `services/generation/bridge/meta-muse-extension-bridge.js`
- `services/generation/generation-ipc.js`
- `services/generation/generation-service.js`
- `services/generation/generation-store.js`
- `services/generation/output-resolution.js`
- `services/generation/providers/bounded-acquisition.js`
- `services/generation/providers/muse-execution.js`
- `services/generation/providers/muse-manual-recovery.js`
- `services/generation/providers/muse-provider.js`
- `startup-main.js`
- `tests/core-generated-media.test.js`
- `tests/muse-development-diagnostics.test.js`
- `tests/muse-extension-readiness.test.js`
- `tests/muse-generation-execution.test.js`
- `tests/muse-manual-recovery-ui.test.js`
- `tests/muse-manual-recovery.test.js`
