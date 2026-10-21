# Bounded assistant ownership failure evidence

Extension 0.3.8 adds Gate-D diagnostics only. Protocol 1, execution contract 3,
Receipt V2 (2), response-block authority, stabilization, exact-once submission,
result discovery and acquisition requirements are unchanged. Executing markers:

- `muse-worker-v0-3-8-contract3-receipt2-assistdiag1`
- `muse-content-v0-3-8-contract3-receipt2-assistdiag1`

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
