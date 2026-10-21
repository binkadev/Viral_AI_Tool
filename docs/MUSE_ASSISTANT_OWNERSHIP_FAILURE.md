# Bounded assistant ownership failure evidence

Extension 0.3.8 adds Gate-D diagnostics only. Protocol 1, execution contract 3,
Receipt V2 (2), response-block authority, stabilization, exact-once submission,
result discovery and acquisition requirements are unchanged. Version 0.3.9
refined sequence failure evidence only. Version 0.3.10 adds the narrow pending
missing-role wait described in [pending role settling](MUSE_PENDING_ROLE_SETTLING.md).
Version 0.3.11 adds separate [post-anchor user churn evidence](MUSE_USER_ANCHOR_CHURN.md).
Version 0.3.12 adds separate [baseline drift evidence](MUSE_BASELINE_DRIFT.md),
without changing ownership or settling behavior.
Version 0.3.13 additionally permits only [verified post-anchor head pruning](MUSE_BASELINE_PREFIX_WINDOW.md).
Current 0.3.14 adds only the [replacement diagnostic boolean group](MUSE_USER_ANCHOR_CHURN.md), without changing those decisions.
Executing markers:

- `muse-worker-v0-3-14-contract3-receipt2-replacementdiag1`
- `muse-content-v0-3-14-contract3-receipt2-replacementdiag1`

## Scope and timing

A Gate-D trace starts when inspect echoes the worker's durably stored accepted
user receipt, before assistant ownership exists. No acceptance trace or user
receipt is reinterpreted. A post-acceptance observer can invalidate/release the
operation before that echo: in this gap, only its first bounded terminal snapshot
is retained. That snapshot becomes failure evidence only when an inspect echoes
the same operation, scene and user anchor. Diagnosis never promotes it.

Each trace has version 1, its executing content build, a terminal reason/phase
and at most 16 frames. Running observations stay in memory; the oldest frame
rotates out when full. The first terminal frame freezes the diagnostic, is always
last, and cannot be replaced by later DOM state. Successful assistant binding
discards this in-memory trace and returns the original receipt extension only.

Frames contain only enumerated phase/elapsed/mutation buckets, bounded counts,
booleans or explicit null for unknown structural evidence, stabilization samples
0/1/2 and a bounded reason. No native IDs, text, prompts, URLs, HTML, account data,
credentials, tokens or browser storage values are recorded.

### Sequence evidence refinement in 0.3.9

In 0.3.9 the observer/inspect calls `responseBlock()`, which obtains recognized fresh
rows from `afterBaseline(op, true)`. The direct sequence is still the existing
`[data-message-item]` query filtered to children of the owned user's parent.
The original predicate is unchanged: the user must exist in that sequence,
its tail length must equal the recognized assistant count and each recognized
assistant must occupy the expected direct position. Any mismatch still throws
`BLOCK_NONCONTIGUOUS` immediately. There is no transient wait or recovery change.

The frame immediately before this throw now includes this all-or-none optional
field group. Each field is null until actually sampled:

- `recognizedFreshRowCount`: owned user plus recognized fresh assistant rows;
- `recognizedAssistantRowCount`: recognized fresh assistant rows;
- `directSequenceTailCount`, `directMessageItemTailCount`, `sequenceTailLength`:
  aliases for the count of direct message-item nodes after the owned user in
  the exact sequence used by the predicate, including unrecognized shells;
- `expectedSequenceLength`: expected tail length (recognized assistant count),
  not the length of the entire historical conversation;
- `pendingDirectMessageItemCount`: tail items with null/empty native IDs;
- `invalidIdentityDirectMessageCount`: tail items with nonempty invalid IDs;
- `missingRoleDirectMessageCount`: tail items with null/empty roles;
- `unsupportedRoleDirectMessageCount`: tail items with nonempty roles other
  than user/assistant;
- `userSequenceIndexValid`: whether the owned user occurs in that sequence;
- `recognizedRowsMatchDirectSequence`: whether every recognized assistant
  occupies its expected slot; true for an empty recognized tail even if an
  extra shell still makes the original length predicate fail;
- `firstMismatchCategory`: deterministic enum below, never an ownership input.

Counts are bounded to 257. At most the first 256 direct tail nodes are inspected;
257 is a tail-length overflow sentinel. Abnormality counts describe those sampled
nodes (lower bounds if overflow), and overflow reports `UNKNOWN_BOUNDED` instead
of asserting a complete classification. Unsupported/missing roles and ID
abnormalities may overlap in their counts. The same `nativeId()` predicate is
used locally; raw role/ID values never enter the diagnostic.

Priority: `USER_NOT_IN_SEQUENCE` if the index is invalid (tail evidence unknown);
otherwise `NONE` if the original predicate passed; otherwise overflow gives
`UNKNOWN_BOUNDED`; then `MISSING_ROLE`, `UNSUPPORTED_ROLE`, `PENDING_MESSAGE_ID`,
`INVALID_MESSAGE_ID`, `EXTRA_DIRECT_MESSAGE_ITEM`, `SEQUENCE_TAIL_LENGTH_MISMATCH`,
`RECOGNIZED_ROW_POSITION_MISMATCH`, finally `UNKNOWN_BOUNDED`. Extra means a
sampled direct tail item is not one of the recognized assistant nodes. Thus a
missing-role shell may also have a pending ID and cause a tail-length mismatch,
but its category is deterministically `MISSING_ROLE`; all counts remain visible.

This projection uses the already-resolved sequence and rows, with no second
selector query. Projection errors produce unknown evidence, not a new ownership
decision. A recognized assistant with a pending ID remains governed by existing
pending-ID semantics; it need not produce a noncontiguous failure. A recognized
row with a nonempty invalid ID is already rejected by `structure()` before
`responseBlock()`; its sequence fields stay null. Classifier fixture tests for
such IDs do not claim live Muse reached the sequence check in that state.

Trace envelope version remains 1. Old 0.3.8 frames without the field group remain
valid and readable byte-for-byte, including support summaries. No defaults or
new fields are retrofitted into stored history. New live frames initialize the
group as null, reset it before each sample and freeze it with the first terminal
failure. The existing 16-frame bound, worker/native atomic first-only persistence
and separation from current DOM census remain unchanged.

Released observers use a 32-entry FIFO containing only failure metadata and the
bounded diagnostic/pending snapshot, with no DOM references or active-capacity
reservation. Eviction never grants authority; an evicted operation can report
only that its observation is missing. Durable worker/native history remains
authoritative once a failure has been returned and persisted.

## Reasons and phases

Phases: `precheck`, `sample_before_block`, `block_observed`, `sample_after_block`,
`stabilization`, `precommit`.

Terminal reasons:

- `OPERATION_MISSING`, `OPERATION_INVALID`, `SCENE_MISMATCH`,
  `OBSERVATION_TOKEN_MISMATCH`, `CONTACT_STALE`, `OPERATION_EXPIRED`,
  `RECEIPT_MISMATCH`;
- `OWNED_USER_MISSING`, `LOGICAL_USER_MISMATCH`, `USER_NATIVE_ID_MISMATCH`,
  `USER_HASH_MISMATCH`;
- `BLOCK_USER_INVALID`, `BLOCK_PARENT_MISMATCH`, `BLOCK_NONCONTIGUOUS`,
  `BLOCK_OUT_OF_BOUNDS`, `BLOCK_MULTIPLE_MEDIA_OWNERS`;
- `OBSERVER_INVALIDATED`, `IDENTITY_MUTATED`, `MANUAL_INTERFERENCE`,
  `BASELINE_CHANGED`, `OBSERVATION_LIMIT`, `UNKNOWN_BOUNDED`.

`STABILIZATION_NOT_READY`, `STABILIZATION_RESET`, `PRECOMMIT_BLOCK_CHANGED` and
`PRECOMMIT_GENERATION_ACTIVE` are nonterminal observations. Their existing
running/reset behavior is unchanged; instrumentation cannot turn them terminal.
Original exception messages still govern existing acceptance/ownership behavior;
only explicit diagnostic enums cross the bridge.

## Persistence and support

Only a normal inspect returning interrupted with a valid accepted user receipt
and no assistant anchor may carry `assistantOwnershipFailure`. Strict schemas
reject extra/private fields, receipt extensions, unrelated command types and
running/result responses carrying this failure. The worker stores the first
failure separately from its receipt before returning it. Native writes it as a
top-level field in `muse-operation.json` via exclusive temporary file, fsync and
atomic rename, before existing reconciliation reports interruption. Neither
layer overwrites a prior valid failure. Normal running polls do not write this
diagnostic to disk. Write failures preserve the old record and remove the temp;
a lost reply/write may leave native evidence unavailable, without granting
ownership or triggering a resubmission.

Development-only Response ownership diagnosis returns
`historicalAssistantOwnershipFailure` separately from the current `diagnostic`
DOM census. Its bounded summary contains version, build, terminalReason,
terminalPhase, frameCount and lastFrame, or null for an old record without this
evidence. Diagnosis never writes evidence, extends a receipt, advances
stabilization or invokes acquisition. A known native summary remains available
even when the current DOM census/transport is unavailable.

## Historical E2E #7 and transient-state audit

Operation `5bc2feaf-1632-4cad-8bdb-9bc4ac89e905` remains interrupted. Its accepted
user anchor exists; no assistant/result anchor or output exists. The user-provided
post-failure census showed one owned user, two assistant rows, one media candidate,
generation inactive, no next user and a block within bounds. This is a current
candidate structure, not historical stabilization or causal proof. The old
record predates Gate-D instrumentation, so its exact historical cause is unknown
and its historical failure summary is null. No migration or retrofit is allowed.

Deterministic fixture tests reproduce the current fail-closed behavior: a
temporary assistant parent mismatch or unknown-role gap invalidates/releases
the live operation, even if the final document later returns to a valid
user/status/media block. Any mutation first resets existing stabilization; a
subsequent responseBlock exception remains terminal. These tests establish a
possible race, not the cause of E2E #7. Changing transient-state semantics needs
future live evidence and separate review.

Tests also cover bounded rotation, first-reason immutability across later valid
DOM and worker restart, atomic native persistence/write failure, read-only
diagnosis, old records, strict schemas, unchanged successful receipts and no
result/acquisition triggered by diagnostic failure paths. Existing wrapper,
assistant-block, replacement, receipt, exact-once and acquisition suites remain
required. No real Muse request is performed for this change.

## Historical E2E #8

`209ccd7d-ca69-41d0-a6e0-649d2bfbd5ff` remains interrupted / RECOVERY_REQUIRED.
Its original 0.3.8 evidence records `BLOCK_NONCONTIGUOUS` at
`sample_before_block`: one owned logical user, zero recognized assistant rows,
same sequence parent, bounded block and a failed contiguity check. It cannot
identify the offending node or establish whether an unhydrated shell caused it.
The later user-provided current census showed two assistant rows and one media
candidate. It does not preserve causal continuity or repeat every historical
Gate-D check. Neither diagnostic proves that a particular shell hydrated, and
the operation is not retrospectively repaired or annotated with new fields.

## Future executions in 0.3.10

The diagnostic fields above remain intact. `PENDING_ROLE_SETTLING` is a new
nonterminal observation only, never a historical terminal failure. The strict
eligibility check reads actual structural nodes, not these diagnostic counters.
Only the proven pending missing-role state gains a bounded wait. Other structural
gaps still fail closed. Prior 0.3.8/0.3.9 terminal records keep their original
meaning; no record is migrated, rewritten or retrospectively treated as running.
