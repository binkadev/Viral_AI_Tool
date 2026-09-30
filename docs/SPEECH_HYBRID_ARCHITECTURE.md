# Hybrid Speech Architecture

Status: Production direction
Updated: 2026-09-30

## Product modes

Customer-facing choices:

- **Trên máy / On-device**
- **Cloud**

Do not expose provider or engine names in normal product UI.

## Shared result contract

Both local and cloud speech must return the same normalized shape:

```json
{
  "version": 1,
  "language": "vi",
  "duration": 98.2,
  "text": "...",
  "segments": [
    {
      "id": "segment-1",
      "start": 1.2,
      "end": 3.4,
      "text": "...",
      "speaker": null,
      "words": []
    }
  ],
  "meta": {
    "providerMode": "local",
    "timingAvailable": true,
    "createdAt": "ISO-8601"
  }
}
```

The renderer must not branch on provider-specific response formats.

## Local flow

1. Validate source video.
2. Verify the source contains audio.
3. Check local AI model state.
4. Check local runtime state.
5. Prepare temporary mono 16 kHz audio.
6. Run recognition in a separate worker process.
7. Normalize transcript/timing.
8. Persist result in application state.
9. Delete temporary audio.
10. Keep original media untouched.

### Local model requirements

- Download only after explicit user action.
- Resume partial downloads when possible.
- Pin model revision.
- Verify expected file sizes.
- Verify SHA-256 checksums.
- Write manifest atomically only after full verification.
- Do not remove a model while recognition or download is active.
- Allow the user to remove model data later.
- Model removal must not remove projects, videos, or completed transcripts.

## Cloud flow

The production desktop app must **not** contain third-party provider API secrets.

Required architecture:

```text
Viral AI Tool Desktop
        |
        | HTTPS + authenticated session
        v
Viral AI Backend
        |
        +-- account / plan / quota
        +-- idempotency
        +-- upload authorization
        +-- job state
        +-- billing ledger
        +-- provider secrets
        |
        v
Speech Provider
```

## Cloud consent

Before any media-derived content leaves the device, the user must be told:

- what is sent;
- why it is sent;
- estimated usage;
- whether it consumes allowance/credits.

Do not silently fall back from local to cloud.

## Cloud upload principle

Prefer:

```text
video -> extract audio locally -> upload audio
```

over uploading the entire video when video pixels are not required.

Temporary cloud media must have a documented retention policy before commercial release.

## Cloud job idempotency

Every cloud speech job must have a client-generated idempotency key.

Retrying:
- job creation,
- result polling,
- transient network calls

must not create a second billable recognition task.

A successful provider result that has not yet reached the desktop must be retrievable without charging again.

## Cloud state machine

```text
idle
 -> validating
 -> consent
 -> preparing
 -> uploading
 -> queued
 -> processing
 -> completed

any active state
 -> cancelling
 -> cancelled

any active state
 -> failed
```

Cancellation and failure are different states.

## Billing guardrails

Recommended commercial behavior:

- On-device recognition: 0 usage minutes.
- Cloud recognition: charge according to actual service rules.
- Show estimated usage before confirmation.
- Server is the source of truth for balance.
- Desktop must never independently decide final billing.
- Idempotency key prevents duplicate charges.
- Failed preflight and failed upload before provider acceptance: no charge.

## Error isolation

Desktop receives stable product error codes, for example:

- SOURCE_MISSING
- NO_AUDIO
- CLOUD_AUTH_REQUIRED
- CLOUD_QUOTA_EXCEEDED
- CLOUD_UPLOAD_FAILED
- CLOUD_UNAVAILABLE
- DUPLICATE_ACTIVE
- CANCELLED

The backend/provider raw error must not be displayed directly to customers.

## Security

- HTTPS required outside localhost development.
- Never persist provider API keys in the Electron renderer.
- Never expose provider secrets through preload IPC.
- Validate all file paths and job IDs at the native boundary.
- Limit upload types and sizes.
- Add server-side authorization for every job/result endpoint.
- User A must never be able to fetch User B's job by guessing an ID.

## Commercial release checklist

Cloud speech is not production-ready until:

- authentication exists;
- quota/billing rules exist;
- privacy/retention policy is defined;
- upload limits exist;
- idempotency exists;
- job ownership is enforced server-side;
- retries are bounded;
- cancellation behavior is defined;
- provider outages have customer-safe messaging;
- telemetry avoids storing transcript content by default;
- legal/provider license terms have been reviewed.


## Backend contract

The executable desktop contract is documented in:

`docs/cloud-speech.openapi.yaml`

Idempotent recovery requirement:
- retrying an uncertain Cloud job must reuse the same client job id;
- the backend may return an existing job in `awaiting_upload`, `uploaded`, `queued`, `processing`, `completed`, `cancelled`, or `failed` state;
- if audio was already uploaded, the backend must not require a second upload;
- if recognition already completed, the existing result may be returned immediately;
- this behavior is required to prevent accidental duplicate billing.
