# Post-anchor user identity churn — extension 0.3.11

First shipped in 0.3.11. Version 0.3.12 adds separate [baseline drift evidence](MUSE_BASELINE_DRIFT.md).
Current 0.3.13 retains unsafe identity diagnostics while excluding only
[proven safe head pruning](MUSE_BASELINE_PREFIX_WINDOW.md) from baseline-change churn.
Version 0.3.14 adds the synchronous replacement comparison group below; all
ownership and prefix-pruning decisions remain those of 0.3.13.

Original 0.3.11 executing builds:

- `muse-worker-v0-3-11-contract3-receipt2-userchurn1`
- `muse-content-v0-3-11-contract3-receipt2-userchurn1`

Protocol 1, execution contract 3 and Receipt V2 (2) are unchanged. The complete
nine-file managed bundle includes this diagnostic in `content-script.js` and
`receipt-v2.js`; no tenth extension file is needed. This release does not change
acceptance, pending-role settling, assistant stabilization, acquisition or retry.

## Audited boundary

`submit()` accepts the canonical logical user turn, computes its existing native
ID hash, and returns a user-only receipt. Worker storage and native persist that
receipt. A later observer/`inspectV2()` calls `sample()`, `structure()` and
`afterBaseline()`/`responseBlock()`. Its unowned-user guard can throw
`LOGICAL_USER_MISMATCH`; identity-attribute mutations can invalidate even earlier.
The existing Gate-D frame records the failure and whether the original ID is
present, but cannot distinguish a changed ID on the same node from removal,
replacement, role changes, parent changes or later independent user activity.

E2E #10's original `LOGICAL_USER_MISMATCH` / `sample_before_block` and its later
unresolved user hash establish absence, not the cause. No new evidence is
retroactively attached to that operation. Historical E2E #1–#10 stays unchanged.

## First structural observation

Immediately after local acceptance, diagnostic-only references remember the
exact accepted node, its prepared parent/container and its direct sequence index.
The existing observer samples those references before its existing guards can
throw. A pending first event may be retained before acknowledgement, but it can
cross into durable worker/native history only through normal inspect echoing the
same accepted operation, scene and user receipt. Read-only diagnosis never
promotes, inspects for execution, reconciles or saves a receipt.

The first relevant event is stored separately as `userAnchorChurn` (version 1),
and presented in support details as `historicalUserAnchorChurn`. It never changes
`historicalAssistantOwnershipFailure`. Later DOM observations cannot overwrite
either first event. No event is recorded for an unchanged user anchor or ordinary
assistant/status/media updates.

Deterministic classification priority, highest first:

1. `UNKNOWN_BOUNDED`: diagnostic scan overflow or unavailable original index.
2. `ROLE_CHANGED`: current role changed or a role mutation was observed.
3. `PARENT_CHANGED`: connected original node has a different parent.
4. `IDENTITY_UNAVAILABLE`: original node has no valid native ID.
5. `SAME_NODE_ID_CHANGED`: exact original node's ID differs or a transient ID
   attribute change was observed, even if restored in the same batch.
6. `MULTIPLE_USER_CANDIDATES`: more than one nonbaseline, nonoriginal user node.
7. `REPLACED_SAME_POSITION` / `REPLACED_DIFFERENT_POSITION`: original node absent,
   removal observed, exactly one candidate addition observed. Same position
   requires the original sequence index, same prepared parent and container.
8. `OWNED_NODE_REMOVED`: original no longer connected/in-container/in-sequence,
   or its removal was observed, without sufficient replacement observations.
9. `BASELINE_CHANGED`: ordered baseline role/ID prefix differs.
10. `NEXT_USER_OBSERVED`: original remains and another user candidate is present
    or observed in the mutation additions.

These labels describe structural observations only. In particular, a replacement
label is not proof that two nodes represent the same logical turn. Final
adjacency without observed removal/addition cannot produce a replacement label.
No candidate becomes owned, no replacement ID is hashed, and no receipt is
rewritten or retargeted. The classifier never feeds a control-flow decision.

## Bounded payload and persistence

Every event contains only version/build, kind, elapsed bucket, mutation-count
bucket, two nullable bounded counts and these nullable booleans:

- `anchoredNodeStillConnected`, `anchoredNodeStillInContainer`,
  `anchoredNodeSameParent`, `anchoredNodeRoleStillUser`,
  `anchoredNativeIdStillSame`, `anchoredSequenceIndexValid`.
- `replacementSameParent`, `replacementSameSequencePosition`,
  `replacementImmediatelyAfterBaseline`, `replacementHasValidNativeId`.
- `mutationObservedOnAnchoredNode`, `anchoredIdAttributeChanged`,
  `anchoredRoleAttributeChanged`, `anchoredNodeRemoved`, `replacementNodeAdded`.
- `generationActive`.

`freshLogicalUserCount` counts mounted nonbaseline user rows;
`replacementUserCandidateCount` counts distinct nonoriginal/nonbaseline user
nodes in the bounded current sample plus additions. Neither is logical identity
authority. Both saturate at 128. Sequence queries take at most 257 nodes (overflow
sentinel); mutation/node traversal has a budget of 256. Overflow records
`UNKNOWN_BOUNDED` with null structural fields, not guessed negative evidence.
Mutation flags describe only the observed batch; false does not prove that no
earlier unobserved mutation occurred. Unavailable candidate facts are null.

The 0.3.14 content build (`muse-content-v0-3-14-contract3-receipt2-replacementdiag1`)
adds four nullable booleans to the same first historical event:

- `replacementNativeIdMatchesSubmittedUser`: direct equality of the unique
  candidate's current native ID with `op.submittedUserId`.
- `replacementRoleMatchesOwnedUser`: whether that candidate currently has role
  `user`.
- `replacementCandidateStillMounted`: candidate `isConnected` observation.
- `replacementCandidateStillInContainer`: membership in the original prepared
  container.

All four are null when there is no unique candidate or the diagnostic scan
overflows. A detached/transient candidate may report false for mounted/container
membership. This is the bounded first-event sample, not a later live census.
No raw ID crosses the bridge. There is no `replacementOwnedHashMatchesReceipt`
field: adding an asynchronous hash would affect mutation-observer timing, so
only synchronous attribute/structural comparisons are recorded.

Validators accept these four fields only as a complete boolean/null group.
Legacy 0.3.11–0.3.13 events without the group remain valid and unchanged; missing
historical facts are never filled in. Partial groups, private fields, hashes or
execution-input promotion are rejected. Existing worker/native first-only
persistence and support sanitization carry the optional group unchanged.

Same-position replacement with the same ID still fails the exact-owned-node
guard. Different-ID replacement still fails the existing logical-user guard.
Multiple candidates remain ambiguous. None of these booleans enters Gate C,
Gate D, the post-anchor window predicate, receipt hashing, result discovery or
acquisition. No original receipt/anchor is rewritten and no operation retargets.
Historical E2E #13 is not retried, reinterpreted or retrofitted by this release.

Elapsed buckets: `under_1s`, `1_to_10s`, `10_to_60s`, `over_60s`. Mutation buckets:
`zero`, `one_to_four`, `five_or_more`. No wall-clock timestamp is exported.

The released-operation diagnostic cache remains bounded to 32 entries and keeps
only safe payloads and existing hashed correlation keys, never diagnostic DOM
references. Worker/main preserve the first valid event independently of receipt
history. Only interrupted user-anchored, assistant-unanchored normal inspect
responses may carry it. All other commands, receipt inputs and extra/private
fields are rejected. Native saves both diagnostics in one exclusive-temp,
fsync/atomic-rename update. Running polls and read-only support diagnosis do not
write evidence. Write failure preserves the prior record and cleans the temp.

Support reports distinguish this persisted event from the current DOM census.
Old 0.3.8/0.3.9/0.3.10 records remain valid, retain their original fields, and
report null churn when none was recorded. No text, raw IDs, HTML, URLs, prompt,
token, cookie or account identity can enter this strict event schema. Raw node
references/native IDs remain inside the extension's existing observation boundary.

All regressions use isolated DOM/worker/native fixtures. No real Muse execution,
historical recovery/acquisition, staging or browser interaction is authorized by
this change. A future E2E requires separate authorization after manual staging
and read-only preflight of the complete current 0.3.14 bundle.
