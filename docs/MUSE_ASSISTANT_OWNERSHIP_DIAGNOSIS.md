# Read-only assistant ownership diagnosis

In an unpackaged development/support app, Settings > Muse > Development
connection check exposes **Response ownership diagnosis**. Enter one existing
request ID, read the report, then copy its JSON. This is separate from a job's
Check/continue action and from the acceptance trace export.

## Runtime identity and failure reports

The ownership-diagnosis runtime is extension **0.3.4**, worker
`muse-worker-v0-3-4-contract3-receipt2-ownershipdiag1`, and content
`muse-content-v0-3-4-contract3-receipt2-acceptance3`. Protocol 1, execution
contract 3 and Receipt V2 are unchanged. All nine managed files must match the
source bundle. Version 0.3.3 is outdated, including the intermediate worker
that added V2 diagnosis without changing its marker. Restage through the normal
support action, reload the extension, and refresh the existing Muse tab before
using the updated diagnostic. Never retarget an old operation to a new tab.

Failure now returns copyable JSON with `ok: false`, a bounded `reason` and
`layer`, plus `instanceMatch`, `tabMatch`, `nativeUserAnchor`,
`nativeAssistantAnchor`, `workerIntentPresent`, `workerUserAnchor` and
`workerAssistantAnchor`. These are booleans, or null when the gate was not
reached; null is not evidence of absence. Errors and stacks are never copied.
Both locales explain each reason in the development support view.

Gate order is native record/receipt validation, recorded instance, recorded
tab, exact runtime/staged build, worker durable intent, worker receipt, content
receiver, content diagnostic, native result validation. The native user hash is
passed internally and must equal the worker's stored user hash. A native user
anchor with a missing/different worker anchor returns
`WORKER_RECEIPT_MISMATCH`; it never repairs either receipt. A failed earlier gate
leaves worker fields unknown instead of bypassing the gate to read storage.

Allowed reasons: `JOB_NOT_FOUND`, `JOB_STATE_UNSUPPORTED`,
`OPERATION_RECORD_UNAVAILABLE`, `RECEIPT_UNAVAILABLE`, `USER_ANCHOR_MISSING`,
`ASSISTANT_ALREADY_ANCHORED`, `TARGET_INSTANCE_UNAVAILABLE`,
`TARGET_TAB_UNAVAILABLE`, `WORKER_INTENT_UNAVAILABLE`,
`WORKER_RECEIPT_MISMATCH`, `CONTENT_RECEIVER_UNAVAILABLE`,
`CONTENT_DIAGNOSIS_REJECTED`, `DIAGNOSTIC_RESULT_INVALID`,
`RUNTIME_BUILD_MISMATCH`, `UNAVAILABLE`, `UNKNOWN`.

`desktopAPI.diagnoseMuseOwnership(jobId)` uses a fixed trusted IPC channel,
GenerationService, the Muse provider, and the existing execution record reader.
It permits only running/interrupted Muse jobs with a valid durable Receipt V2,
a user anchor, no assistant anchor, and matching operation/scene/digest. Packaged
production cannot use it because native and extension development gates reject
the request. The renderer supplies only a job ID.

The native path sends only `inspectGeneration` with `diagnoseOwnership: true`
to the operation's recorded target. It does not call reconcile or the normal
evidence-saving command wrapper. The existing worker reads its durable intent,
validates its V2 operation/scene/user-only receipt, and supplies that receipt's
user hash to the existing `diagnoseOwnership(p)` DOM diagnostic. Native then
validates that the returned ownership flags/count agree with its own durable
user hash. No raw native IDs cross the extension boundary.

The report contains operation-scoped hashes, bounded roles/parent/sibling
indices, allowlisted hashed linkage metadata, video counts and source kinds.
It contains no text, HTML, URLs, credentials, account identity, bridge port/token
or arbitrary selectors. Matching adjacency, parents or linkage metadata is
diagnostic evidence only; this API never creates an assistant anchor.

The request performs no prepare/submit/retry/reconcile/acquisition/cancellation,
job/intent/receipt writes, session selection, DOM mutation, scrolling or
navigation. The bridge must already be running with a fresh recorded target;
it does not start/prune sessions for this diagnostic or its poll/result exchange.
Only bounded transient command transport state is allocated. Independent normal
heartbeats continue their usual updates.

## Current observer audit (unchanged)

`newAssistants` is a historical Set of native IDs seen in mounted rows and
mutation additions/removals outside the prepared baseline. It is not a Set of
currently mounted logical responses. An ID replacement can retain both IDs and
invalidate the operation when its size exceeds one. A remount retaining the
same native ID does not itself increase the Set size. Assistant replacement has
no equivalent of the acceptance3 logical-user lineage model.

User acceptance can succeed before a later assistant observation invalidates
and releases the operation. Other release paths include user identity changes,
manual interference, token/lifetime mismatches and explicit cleanup. Canonical
assistant stabilization is not modeled before release. The nominal native poll
interval is 2 seconds; the content last-contact guard is 10 seconds and the
observation lifetime is 20 minutes. Scheduling/transport delays can cross the
contact guard; interval configuration alone does not prove this happened.

A current DOM census cannot reconstruct the first historical failed predicate
or distinguish successive assistant IDs from simultaneously mounted rows at
the time of failure. A user-only Receipt V2 proves acceptance, not assistant
ownership. Do not retrofit a receipt from current adjacency or rerun a request
to collect missing evidence. This feature adds no assistant-binding semantics
and no automatic recovery or resubmission.
