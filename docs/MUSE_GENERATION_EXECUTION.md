# Muse generation execution

This is the current architecture for future operations. Historical investigation
files and machine-local evidence are not part of the repository feature.

## Runtime and distribution

GenerationService -> Muse provider -> authenticated localhost extension bridge
-> Chrome extension -> the user's existing authenticated Muse tab.
There is one job system, one output model and no browser process/debugging access.
The renderer has no generic command, selector, script, remote URL or byte API.

| Layer | Version |
| --- | --- |
| Extension manifest and minimum compatible extension | 0.3.0 |
| Loopback transport protocol | 1 |
| Execution contract | 3 |
| Ownership receipt | 2 |

The minor version advances the readiness-only 0.2.x distribution to execution
and acquisition. The transport envelope remains protocol 1; capability checks
separately require execution 3 and receipt 2. Old 0.1/0.2 workers retain their
legacy protocol interpretation but are outdated and cannot execute. Unknown
protocol versions fail closed. See [distribution](MUSE_EXTENSION_DISTRIBUTION.md).
The store identity and URL stay blank until an actual listing is configured.

Executing JavaScript reports version-specific markers:
- muse-worker-v0-3-0-contract3-receipt2
- muse-content-v0-3-0-contract3-receipt2

Packaging tests ensure marker versions match the manifest and all eight extension
files match source in the ASAR. Managed staging copies repository files, never
browser profiles. Staging is not proof Chrome reloaded them: after a bundle update,
the user must reload the extension and refresh the existing tab once. Receiver
selection respects the selected session; multiple candidates require selection.

## Submission and ownership

The existing lifecycle is queued -> preparing -> submitting -> running ->
verifying -> completed, with failed/cancelling/cancelled/interrupted as truthful
outcomes. Muse progress remains indeterminate until completion; no synthetic
percentages, model identifiers, credits, media URLs or successful assets exist.
The selected tab supplies settings; one selected scene receives the exact prompt.

Before typing, main persists a unique operation intent. The typed prepare command
reserves the operation in worker storage and obtains a stable nonempty baseline:
three matching ordered structural snapshots, about 250 ms apart, bounded by five
seconds with observer cleanup. Native and worker persist this baseline first.
Submit rechecks readiness and resolves exactly one visible, enabled button inside
the current composer action slot. Only one invocation is allowed.

Delivery, invocation and acceptance are distinct. Acceptance requires a new user
identity, cleared composer and a send transition or active-generation control.
Uncertain acceptance interrupts and never triggers an automatic submission retry.
The accepted user anchor is persisted before an assistant can be adopted.

An observer remembers additions/removals during the continuous acceptance window.
Exactly one causally new assistant, with no unexpected new user, may bind to the
operation. Multiple unexplained assistants, native-ID mutation, observer overflow,
loss of continuity or timeouts interrupt. Assistant evidence is persisted while
running, before result inspection. This is bounded causal observation, not a claim
that Muse provides explicit native reply-to links. It depends on a complete
bounded baseline and uninterrupted observation (at most 20 minutes, contact gaps
at most 10 seconds). User-only evidence cannot reconstruct that window on restart.

Message hashes use SHA-256(operationId + NUL + role + NUL + native message ID).
Raw native IDs, text and HTML never cross the extension boundary. Receipt v2 stores
baseline hash sets, accepted user hash, assistant hash and optional scoped result
{kind: video, ownerAssistantStableIdHash}. Existing anchors are immutable; receipts
advance monotonically. Assistant-anchored recovery does not require equality of
the whole ordered conversation. Missing exact anchors interrupt, without scrolling
or adopting another response. Legacy receipts cannot migrate or acquire bytes.
Legacy parsers remain for conservative inspection; production new submissions
require receipt v2. Historical interrupted records are never guessed into v2.

## Scoped acquisition

Only the exact receipt-owned assistant can supply a video. The closest message
container must be that assistant; nested foreign messages and all page-global
videos are excluded. Zero videos remains pending; more than one is ambiguous.
Exactly one ready, error-free video with positive finite duration and dimensions
is required. No stable native media/result ID has been proven or invented.
The fallback is unique-video containment within the owned assistant, not byte
identity across page refresh. During transfer, element and source must not change.

A narrow acquireGenerationResult command takes operation/scene/receipt and transfer
metadata, never a URL, selector, script or destination path. Both blob and HTTPS
sources stay within browser-side scoped streaming. Blob origin must be Muse;
HTTPS is limited to Muse and fbcdn.net subdomains. Credentials in URLs, unexpected
ports, redirects, changed final URLs and unsupported content types fail closed.
Only video/mp4 or application/octet-stream bodies proceed to local verification.
No raw URL, auth header, cookie or binary payload is sent to the renderer.

Main creates the transfer ID. Chunks validate operation, scene, receipt, sequence,
offset, canonical base64 and SHA-256. Maximum video size is 256 MiB; raw chunks are
192 KiB (256 KiB base64), within the existing 300,000-byte HTTP limit with a maximum
receipt. Total is unknown until EOF, then must equal accumulated bytes; any declared
Content-Length must also match. The browser retains at most one 8 MiB incoming
stream chunk plus its output buffer, not a whole video. There is one browser transfer
at a time. A FIFO set retains the 64 most recently closed transfer IDs and rejects
replay within that window. Each new closure evicts only the oldest tombstone when
necessary; fresh transfers do not exhaust the tab. Active transfers are separate
and cannot be evicted. Duplicate in-flight requests are rejected without aborting
the original; late cleanup cannot close a successor with a reused ID.

An evicted ID is not an authorization token. Reusing it still requires the worker's
durable operation/receipt and cancellation checks, exact Receipt V2 assistant
ownership, scoped video lookup and allowed source validation. It cannot submit a
generation or select a page-global video/URL. Main alone creates transfer IDs and
validates every returned chunk against its current transfer, then verifies real
bytes and exclusively publishes the recorded output. Eviction therefore permits
another validated read, not ownership bypass or unvalidated output publication.

Browser idle/read timeout is 15 seconds, native chunk deadline 20 seconds, and the
transfer bound five minutes. Disconnect aborts the browser stream. Local cancellation
stops writes immediately; typed abort delivery is best effort when transport is lost.
This does not claim remote Muse cancellation. An uncertain remote outcome remains
interrupted; no generation is automatically resubmitted.

The typed cancel command invalidates local V2 observation, disconnects its observer,
releases its active reservation and aborts matching operation/scene transfers.
It retains the operation record and all receipts. A separate durable worker
localCancelled flag blocks submission of a cancelled preparation even after
restart; it does not mean Muse stopped. The response remains unsupported with
confirmed:false. A new independent operation still needs normal service admission
and live readiness checks.

## Files, verification and restart

Main controls the app-managed outputs/<jobId>/<jobId>.mp4 path. Directory realpath,
regular-file/symlink, exclusive-open and free-space checks precede writes. A same-job
partial file is cleared safely, recreated exclusively, streamed and fsynced. It must
pass the MP4 header check and existing probeVideo verification (positive duration
and dimensions). Failures clean the partial and publish no output or asset.

The private intent records verified filename, size, SHA-256 and user/assistant
anchors before exclusive hard-link publication. Existing final files are never
overwritten. After restart, an output is reused only if this record, checksum,
size and video verification all match again. Unrecorded/tampered output is preserved
and rejected. A matching final output can be reused offline and cleans its leftover
partial. With no final output, explicit recovery inspects the exact assistant and
may reacquire; it never prepares or submits. Missing ownership leaves partial data
unpublishable. Service cancellation epochs prevent late completion callbacks.

GenerationService retains single-flight admission for active Muse jobs; historical
terminal records do not hold the slot. It owns verifying/completed transitions and
publishes the existing {fileName} asset/output references only after verification.
The existing Studio handoff imports the verified local output through normal media
handling. UI strings remain in the VI/EN locale layer.

## Diagnostics and repository hygiene

Normal renderer IPC exposes only sanitized readiness/session/job/output state.
Investigative ownership/linkage and media capability diagnostics require an explicit
development manifest marker AND an opt-in native diagnostic bridge. Production
worker/content/native boundaries reject them. They remain bounded typed diagnostics,
not arbitrary DOM access. No generic executeScript or browser evaluation exists.

Live JSONL samples, preservation manifests, machine-specific scripts, backup locks,
and investigation documents are kept locally outside the commit. Tests use synthetic
identities and URLs, not captured account data or historical media references.

## Validation and limitations

Run npm run test:core-commercial for the broader feature regression. Focused scripts:

test:muse-execution, test:muse-extension, test:generation-runtime, test:media-local-files.
Also run media-acquisition-manager, media-acquisition-path-windows and
media-runtime-integration tests. The extension suite creates temporary ASAR archives,
checks exact source bytes, and proves missing-file packaging fails. No installed
browser session is used by those tests. Muse unit tests inject a verifier and
assert exact fixture bytes before output publication; they do not load the native
media runtime or require its packages. Production still uses the existing native
video probe. Packaging checks are not a signed installer or a desktop E2E run.

Read-only live research found one blob-backed video inside an assistant and other
videos outside assistants. This supports scoped lookup structurally, not operation
ownership. Blob fetchability, MediaSource backing, allowed origin and actual byte
format remain unproven live. A MediaSource object URL may not be fetchable and then
must interrupt. No historical video was acquired, and no receipt-v2 live end-to-end
generation/acquisition has been validated. Future controlled validation needs
separate authorization and a genuinely owned receipt; historical media is excluded.


### Content observation capacity

Receipt V2 entries in the content script represent live causal observations, not operation history. Cancellation, invalidation, observation expiry, disconnect, and returning an assistant anchor invalidate retained references, disconnect the observer, clear its deadline, and remove the matching map entry. The 32-entry bound remains. Returning the assistant anchor releases observation only; the worker validates and persists the monotonic receipt before forwarding it. If that reply is lost before persistence, user-only recovery fails closed and never resubmits.

Transfers have their own bounded lifetime. They reserve their slot before asynchronous ownership lookup so cancellation can abort even that phase; observation cleanup does not remove a live transfer. A pending/active transfer blocks competing preparation. Worker storage remains authoritative for intent, invocation, cancellation tombstones, and receipts, including after worker restart. Content cleanup never clears durable history. Regression coverage uses VM DOM/storage/fetch fixtures only, including 40 sequential cancel and assistant-anchor cycles; it performs no live Muse submission or acquisition.
