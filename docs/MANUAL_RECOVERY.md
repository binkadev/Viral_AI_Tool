# Prospective user-confirmed recovery v1

Admission alone sets `manualRecovery: {version: 1, eligible: true}` on new Muse jobs. Loading never supplies this marker. Automatic receipts, attempts, send intent and operation files remain evidence of the automatic path.

Manual lifecycle: interrupted → confirmed (durable outputResolution, still interrupted) → verifying → completed. Failure returns to interrupted and preserves the interrupted automatic attempts. No retry attempt is created. A failed confirmation write cannot authorize transfer. A verified-output write must succeed before exclusive publication and completion. Project attachment remains a separate existing operation.

One retained live context and one ephemeral selection session are allowed. Discovery is an explicit UI command; it reads mounted videos in the retained container only. More than eight eligible blob candidates fails closed. A two-minute session binds unpredictable IDs, document/worker epoch, instance/tab, job/operation/project/scene, exact node references, private source descriptors and metadata. Reveal in the pinned Muse tab must acknowledge the exact revision before confirmation. Mutation, navigation, replacement, activity, expiry and disconnect revoke the entire session. Capabilities never enter durable storage or Project snapshots.

Resolution v1 stores provider-neutral binding, audit hashes, the immutable automatic evidence digest, confirmation time, transfer identity, verified bytes/metadata and publication phase. Restart never reacquires a browser candidate. Completed local outputs use the normal digest-checked Project/Studio restore path. Unfinished resolutions remain interrupted; a user must explicitly rediscover. Dismissal revokes local selection and leaves automatic evidence untouched.

`outputResolution` is validated on save and load. Its fields are `version`, `resolutionId`, `mode`, `automaticOwnershipVerified`, `jobId`, `operationId`, `projectId`, `sceneId`, `automaticOutcome`, `automaticEvidenceHash`, `candidateAuditId`, `selectionSessionId`, `documentContextDigest`, `candidateDescriptorHash`, `confirmedAt`, `phase`, `transferId`, optional `verified: {fileName, size, sha256, media: {duration, width, height}}`, and `publication`. Unknown fields and unsupported versions fail closed. Candidate audit identifiers cannot reconstruct a live capability.

The browser and native resolvers share the existing bounded reader and acquisition implementation: 196,608-byte chunks, 256 MiB maximum, sequential offset/sequence checks, per-chunk SHA-256, five-minute total transfer bound, existing idle/command timeouts, partial-file cleanup, MP4 header/native probing, total size/hash evidence, and exclusive hard-link publication. Automatic resolution still requires the original receipt and owned node checks; manual resolution requires the durable confirmation and current exact-node capability. Neither can select another source during a transfer.

The extension is 0.3.15, with builds `muse-worker-v0-3-15-contract3-receipt2-manual1` and `muse-content-v0-3-15-contract3-receipt2-manual1`. Its separate `manualRecoveryVersion` is 1. Execution contract remains 3; receipt version remains 2; permissions are unchanged.

Run the isolated deterministic validation from the repository root:

```powershell
node dev/run-manual-recovery.js
```

This runs the deterministic recovery tests, seven native verification modes, then two actual Electron processes using one new temporary profile. It simulates Muse; it never sends a live Muse request. The existing Project registry, generated-media controller, native decoding and ordinary Studio preview validate original-project attachment, scene identity, restart and deduplication. DEV modules are excluded from release files and activation is denied for packaged/production apps. Interrupted resolutions with durable verified local output can also finish through explicit local digest/probe checks; this never requests browser bytes.
