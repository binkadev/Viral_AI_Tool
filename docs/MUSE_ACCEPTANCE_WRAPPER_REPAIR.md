# Muse acceptance wrapper projection

Extension 0.3.7 fixes the live projection of internal child-list mutations during
user acceptance. It keeps protocol 1, execution contract 3 and Receipt V2 (2).
Executing markers are `muse-worker-v0-3-7-contract3-receipt2-wrapper1` and
`muse-content-v0-3-7-contract3-receipt2-wrapper1`. The complete nine-file managed
bundle must be restaged, the extension reloaded once and the Muse tab refreshed
once before read-only runtime preflight can verify these markers. No live
submission is part of this repair.

## Cause and boundary

E2E #6 (`ced92cf1-e572-441d-b7f8-007c14362c17`) recorded one send invocation,
then interrupted with `RECOVERY_REQUIRED` before a user anchor was established.
Its valid trace has one frame and nine events. At 45 ms, the baseline prefix
still matched, but event 8 carried `wrapper`, role `assistant`, position 32 in
a 39-row baseline. The unchanged offline model rejects that message-authority
event as `BASELINE_CHANGED`.

The adapter used the mutation target's message role even when no message node
was added or removed. An internal child-list target can be a standing message
row. Such a wrapper event must instead have role `none`, identity 0 and position
-1. Only bounded structural metadata remains; it cannot claim row authority.

Actual message additions/removals (including descendants of added/removed
wrappers), identity hydration/changes, role changes and mounted baseline-prefix
checks retain their existing authority and fail-closed behavior. Assistant
response-block stabilization, exact-once worker history, acquisition and receipt
validation are unchanged. No trace or receipt schema changes are needed.

## Historical evidence and regression

The live adapter alone changes classification. Trace versions 1 and 2 and their
offline replay semantics are unchanged. Historical-style wrapper events carrying
baseline assistant authority still fail replay and cannot become ownership
receipts. The persisted E2E #6 trace is not rewritten or retrospectively repaired;
the operation remains interrupted and unacquired. No historical operation is
retried, reconciled or acquired.

Fixture regressions cover internal baseline user/assistant wrapper mutations,
real baseline removal/reinsertion, native-ID/role mutation, transient ID mutation,
prefix reordering and fresh message events through a fast status/media tail.
Existing replacement/hydration, response-block, exact-once, receipt, acquisition,
diagnostic, distribution and runtime-preflight suites remain required.
