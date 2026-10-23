# Verified baseline prefix pruning — extension 0.3.13

Executing builds:

- `muse-worker-v0-3-13-contract3-receipt2-baselinewindow1`
- `muse-content-v0-3-13-contract3-receipt2-baselinewindow1`

Protocol 1, execution contract 3 and Receipt V2 (2) remain unchanged. The complete
nine-file bundle must match these markers at staging and read-only preflight.
No real Muse execution, historical recovery/acquisition or browser interaction
is part of this implementation task.

## Audited call sites

`afterBaseline()` still requires every original recognized role/native-ID pair
at its original global prefix position and slices fresh rows at the immutable
original baseline length. The function itself is unchanged.

Strict callers remain:

- `submit()` before typing/invocation, its V2 Gate-C acceptance loop and the
  post-hash acceptance recheck, and legacy acceptance.
- Legacy `inspect()`.
- The preparation/acceptance observer before a user receipt exists.
- V2 response-block observation before worker/native durable receipt echo.
- `acceptanceProjection()` and acceptance failure/replay diagnostics retain
  their independent full-prefix comparisons and original coordinates.

Only V2 `responseBlock()` uses `postAnchorConversationWindow()`. The observer's
post-anchor block check, normal inspect and precommit recheck all share that
same validator. `inspectV2()` sets acknowledgement only after the existing
operation/scene/token/receipt/contact/lifetime checks pass with the accepted
receipt echoed from worker/native. Local acceptance alone cannot enable pruning.

The original prepared baseline, native IDs, original node/parent references and
receipt baseline hashes are never shortened, rewritten or rebased. Acceptance
records the exact owned user node independently of diagnostic-only references.
No diagnostic field is used as ownership authority.

## Narrow post-anchor predicate

First resolve exactly one recognized user by the original `submittedUserId`.
It must be the exact accepted DOM node and `userTurn.node`, remain connected,
retain its user role/native ID, stay inside the prepared container and keep its
original parent. Receipt, manual-interference, contact and operation-life guards
remain enforced. An owned-node replacement, including one reusing the same ID,
fails closed.

For an intact baseline, the strict full-prefix check still runs. Migration of
an original baseline node to a different parent is also rejected. Existing
same-parent full-baseline remount compatibility does not authorize remounting a
surviving row in a pruned window.

For pruning, let `index` be the recognized rows before that exact user and
`k = originalBaselineLength - index`. Require all:

- `1 <= k < originalBaselineLength`. At least the original baseline tail remains
  as positive boundary evidence. Complete baseline disappearance is rejected.
- All and only rows `B0..B(k-1)` are absent from the current recognized list;
  their original nodes are disconnected and outside the prepared container.
- Current rows before the user equal exactly `Bk..B(n-1)`, with original native
  IDs, roles, original node references, original parents and prepared container.
- Surviving rows and the owned user share the expected direct sequence parent.
  Direct `[data-message-item]` children before that user are exactly those
  surviving baseline nodes; unrecognized gaps/shells cannot fill this boundary.
- No baseline ID/role mutation, added recognized prefix row, middle/tail deletion,
  reorder, remounted survivor, parent/container migration or native-ID ambiguity.
  Original baseline ID/role attributes remain unchanged even on removed nodes.
- No extra/unowned user. The owned-user suffix must still be one user followed
  only by the bounded assistant rows. Existing mutation records also reject a
  transient extra user or ID/role change even if the final DOM restores it.
- The sampled recognized/direct sequences remain bounded to 256 rows.

The response is `rows.slice(index)` from the exact user boundary, never the
original baseline length or a latest/newest row. Approved missing-role settling,
direct assistant contiguity, media-owner uniqueness and generation controls
remain checked by the existing response-block logic. Structural mutations reset
media stabilization; two fresh matching polls are still required, generation
must be inactive, and the final block is revalidated after asynchronous hashing.

The new-assistant ID hydration exception cannot apply to original baseline
nodes, including a temporary baseline assistant-ID change restored in one batch.
Gate-C logical-turn/replacement acceptance itself remains unchanged.

## Nonterminal proof and persistence

Only a verified window can produce `baselineWindow` (version 1):

- `baselineWindowState: BASELINE_PREFIX_PRUNED`
- `originalBaselineLength`, `retainedBaselineLength`, `prunedPrefixCount`
- `survivingSuffixOrderValid`, `survivingIdentityValid`, `survivingRoleValid`
- `addedRowsBeforeOwnedUser` (zero), `ownedUserIndex` (retained baseline length)
- the executing content build marker

Counts are integers bounded by 256, retained/pruned lengths are positive and
sum to the original baseline length. The three validity booleans must be true.
No raw IDs, message/prompt text, HTML, URLs, tokens or timestamps are exported.
The first proof is immutable; later progressive head pruning is re-proven from
the original baseline and does not overwrite it. It describes the first safe
window, not necessarily the current retained length.

Normal V2 inspect may return this proof only with a running monotonic receipt,
while its incoming durable receipt still has no assistant anchor. It may
accompany the new assistant receipt but cannot bypass receipt validation.
Worker and main preserve it separately from receipts and terminal diagnostics.
Worker stores it with the normal receipt update; native uses the existing atomic
exclusive-temp/fsync/rename persistence. Unchanged subsequent polls do not add
diagnostic writes. Persistence failure preserves prior native bytes and cannot
publish output or resubmit. Main/worker exact-once tombstones stay authoritative.

Safe pruning creates neither terminal assistant failure nor baseline-change
user churn. Other user mutations are still diagnosed, including transient
events in the same mutation batch. Unsafe baseline drift retains all 0.3.12
bounded diagnostic schemas and first-failure behavior. A previously persisted
safe window is never permission to ignore later corruption. The active operation
reservation remains held until the existing release lifecycle says otherwise.

Development support JSON exposes the persisted first proof as
`historicalBaselineWindow`, separate from current census and terminal history.
Read-only diagnosis never creates it or changes a receipt. Old 0.3.8–0.3.12
records remain readable; absent proof stays null without a migration.

## Ownership, result and historical safety

User/assistant hashes and Receipt V2 monotonicity are unchanged. The assistant
receipt still becomes durable before result inspection or acquisition. Once
that anchor exists, restart acquisition uses only its exact owned assistant;
no baseline window or page-global/latest media is used as recovery authority.
Byte acquisition, native video verification, AssetRef publication and project/
scene association retain their existing validation.

E2E #12's recorded shape supports investigating a head-pruning case: three rows
absent, 36 original rows retained, no additions/ID/role changes and an unchanged
owned user. These aggregate historical counts are not themselves a production
proof of suffix order and cannot recover that operation retrospectively. Future
executions must pass every live predicate above.

All real E2E #1–#12 files remain byte-identical. E2E #12 remains interrupted with
its original BASELINE_CHANGED assistant/user history and MULTIPLE_BASELINE_DIFFERENCES
baseline evidence. No assistant anchor or safe-window proof is backfilled and
no historical blob video is acquired.

Regressions use isolated DOM/worker/native fixtures and fixture media bytes.
They cover strict pre-echo behavior; head prefixes of 1, 3 and larger sizes;
all unsafe identity/order/parent/boundary cases; manual/receipt/expiry gates;
pending-role settling; inactive generation/two-poll stabilization; immutable
baseline hashes; assistant-before-result persistence; restart-scoped acquisition;
privacy/resource failures/single-flight; and legacy diagnostic readability.
No test sends commands to the real Muse page. Staging and a future controlled
E2E require separate manual steps, runtime preflight and user authorization.
