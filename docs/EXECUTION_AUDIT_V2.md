# Execution audit v2: submission coverage

Prospective jobs carry `{version: 2, auditId}`. Extension 0.3.18 advertises
audit 2, execution contract 3, receipt 2 and manual recovery 1. Permissions,
event vocabulary, provider authority and Project/Studio schemas do not change.

## Journal and wire schemas

The v1 journal envelope, event and stream schemas are retained. A v2 journal
adds exactly one field:

```js
submission: {
  reasons: [], // bounded, sticky enum; never arbitrary text
  seals: []    // at most three, one per native/worker/content source
}
```

Each seal has exactly:

```js
{
  scope: 'submission',
  source: 'native' | 'worker' | 'content',
  sourceEpoch: '<UUID>',
  watermark: 0, // source sequence cursor at producer completion
  sealed: true,
  gap: false
}
```

V2 extension packets retain the existing packet fields, set `version: 2`, and
add mandatory `submissionSeal: null | seal`. The containing packet binds its
jobId, auditId, source and epoch. Bind metadata is `{version: 2, jobId, auditId}`.
Storage/route keys use `execution-audit-v2:`. V1 packets cannot supply seals.
Unknown scopes, extra keys, mismatched identities and invalid cursors fail
validation. No attempt identifier, checkpoint event or new event type exists.

The native seal is checkpointed in the journal. Extension seals and their
witnesses share the existing serialized telemetry persistence queue. Drain
cannot deliver a seal before that queue checkpoints it. Pre-bind witnesses are
materialized before a pending seal; any known loss remains sticky. A queued
storage operation that has not resolved cannot establish completeness.

## Producer boundaries

* Native observes settlement of the initial automatic submit command, after
  invocation/acceptance evidence persistence has run or failed. Its observer
  schedules seal persistence with `setImmediate`; no execution continuation
  awaits it. A failed/unknown acceptance can therefore have exact count zero.
* Worker observes settlement of its serialized v2 submit task, after the
  existing intent decision, witness and content/result lifecycle. It schedules
  the seal without awaiting it or changing `v2Tail` authority.
* Content observes settlement of the submit handler, after any invocation
  outcome witness. It enqueues the seal in the existing handler cleanup and
  returns the result without awaiting telemetry. The final fresh validation
  through `button.click()` is unchanged and contains no telemetry awaits.

No seal or coverage result is read by provider execution. Receipt V2, worker
intent, ownership, manual confirmation, verification and Project persistence
remain authoritative. Hung/rejected seals lose coverage, never execution.

## Completeness and loss

Only submit.requested, submit.committed, submit.invocation_observed and
submit.acceptance_proven belong to submission. All three required producers
must supply consistent, gap-free checkpoints and a contiguous captured prefix
through each seal watermark. Renderer is irrelevant. Later non-submission
events may advance a stream past its immutable sealed prefix; their sequence
numbers do not move the seal watermark.

Identical event/seal replay is idempotent. Conflicting seal delivery, conflicting
occurrence identity, or a new scoped occurrence after its source seal damages
scoped coverage; exact scoped totals become null. Such evidence never causes a
retry, cancellation, ownership promotion or acquisition.

Pre-bind overflow/loss, sequence gaps, capacity exhaustion, failed checkpoint
writes and unresolved prior epochs prevent certification. Reasons are bounded
to the existing six audit reasons plus `seal_conflict` and `late_occurrence`.
The report also supplies `missing_seal` when a required checkpoint is absent.
No timeout or empty queue infers a seal. Restart cannot synthesize a missing
producer checkpoint. Already durable complete submission proof survives a
native restart; the unclosed whole-job lifecycle remains partial. Extension
restart drainage retains existing conservative gap handling.

Later ownership, acquisition, manual session/reveal/confirmation, publication,
attachment and terminal events leave submission counts unchanged. Interrupted
is not terminal and does not close streams. Whole-job coverage continues to
require its existing terminal and stream-closure evidence.

Limits remain 256 events, 16 journal streams, 128 KiB journal bytes, 32 witness
records, 16 active producer bindings and 24 KiB packets. Pending finish requests
are also capped at 16. No limit increase or unbounded checkpoint history exists.

## Reporting and historical records

`report.scopes.submission` contains state, reasons, four `{recorded,total}`
counters, returned/threw_unknown dimension counters and the bounded seals.
Only state `complete` exposes integer totals, including zero. Other states
expose null totals. Whole-job counter semantics are unchanged: they can remain
unknown while submission counters are exact. Completeness does not mean success.

V1 journals remain strictly readable but all journal mutation methods refuse
them. They are never upgraded, backfilled or assigned inferred seals. Their
submission report is `not_recorded`, including completed historical jobs.
E2E #17 and #18 remain v1 evidence; neither gains v2 scoped completeness.

## Deterministic validation

`npm run test:execution-audit` runs legacy behavior and focused v2 tests.
`npm run dev:execution-audit-v2` exercises isolated real native/worker/content
boundaries for automatic completion and a Gate-D interruption after acceptance,
with `liveMuseRequests: 0`. The harness uses temporary app data and a locally
generated video. It is rejected in production/Electron and excluded from ASAR.
