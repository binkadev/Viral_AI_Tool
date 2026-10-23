# Nonblocking execution audit validation - 2026-10-22

Base: `3dd8b2b708e42d394d04622c71c61be368ca93bf` on `feature/muse-generation-execution`.

Only extension telemetry scheduling/buffering changes production behavior. Execution never consumes a telemetry result. No live Muse request or E2E #17 was run. No push or merge is part of this change.

## Removed waits and retained authority

- Poll calls `prepareExecutionAuditSafely(c)` without chaining execution to it, then immediately calls the existing `execute(c)`.
- Audit preparation's 500 ms watchdog is detached; neither binding, routing writes, content binding/ACK nor draining gates command execution/result return.
- `executeV2` still writes `saved.invoked = true` and awaits authoritative intent persistence. Its following 250 ms witness watchdog is detached; delivery does not await audit storage.
- `execute(c)` is identical to the base. `executeV2(c)` is identical after removing the single passive witness line from both versions.
- The entire content script is unchanged, including the final fresh guard through `button.click()`, synchronous `returned`/`threw_unknown` observations, Gate C/D, `inspectV2` and `acquireV2`.
- Receipt V2, acceptance replay, intent/tombstone rules, manual recovery, bounded acquisition, GenerationJob/Store, Project/Studio handoff, locale files and dependencies are unchanged.
- Extension version remains `0.3.16`. Worker/content markers remain `muse-worker-v0-3-16-contract3-receipt2-manual1-audit1` / `muse-content-v0-3-16-contract3-receipt2-manual1-audit1`. Contract 3, receipt 2, manual recovery 1, audit 1, all 14 event types, audit wire schemas and Chrome permissions remain unchanged. No identity convention requires a bump for this fix.

## Pre-bind observations and loss

The shared worker/content audit module holds validated telemetry in memory for at most 16 jobs and 32 occurrences per job. It flushes those occurrences only after the initial audit checkpoint persists successfully. This queue has no provider action, retry, resend, execution decision or capability.

Overflow/failed binding damages coverage; dropped observations cannot produce a known zero. A missing source stays partial with null totals. Persisted unclosed epochs retain their existing restart-gap behavior. After content binding acknowledges, background setup reads the existing intent only to damage coverage if invocation has already committed. This conservatively makes late/restarted bindings partial, including empty rebinding after both memory queues were lost. It never alters intent or makes a delivery decision.

The manual DEV fixture returns preparation immediately, so setup can race the committed intent. Its expected coverage is now partial with exact recorded counts and unknown totals. The automatic DEV fixture establishes coverage before invocation and still proves complete coverage. Both retain one physical verified MP4 and one canonical registry attachment.

## Deterministic proof

`tests/execution-audit.test.js` uses deferred audit promises and disables the audit watchdog in send-path isolation tests, so an incorrectly awaited promise cannot escape through a timer. No elapsed-millisecond assertions are used for this proof.

- Poll execution and result return happen before resolving deferred worker bind, route read/write, content bind ACK and drain promises.
- Actual authoritative invoked persistence is observed before delivery; delivery occurs on the next event-loop turn while audit storage remains unresolved. Actual content click and submit success also finish before that promise resolves.
- Worker/content pre-bind observations persist later after binding succeeds. Initial checkpoint storage can remain pending while observations queue.
- Actual worker/content execution completes while binding is delayed, and both witnesses subsequently arrive without resubmission.
- Failed worker/content bind, witness observer/storage and drain do not change submit state, the durable invoked intent or replay rejection.
- Lost pre-bind memory followed by fresh empty rebinding remains partial with null totals.
- Content success remains `returned`; a throwing click remains `threw_unknown`. Existing exact-once, receipt, recovery and acquisition regressions remain in place.

The final targeted search for `await ...audit`, `await ...ExecutionAudit` and audit-preparation `.then(() => execute(...))` found no telemetry wait on an authoritative execution path. Remaining audit awaits occur only inside detached setup/drain, the separate content telemetry handlers, or the native audit-ingestion endpoint.

## Validation results

Counts below overlap and must not be added together.

| Check | Result |
| --- | --- |
| `node dev/run-execution-audit.js` focused suite | 96 passed, zero failed/skipped |
| Same command's native automatic and user-confirmed scenarios | 2/2 passed; automatic complete, user-confirmed partial with truthful unknown totals |
| `npm.cmd run test:core-commercial` | Passed, including all constituent suites below |
| Muse execution / acceptance replay / ownership diagnostics | 433 passed |
| Manual recovery / UI | 53 passed |
| Extension readiness / development diagnostics / temporary ASAR verification | 59 passed |
| Browser discovery / bridge | 15 passed |
| Generation runtime / store | 21 passed |
| Muse foundation / provider settings | 16 passed |
| Generated media | 31 passed |
| Generation visual harness | 4 passed |
| Project registry | 13 passed |
| `node --test tests/generated-handoff-harness.test.js` | 118 passed, including actual isolated Electron launches and second-process restart |
| Acquisition manager / Windows acquisition paths / editor commercial UX | 3 files passed |
| Changed JavaScript syntax | 5 files passed |
| Runtime static dependency scan | 140 files; 127 relative imports resolve; 11 external uses declared; zero violations |
| Locked comparison to base | 15 entire files unchanged; worker authority functions unchanged as described above |
| `git diff --check` | Passed |

The initial sandboxed handoff attempt could not launch GPU/renderer child processes. The unchanged regression passed outside the sandbox with its existing isolated temporary DEV profiles. This is an actual desktop handoff/restart check, not a live Muse or audit-enabled desktop generation E2E.

No customer-facing strings or renderer i18n keys were added. The locale file is identical to the base. An additional full-dictionary comparison found six existing English omissions under `speech`: `cloudAuthRequired`, `cloudQuotaExceeded`, `cloudPlanRequired`, `cloudSubscriptionInactive`, `cloudConcurrencyLimit`, and `cloudUnavailable`. These unrelated baseline omissions remain outside this narrow fix.

PR #56 was checked read-only and remains open, draft and unmerged. Changes are committed locally on the same branch, without pushing.
