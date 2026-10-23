# Pending assistant role settling — extension 0.3.10

Protocol 1, execution contract 3 and Receipt V2 (2) remain unchanged. Runtime:

- `muse-worker-v0-3-10-contract3-receipt2-assistsettle1`
- `muse-content-v0-3-10-contract3-receipt2-assistsettle1`

## Evidence and prior call path

E2E #9 (`df516787-247a-4f4a-b8ea-779905a88598`) was accepted with a durable user
anchor, then interrupted in 0.3.9. Its original Gate-D frame records:
`BLOCK_NONCONTIGUOUS`, `sample_before_block`, `MISSING_ROLE`, one logical user,
zero recognized assistants, one direct message-item tail node, one pending ID,
one missing role, zero unsupported roles/invalid IDs, a valid user sequence index
and matching recognized positions. This proves a direct item had no recognized
role and no ID at that observation. The later user-reported census has two
assistant rows and one media candidate; it does not prove which exact shell
hydrated. No broader claim about noncontiguous states is made.

Previously `responseBlock()` recorded this sequence discrepancy and threw
`BLOCK_NONCONTIGUOUS`; observer sample marked the operation invalid and called
`releaseV2()`. A subsequent inspect returned interrupted with its first Gate-D
failure. That behavior remains for every unproven discrepancy below.

## The sole new not-ready branch

Only future live operations may wait when all existing baseline, owned user,
prepared container and unchanged user-parent checks pass, and:

- the user index in the direct sequence is valid;
- all recognized assistant nodes already occupy their expected direct slots;
- exactly **one** extra direct message-item shell trails those rows;
- that shell has null/empty role **and** null/empty native ID;
- the shell is a direct child of the same parent, inside the prepared container,
  with no nested message items or video descendants;
- recognized assistants plus that one shell fit the existing eight-row limit;
- one logical owned user remains, with the accepted native user ID and valid V2
  user receipt, no assistant anchor, no invalidation/manual interference;
- the existing contact and operation lifetime checks still pass;
- recognized assistant media still has at most one owner with one direct video.

This is intentionally narrower than generic `MISSING_ROLE`. An assigned ID with
missing role, invalid ID, unsupported role, two shells, interposed shell, video
inside an unclassified shell, nested message, unrelated direct node, mismatched
tail/position, parent/container change, extra user, baseline or identity mutation,
manual interference and all existing receipt/token/scene failures stay terminal.
No diagnostic count or category is used to authorize waiting or ownership.

Observer sampling retains the operation without setting invalid. Inspect still
requires the durably echoed user receipt and checks the owned user's hash, then
returns its unchanged running receipt. No failure is persisted, no assistant
anchor/result is created, and no acquisition is triggered while settling.

## Bounds and stabilization

No scheduler, retry or dedicated extending timer is added. Existing 10-second
contact and 20-minute operation lifetime limits bound the wait. Normal native
polls refresh contact as before, but can never extend the absolute operation
lifetime. Expiry/stale contact still interrupts and records the first terminal
reason. Repeated pending mutations, replacement shells and polls do not restart
that lifetime. No resend or fake progress is introduced.

Every settling observation clears media stabilization. It neither starts nor
advances a matching sample. Once role/ID hydration produces a valid normal block,
the existing behavior resumes: one exact direct-video owner, generation inactive,
two matching polls, precommit revalidation, then durable assistant receipt before
result discovery. A generation-active block cannot anchor. Restart before the
assistant receipt still loses causal continuity; restart after the assistant
receipt may acquire only that exact anchored assistant's result using the
unchanged verification/publication path. No latest/page-global fallback exists.

`PENDING_ROLE_SETTLING` frames are nonterminal observations within the existing
bounded in-memory Gate-D trace. If a later genuine terminal fault occurs, the
first such fault is frozen and atomically persisted as before. The schema rejects
`PENDING_ROLE_SETTLING` as a terminal failure. Existing 0.3.9 counts/enums and old
record readability are preserved. No private text, IDs, HTML or URLs are added.

## Validation and historical scope

Synthetic DOM/worker/native fixtures cover pending wait before the first durable
echo, same-node hydration into status then media, generation-active blocking,
stabilization reset/two fresh polls, all unsafe combinations, stale contact and
absolute expiry. The pipeline fixture verifies no diagnostic disk writes during
wait, assistant persistence before result, restart with exact owned acquisition,
real fixture-byte verification/publication and no unrelated media fallback.
Those fixture commands never reach the real Muse browser.

All historical controlled E2E #1–#9 records are read-only. E2E #9 remains
interrupted / RECOVERY_REQUIRED with its original BLOCK_NONCONTIGUOUS/MISSING_ROLE
evidence. It is never recovered, reinterpreted, anchored or acquired by this fix.
The complete managed bundle must be restaged, then reloaded/refreshed manually
and pass read-only 0.3.10 runtime preflight before any separately authorized E2E.
No real Muse execution, staging or browser interaction is part of this change.
