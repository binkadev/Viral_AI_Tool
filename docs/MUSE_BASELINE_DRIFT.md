# Baseline drift evidence — extension 0.3.12

Executing builds:

- `muse-worker-v0-3-12-contract3-receipt2-baselinediag1`
- `muse-content-v0-3-12-contract3-receipt2-baselinediag1`

Protocol 1, execution contract 3, Receipt V2 (2), acceptance, ownership,
pending-role settling, stabilization, acquisition and exact-once rules are
unchanged. This is diagnostic instrumentation, not a baseline recovery repair.
The existing nine-file bundle contains it; no new extension entrypoint is added.

## Audited comparison and missing evidence

`submit()` returns a user-only accepted receipt. Worker storage and native
persist it before normal inspect echoes that same operation/scene/user anchor.
Observer/inspect `sample()` calls `structure()` then `responseBlock()` →
`afterBaseline()`. The exact baseline-prefix guard remains:

```js
rows.length < op.baseline.length ||
op.baseline.some((r, i) => r.id !== rows[i].id || r.role !== rows[i].role)
```

It compares the entire ordered recognized prefix by raw native ID and role
inside the extension. It does not compare DOM-node identity or parent/container
at this guard. Separate response-block checks still enforce the prepared
container and owned-user/assistant sequence. Existing mutation guards may also
invalidate earlier, for example on an observed native-ID attribute change.

On prefix mismatch, `BASELINE_CHANGED` remains terminal, with the original
Gate-D phase/reason and interruption behavior. The previous failure frame and
user-churn event show that the user survived and its old index shifted, but do
not identify the baseline difference. E2E #11's later valid response block/video
cannot establish that the earlier drift was safe, or provide retrospective
assistant ownership. Its three original facts stay untouched: interrupted /
RECOVERY_REQUIRED, assistant failure BASELINE_CHANGED, user churn BASELINE_CHANGED.
No baseline-drift evidence is backfilled into it.

## Separate first observation

After local user acceptance, diagnostic-only references snapshot the original
baseline nodes, their existing native IDs/roles/parents and the prepared
container. The original user diagnostic anchor supplies the exact accepted node,
parent and direct sequence index. The existing observer samples baseline drift
before its existing guards can throw. No additional observer or scheduler exists.
Already-invalid/released operations are not sampled, including continuations of
an asynchronous hash after an earlier terminal failure.

Only the first observed divergence is retained as top-level `baselineDrift`
(version 1). Support JSON presents it as `historicalBaselineDrift`, separately
from `historicalAssistantOwnershipFailure`, `historicalUserAnchorChurn` and the
current DOM census. A snapshot may be pending before durable acknowledgement;
it can enter worker/main history only when normal inspect echoes the accepted
operation, scene and user receipt. Read-only diagnosis never promotes or writes it.

Known baseline nodes may be correlated by their existing baseline native ID if
remounted, solely to explain the baseline comparison. Identical role/ID remounts
in the same parent/container do not produce drift. This correlation never
resolves/replaces an owned user or assistant and never hashes a replacement.

Deterministic classification priority:

1. `UNKNOWN_BOUNDED`: scan overflow or unavailable original user index.
2. `IDENTITY_UNAVAILABLE`: invalid/duplicate native identity in the baseline
   prefix or an identifiable baseline row. Pending assistant IDs after the owned
   user are excluded from this baseline-only check.
3. `MULTIPLE_BASELINE_DIFFERENCES`: multiple independent row removals/additions,
   ID/role changes, parent/container changes or a relative baseline reorder.
   Correlated index shifts do not turn one removal into multiple differences;
   a relative reorder counts as one category even when several rows move.
4. For a single difference: `BASELINE_CONTAINER_CHANGED`,
   `BASELINE_PARENT_CHANGED`, `BASELINE_ROLE_CHANGED`, `BASELINE_ID_CHANGED`,
   `BASELINE_ROW_REMOVED`, `BASELINE_ROW_ADDED`, `BASELINE_REORDERED`.
5. `OWNED_USER_INDEX_SHIFT`: only the measurable direct user index shifts.
6. `PREFIX_LENGTH_CHANGED`: the ordered matching prefix fails without a more
   specific observed row cause or measurable user index shift.

Parent means the baseline node's original direct parent; container means leaving
the original prepared container. A container departure is not counted a second
time as a parent change. A missing baseline row means neither the original row
nor a current row with its existing baseline ID resolves in the bounded sample.
An added row is a recognized row before the owned user outside that baseline set.

These are observations, not new terminal conditions. For example, a direct
unrecognized shell before the user can change its index without changing the
recognized prefix. If 0.3.11 would continue running, 0.3.12 continues running too.
The event remains memory-only unless an existing execution guard later returns
interrupted. No diagnostic field participates in acceptance/ownership decisions.

## Payload bounds and coordinates

All fields are required; unavailable structural facts are null. All 15 counts
and indices cap at 257 (the existing bounded overflow sentinel):

- `baselineLength`: number of original recognized baseline rows.
- `currentRecognizedPrefixLength`: longest current role/ID prefix matching that
  original baseline. This is not proof that later rows are owned.
- `currentRowsBeforeOwnedUser`: recognized rows before the exact original owned
  node, or null when it is not present among recognized rows.
- `ownedUserOriginalIndex`, `ownedUserCurrentIndex`: indices among direct
  `[data-message-item]` children of the accepted user's original parent; null
  for an unavailable current index. This differs from the global recognized
  coordinate above and reveals unrecognized direct shells.
- `baselineRowsStillConnectedCount`, `baselineRowsStillInContainerCount`,
  `baselineRowsSameParentCount`: original baseline node-reference facts.
- `baselineRowsIdentityUnchangedCount`, `baselineRowsRoleUnchangedCount`:
  current diagnostically resolved baseline rows matching original ID/role.
- `removedBaselineRowCount`, `addedRowsBeforeOwnedUserCount`,
  `changedBaselineIdCount`, `changedBaselineRoleCount`, `movedBaselineRowCount`.
  Moves count changed recognized indices; the reorder category separately tests
  relative order of surviving baseline rows, excluding mere shifts from removal.

Three nullable booleans: `baselineLengthChanged` compares recognized rows before
the user to original baseline length; `ownedUserIndexChanged` compares direct
indices; `generationActive` is the current generation-control observation.

`firstMismatchIndexBucket` is null or `zero`, `one_to_four`, `five_to_sixteen`,
`seventeen_or_more`. `firstMismatchKind` describes the first mismatching prefix
slot or, when that prefix still matches, the first parent/container/additional-row/index
discrepancy. It may differ from aggregate `kind` for compound changes.

`elapsedBucket`: `under_1s`, `1_to_10s`, `10_to_60s`, `over_60s` since accepted
anchor snapshot. `mutationCountBucket`: `zero`, `one_to_four`, `five_or_more`.
The snapshot compares current structure; the mutation bucket does not reconstruct
unobserved intermediate DOM states or their ordering.

At most 257 message nodes are sampled; 257 or more, or more than 256 mutation
records, yields UNKNOWN_BOUNDED with null structural fields. Diagnostic exceptions
are contained and cannot invalidate, wait, resubmit or rewrite ownership.

## Persistence, privacy and regression scope

The existing released diagnostic FIFO remains capped at 32 entries. It retains
safe payloads plus existing hashed correlation keys, never new DOM references.
Worker and native preserve the first event independently of the other two
diagnostics. Normal running/result responses cannot carry persisted drift.
Only user-anchored, assistant-unanchored interrupted normal inspect may carry it;
all other commands and execution/receipt inputs reject it. All newly returned
first diagnostics share one native exclusive-temp, fsync/atomic-rename update.
Write failure preserves previous record bytes and cleans the temporary file.

Support validation rejects partial/private fields. No raw IDs, text, prompt,
HTML, URL, tokens or account data cross this schema. Raw ID/node references stay
inside the extension. Older 0.3.8–0.3.11 diagnostic records remain readable and
report null baseline drift without migration or any persisted change.

Fixtures cover all categories, unchanged/remounted baselines, passive index/
parent evidence, first-only persistence/restart, privacy/write failures/cache
rotation, unchanged user churn/settling/stabilization, and rejection of ownership
promotion despite a later valid response block/video. Real historical E2E
#1–#11 bytes are checked independently and remain read-only. No real Muse request,
historical reconciliation/acquisition, staging or browser interaction is part of
this change. A future E2E needs separate authorization after manual staging and
successful read-only runtime preflight of the complete 0.3.12 bundle.
