# Prospective durable execution audit v1

This local journal observes factual application boundaries. It does not authorize submission, ownership, retry, recovery, acquisition, publication, attachment or scheduling. Execution never consults its contents. A failed audit observer cannot change a GenerationJob outcome.

Only new `GenerationService.submit` admissions get `executionAudit: {version: 1, auditId: <uuid>}`. The marker is persisted with the normal job before `generation.admitted`. Loading, inspecting, recovering or attaching a historical job never adds a marker or creates a journal. Present but malformed optional audit metadata is quarantined to the fixed `{version: 1, auditId: null}` unavailable marker; it cannot reject an otherwise valid job save/load, retain unsafe fields, or become historical absence. New admissions use UUID audit IDs; an audit-only allocation failure also yields unavailable coverage. Historical E2E #1–#16 remain `not_recorded`, with null counters; there is no migration, history scan or reconstruction.

## Schema and storage

`<generation root>/audit/<jobId>.json` is one bounded, provider-neutral JSON document. Its binding is `{version, auditId, jobId, operationId, projectId, sceneId, provider}`. `operationId` is the GenerationJob ID. Its other fields are `coverage`, `streams` and `events`. Strict validators reject unknown fields, invalid bindings, unknown types, source/type conflicts, unsafe detail, duplicate sequences, malformed cursors and oversized documents.

Each event has a monotonic journal `sequence`, unpredictable occurrence `eventId`, native UTC `recordedAt`, fixed `source`, audit-only UUID `sourceEpoch`, monotonic `sourceSequence`, `type` and event-specific `detail`. Source clocks never govern generation. Sequence represents persistence order, not cross-process wall-clock causality.

The single native writer reads only to append telemetry, validate delivery or produce a report. It writes a unique temp file, fsyncs, closes and atomically renames it over the prior document. Existing events are immutable. The limits are **256 events and 128 KiB per job**, with reserved coverage headroom. At capacity it preserves prior evidence and persists a sticky gap where possible. No rotation or old-event eviction occurs. Symlink/junction directories and nonregular/symlink journal files are refused. Directory fsync is not portable on Windows; this provides the same file-flush/rename model as the existing job store, not a claim of power-loss-proof storage.

The journal is local evidence, not tamper-proof attestation. It has no cloud transport, hash chain, execution scheduler, alternative job system, provider authority or media schema.

## Exactly 14 event types

| Type | Observer and boundary | Detail |
| --- | --- | --- |
| `generation.admitted` | Native, after durable new job commit | Empty |
| `submit.requested` | Native adapter calls the actual `submitGeneration` command | Empty |
| `submit.committed` | Worker, after existing invoked-intent storage succeeds, before content delivery | Empty |
| `submit.invocation_observed` | Content, synchronously around the existing `button.click()` | `outcome: returned` or `threw_unknown` |
| `submit.acceptance_proven` | Native, after validated Receipt V2 user acceptance is durably persisted for the first time | Evidence kind/version/SHA-256 digest |
| `ownership.completed` | Native, after validated automatic result ownership is durably persisted for the first time | Evidence kind/version/SHA-256 digest |
| `acquisition.started` | Shared bounded acquisition, after fresh transfer creation and exclusive partial-file open | Mode and app-generated transfer UUID |
| `acquisition.completed` | Shared bounded acquisition, after all bytes are written, fsynced and closed | Mode and transfer UUID |
| `manual.session_opened` | Content, at actual ephemeral session creation, including a subsequently lost/failed list response | Random session alias |
| `manual.candidate_revealed` | Content, after registered candidate reveal/highlight succeeds, before final response | Random session and candidate aliases |
| `manual.candidate_confirmed` | Native, after authoritative confirmation persistence succeeds | Existing resolution UUID |
| `output.published` | Shared acquisition, after native verification, evidence save and exclusive link publication | Mode, canonical `<jobId>.mp4`, size, SHA-256, duration, width, height |
| `project.attachment_reported` | Renderer report of the actual canonical registry write succeeding or throwing | Outcome, `renderer-reported` provenance, native-derived canonical asset/source IDs |
| `job.terminal` | Native, after a persisted transition to completed, failed or cancelled | Status |

There is no combined `sendCount`. A worker commitment, a returned DOM invocation and acceptance proof are separate facts. `threw_unknown` never means “not sent.” No await was inserted between the final existing submit guard and the click. Transfer completion does not assert valid video. Existing-output checks, digest checks, local restart finalization and attachment do not manufacture acquisition events. A real second transfer or submit call gets a new occurrence.

There are no cancellation, reconciliation, chunk, progress, heartbeat, polling, rendering or analytics events. Coverage checkpoints are journal metadata, not additional event types.

## Extension witnesses and delivery

Extension 0.3.17 advertises `executionAuditVersion = 1`. Its worker/content markers are `muse-worker-v0-3-17-contract3-receipt2-manual1-audit1` and `muse-content-v0-3-17-contract3-receipt2-manual1-audit1`. Contract 3, Receipt V2, manualRecoveryVersion 1 and Chrome permissions are unchanged. The optional first-interaction failure diagnostic is documented in [MUSE_INTERACTION_DIAGNOSTICS.md](MUSE_INTERACTION_DIAGNOSTICS.md); it adds no audit event or coverage change.

The shared extension module has a separate `execution-audit-v1:` storage namespace, up to 16 retained streams per source, 32 occurrences / 24 KiB per stream, source epochs/cursors, and stable occurrence IDs across delivery. Audit aliases are random and memory-only mappings from private capabilities; alias exhaustion also marks a gap. A bounded routing record contains only the tab ID and audit ID for telemetry delivery. Routing and buffer state are never consulted by execution.

Native puts prospective job/audit identity on the command **envelope**, outside all execution/receipt payloads. Once per prospective job/worker epoch, optional telemetry setup opens worker/content source checkpoints. Setup is fire-and-forget: poll calls `execute(c)` without waiting for binding, route storage, content binding, or drain. After the existing authoritative invoked-intent write succeeds, the worker records `submit.committed` without awaiting witness persistence and immediately continues toward content delivery. The 500 ms setup and 250 ms witness watchdogs run only in the background and damage coverage on timeout; they never release, retry, or cancel execution. A background telemetry drain shares the existing rendezvous and authenticated loopback transport, never a provider action. The new `/v1/audit` endpoint checks session authentication, a registered tab, prospective job/audit identity and the existing operation record's pinned instance/tab before ingesting bounded worker/content records. It does not execute commands.

Worker and content observations arriving before binding finishes use a telemetry-only memory queue: at most 16 jobs per source and 32 validated occurrences per job. Successful initial checkpoint persistence flushes queued observations into the normal witness stream. It never sends a provider command. Overflow or failed binding discards only telemetry and marks a sticky gap where possible; exhausting the job bound conservatively gaps subsequent bindings. A process loss before the first durable checkpoint leaves that source missing, with partial coverage and unknown totals, never a known zero. Existing persisted but unclosed epochs retain the restart-gap behavior. No queue is consulted by execution, receipt, intent, acquisition, or recovery decisions.

After content binding acknowledges, background setup reads the existing invoked intent only to assess telemetry continuity. If invocation was already committed, setup conservatively marks a gap, even when queued witnesses subsequently arrive. This prevents an empty rebinding after process/document loss from certifying a lost witness as zero. That read and its outcome never gate or choose a provider action.

Events are removed only after native validation and successful journal persistence acknowledge their IDs. Events created during an in-flight delivery remain queued. Duplicate ID + identical payload is idempotent; different payload marks an integrity gap. Different IDs count as different occurrences, even for the same job/type. Older identical open checkpoints are harmless replay.

Source closure is requested only from an existing terminal job status and honored only while the source has no execution callback running. Closure must itself reach the native journal in a later persisted checkpoint. A prior worker/content epoch left open on restart is drained as gapped, never silently adopted as complete. Witness draining restores no DOM capability, ownership state or provider command.

## Coverage and reports

`desktopAPI.getGenerationExecutionAudit(jobId)` calls a narrow read-only native report. No file path is returned. No generic append IPC exists.

| State | Meaning |
| --- | --- |
| `not_recorded` | Historical job has no prospective marker; counters are null |
| `unavailable` | Marked job's journal is missing, corrupt, unsafe or unreadable; counters are null |
| `partial` | Sources are open/missing, events may be lost, capacity was exceeded, storage failed, or an integrity/sequence/epoch gap exists |
| `complete` | Required source epochs have contiguous persisted cursors and closure, a terminal fact exists, and no sticky gap exists; completed jobs also require the successful attachment report stream |

Counters and outcome/mode/status dimensions have `{recorded, total}`. `recorded` is a lower bound. `total` is **null** unless coverage is complete. Thus an incomplete run with one witnessed click reports `{recorded: 1, total: null}`, and a missing manual witness reports `{recorded: 0, total: null}`. It must never be displayed as an exact zero. Complete automatic runs can report exact zeros for manual sessions, reveals, confirmations and user-confirmed transfers. Coverage is scoped to this journal's persisted source closures, not a promise about unobserved future activity or externally erased/tampered evidence.

The schema is provider-neutral; the full adapter observation set currently belongs to Muse. Other adapters receive prospective admission/terminal telemetry but retain `unsupported_observers` partial coverage until their actual boundaries have observers. Unsupported observations are never reported as exact zeros.

## Project authority and failures

The canonical Project registry stays in the renderer. The existing write receives a passive optional observer; no-op attachment observations emit nothing. The report runs immediately after `writeRegistry`, before projection/presentation, or in that write's catch for an actual persistence failure. Failures in presentation, pre-validation or a preceding unrelated flush do not masquerade as attachment-write failures.

`reportGenerationAttachment({jobId, outcome, reportId})` accepts only that fixed shape from the existing trusted IPC sender. `reportId` is an audit-only occurrence UUID, retained across report redelivery. Native validates the existing completed/verified job and derives project/scene binding plus `generation:<jobId>` and `generation-source:<jobId>`; it accepts no overrides. It records source `renderer` and provenance `renderer-reported`. A future forensic report must independently corroborate the persisted registry. The audit never attaches media or becomes registry authority.

Audit write/rename/fsync failures and observer exceptions cannot fail, retry, cancel, acquire or detach anything. Sticky partial coverage is saved where possible; otherwise missing/corrupt evidence is unavailable or an unclosed epoch prevents complete coverage after restart. Existing authoritative job saves, send intents/tombstones, receipts, manual confirmations, verified-output evidence and registry persistence retain their existing failure behavior. No historical audit is synthesized after a crash.

Crash interpretation: after worker commitment, content invocation may remain unknown; after a click or reveal, a persisted witness survives a lost response; after confirmation, existing resolution persistence still governs recovery; during transfer, a start may exist without completion; after verified publication, attachment may remain pending/unrecorded. No absent event alone proves failure. Draining never retries generation or restores recovery capabilities.

## Privacy and deterministic validation

Both schemas allow only fixed fields and enums, existing app UUIDs, audit UUID aliases, evidence digests and verified output facts. They reject prompts, message text/IDs, URLs/blob URLs, selectors/nodes, credentials/tokens, observation tokens, candidate capabilities and arbitrary paths. Full receipts stay in their existing authority store; only their digest/version enters this journal.

Run **`node dev/run-execution-audit.js`** (or `npm run dev:execution-audit`). It runs the deterministic focused suite, then both automatic and manual flows using virtual extension/provider documents, a real locally generated MP4, native probing, the shared acquisition path, actual Project registry code and persisted-registry corroboration. It uses isolated temp storage and sends zero live Muse requests. It covers delivery replay, sequence gaps, worker/content restart, disk failures, corrupt journals, overflow, attachment replay and forged payloads. DEV files/tests are excluded from the packaged app; the runner rejects production/Electron use. There is no production fixture flag or fixture IPC.
