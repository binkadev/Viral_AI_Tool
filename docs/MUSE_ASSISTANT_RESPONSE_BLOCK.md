# Muse assistant response block

Extension 0.3.6 changes future V2 assistant binding only. The existing green-robot
operation and all other historical jobs/receipts remain untouched. A later DOM
census cannot create a missing historical assistant anchor.

The supplied live census showed one owned user followed by two mounted
assistant rows: a non-media row, then one blob-video row. Assistant native-ID
cardinality is therefore not a logical response count and does not identify the
media owner.

## Eligibility and bounds

While the original live operation and worker/bridge observation token remain
valid, the persisted user receipt must match the one accepted user hash. The
immutable ordered baseline remains intact. Before binding, no additional user
turn or trusted manual interaction is allowed, including transient observed
turns removed before a poll. The accepted user's message-sequence parent and
prepared bounded conversation ancestor must remain unchanged.

The only eligible block is the contiguous assistant message suffix after that
user. It has at most **eight** rows, in the same direct message sequence and
prepared conversation container. Unknown message roles, foreign parents,
baseline changes, another user or overflow interrupt. The observer's historical
assistant-ID Set is diagnostic history only, capped at 128; it never selects an
owner or turns two assistant rows into ambiguity by itself.

For future executions in 0.3.10, exactly one trailing direct shell with both role
and ID unassigned may remain not-ready under the strict
[pending-role settling checks](MUSE_PENDING_ROLE_SETTLING.md). It grants no block,
assistant or media authority and resets stabilization. All recognized row/parent,
container and ownership requirements above remain necessary before anchoring.

Within this block, a direct video satisfies `video.closest(MESSAGE) === row`.
Zero video-owning rows remains running. Multiple media rows, or multiple direct
videos in one candidate row, fail closed. Page-global videos, nested foreign
videos and videos in historical baseline assistants cannot qualify.

## Stabilization and durability

Generation must be inactive. A sole media row's native identity, the block's
ordered identities/direct-video counts, and its mounted row nodes must match
across two successive inspect polls. A row remount, identity change or observed
DOM mutation resets stabilization. Changed assistant IDs may stabilize later;
there is no newest/last-row selection. Existing 10-second contact and 20-minute
operation limits remain authoritative.

After async hashing, the observer and current block are rechecked. The response
extends Receipt V2 with only `assistantStableIdHash` and returns running. Worker
and native persist this anchor before any subsequent inspect may establish a
result receipt. Acquisition still requires that result receipt and reads only
the direct video in the exact assistant matching the stored hash. No receipt
schema/version change or result/acquisition fallback was introduced.

V2 user acceptance permits `user, assistant*` with the same eight-row tail bound.
Exactly one logical user turn, canonical stabilization, baseline/container and
manual-interference proofs remain required. V1 execution retains its original
single-assistant suffix behavior. New acceptance trace version 2 selects the
bounded-tail pure replay model; historical trace version 1 keeps its prior
single-assistant replay semantics. Neither trace can supply live ownership.

## Read-only diagnosis

The existing development ownership census includes `responseBlock`:

- `ownedResponseBlockCount`: zero or one candidate contiguous block;
- `assistantBlockRowCount`: bounded row count (nine signals overflow);
- `mediaAssistantCandidateCount`: bounded direct-video owner count;
- `mediaAssistantStable`: false in a census; diagnosis never advances the live
  two-poll stabilization or infers historical stability;
- `generationActive`, `nextUserObserved`, `assistantBlockWithinBound`: booleans.

These current structural observations are not a receipt, causal continuity
proof, or permission to reconcile/acquire any historical result. Native IDs,
text, raw HTML and URLs remain inside the content-script boundary.
