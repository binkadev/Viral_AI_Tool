# First-interaction diagnostics - 2026-10-22

Base: `d56f7ef7477037e4c0836cb2df82941d0dfb6c9f`, branch `feature/muse-generation-execution`.

This change records optional evidence about the first trusted interaction that enters the existing MANUAL_INTERFERENCE branch. It does not narrow that branch, change listener lifetime, or change ownership. No live Muse request, E2E #18, retry/reconciliation of E2E #17, installed-extension staging/reload, or remote acquisition was performed.

## Schema

The optional `assistantOwnershipFailure.manualInterferenceDiagnostic` has exactly these nine fields. Before a user-anchored Gate-D failure exists, a failed submit carries the same optional snapshot at `manualInterferenceDiagnostic` on its response/native operation record instead:

| Field | Valid values |
| --- | --- |
| version | `1` |
| eventType | `input`, `click`, `keydown`, `pointerdown` |
| targetCategory | `composer-editor`, `composer-action`, `message-row`, `video`, `conversation-container`, `page-navigation`, `other`, `unknown` |
| observationStage | `pre-send`, `acceptance`, `post-acceptance`, `unknown` |
| snapshotKind | `last-sampled`, `fresh`, `unavailable` |
| duringGenerationActive | boolean or null |
| composerChanged | boolean or null |
| structureChanged | boolean or null |
| ownedUserPresent | boolean or null |

Unknown fields, invalid enums, wrong versions and non-boolean/non-null facts are rejected. The diagnostic is allowed only on a MANUAL_INTERFERENCE failure. The validator permits `fresh` for the schema, but this producer never emits it: structural facts are cached, never resampled at the interaction boundary.

## Capture and provenance

The existing trusted-event predicate and own synchronous insertion exemption remain exact. Capture runs after the original frame/invalidation assignments, without an await. A reference to the preceding assistant-state sample is retained before the terminal frame can initialize/merge state. The first qualifying event consumes the one capture opportunity; later pointer/click/key/input events cannot replace it, including when capture itself fails.

Target classification examines at most 32 composed-path entries, or the target alone if no composed-path method exists. Containment uses the already-known submit editor/action slot and prepared conversation container. Video and message-item path entries use their static element structure. Document/Window path entries are handled without passing non-Nodes to native containment. Throws, malformed/oversized paths and unavailable targets yield `unknown`; connected uncategorized Elements yield `other`. There is no known navigation container in this implementation, so it never guesses `page-navigation`. It does not resolve the current composer after remount solely for diagnostics; a remounted editor may therefore be `other` or `unknown`.

`pre-send` means the existing send-start marker is still null. `acceptance` means invocation has begun without a content-side accepted user receipt. `post-acceptance` means that user receipt exists; it does not independently attest that worker/native durability has already acknowledged it. The pending-first-failure path preserves the snapshot across later durable receipt echo and operation release.

`duringGenerationActive` and `ownedUserPresent` come only from the preceding cached Gate-D state, retaining null when unmeasured. `snapshotKind` is `last-sampled` when that cache exists, otherwise `unavailable`. `composerChanged` and `structureChanged` are always null in this producer because no fresh comparison is made. Existing inherited terminal-frame fields are unchanged; the optional snapshot explicitly labels their cached provenance. Historical failures without a snapshot retain unknown provenance and are not backfilled.

No prompt, text, key/code, selector, DOM identity, coordinates, URLs, candidate capability, observation token or session/authentication information is read into or stored in this snapshot. The target itself is never retained in diagnostic output.

## Persistence and compatibility

Content retains the first snapshot with its bounded failure cache and forwards it through the existing inspect failure response. The worker validates/sanitizes the optional field, preserves its existing core failure in the generation intent, and forwards the optional evidence. It adds no diagnostic write to worker intent storage. For an already-stored first core failure, optional evidence can accompany only the same core failure; a different later failure cannot replace the first.

Native result validation checks the existing core failure independently of the optional snapshot. Malformed optional data is stripped before persistence. Native first-failure persistence writes the core through its original path, then attempts one best-effort augmentation through the same atomic `muse-operation.json` evidence writer. Failed submit responses likewise persist optional pre-send/acceptance snapshots only after the existing invocation evidence write. An augmentation error is swallowed, leaving the core failure/invocation and receipt intact. It adds no await before invalidation or provider click, no background writer that can race a receipt write, no retry and no provider command. Durability is best-effort: once augmentation succeeds the snapshot survives native restart; losing delivery or failing the augmentation may leave the core without optional data.

Historical reads sanitize optional data in memory only. Invalid optional data cannot invalidate an accepted receipt, grant ownership, or cause a backfill/repair. Existing core failure validation remains strict. Existing read-only ownership summaries include the snapshot when valid. The Receipt V2 acceptance and extension functions, frame schemas, Gate C/D rules and receipt data are unchanged.

There is no new execution-audit event, coverage scope, seal, attempt ID, epoch protocol or journal schema. Whole-job audit partial/complete semantics remain unchanged.

## Build identity

Source extension version is `0.3.17`, worker `muse-worker-v0-3-17-contract3-receipt2-manual1-audit1`, content `muse-content-v0-3-17-contract3-receipt2-manual1-audit1`. The managed bundle verifier compares manifest/build identity against the distribution configuration, so changed extension bytes receive a distinct identity. Contract 3, receipt 2, manual recovery 1 and audit 1 remain unchanged. Chrome permissions and dependencies are unchanged. No installed bundle was staged or reloaded.

## Verification

- Focused `tests/muse-interaction-diagnostics.test.js`: 38 passed, zero failed/skipped. Included in `test:muse-execution` for future regression runs.
- Tests cover first-event retention, every event type/category emitted, bounded composed paths including Document/Window, exceptions, privacy getter traps, own-input exemption, malformed optional data, native augmentation failure, native restart and pending failure retention.
- Event tests are synthetic handler/document-listener tests. They do not prove actual browser `isTrusted` semantics. No new browser-automation dependency or live input test was introduced.
- Existing E2E #15-style churn/replacement and historical diagnostic fixtures remain in the full execution/ownership suites.
- Read-only validation loaded all 19 existing stored jobs. The E2E #17 receipt and historical failure validate without an optional diagnostic; job-store and operation-record bytes/hashes remained unchanged. Historical #15/#16 operation records and media were not opened.
- Locked comparison: 15 entire authority/audit/manual/Project/dependency files unchanged; Receipt V2 acceptance/extension functions unchanged; guard predicate and decision assignments unchanged; all disturbed-listener add/remove lines unchanged; prepareV2, inspectV2, post-anchor ownership, responseBlock, ownedVideo/acquireV2 unchanged; worker invoked-intent-to-delivery boundary unchanged.
- Runtime static scan: 140 files, 127 relative imports resolve, 11 external runtime uses declared, zero violations. No customer-facing strings or locale keys added; locale file is unchanged.

Counts below overlap; they must not be added together.

| Regression | Result |
| --- | --- |
| Full `npm.cmd run test:core-commercial` | Passed, zero failures in all constituent suites |
| Muse execution / acceptance replay / ownership / new interaction diagnostics | 471 passed |
| Execution audit v1 | 96 passed |
| Manual recovery / UI | 53 passed |
| Extension readiness / development diagnostics / temporary ASAR verification | 59 passed |
| Browser discovery / bridge | 15 passed |
| Generation runtime / store | 21 passed |
| Foundation / provider settings | 16 passed |
| Generated-media tests | 31 passed |
| Visual harness | 4 passed |
| Project registry | 13 passed, plus project-persistence assertion suite |
| Isolated generated handoff, actual Electron launches/restart | 118 passed |
| Media restore / acquisition manager / Windows paths / editor commercial UX | 4 assertion-suite files passed |
| Changed JavaScript syntax | 12 files passed |
| `git diff --check` | Passed |

The isolated Electron handoff checks ran outside the sandbox because desktop renderer/GPU subprocesses require that permission. They use temporary DEV profiles and never load the installed Muse extension. This is actual desktop handoff/restart validation, not a live Muse or browser-trust validation claim.

PR #56 was checked read-only: open, draft, unmerged, remote head still the base commit. The requested commit is local only; no push or merge is performed.
