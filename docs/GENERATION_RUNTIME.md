# Generation runtime foundation (2A)

The production provider registry is intentionally empty: there is no executable
AI video provider in this repository yet. Account login, speech readiness and model
catalog presence do not establish generation readiness. No simulated success adapter
ships with the application.

GenerationService owns request validation, model routing, cost estimates,
idempotency, lifecycle transitions and a versioned atomic store under
`userData/generation`. Generation jobs reference the durable project and optional
Scene Plan scene ID, but remain separate from the Scene Plan v3 project snapshot.

## Lifecycle

The durable lifecycle is:

```text
queued
  -> preparing
  -> submitting
  -> running
  -> verifying
  -> completed
```

Terminal/exception states are:

```text
failed
cancelling -> cancelled
interrupted
```

`cancelled != failed` and `interrupted != failed`.

On restart:

- `queued` is retained but is not automatically dispatched;
- `preparing`, `submitting`, `running`, `verifying`, and `cancelling` become
  `interrupted`;
- terminal jobs are retained unchanged.

A retained queued job or interrupted remote job only resumes after explicit
`recover()`. The application never silently resubmits uncertain provider work.
This prevents duplicate generation and duplicate billing.

## Request and provider boundary

Only normalized text-to-video requests execute in 2A. The request contract already
carries project/scene identity, model strategy, optional model ID, aspect ratio and
trusted asset IDs so later Scene Planner integration does not require a new job
schema. Raw file paths, provider URLs, credentials and arbitrary provider settings
are rejected at the renderer/IPC boundary.

Native provider adapters implement the explicit contract in
`provider-contract.js` and are registered through `provider-registry.js`.
Provider readiness is sanitized to `ready`, `not_configured`, `unavailable`, or
`error`. Credentials, authorization headers, raw provider responses and remote
secrets never cross into the renderer or project snapshot.

Every provider submission uses durable job identity for idempotency. Provider
output is not published until the service verifies output containment, regular-file
status and the expected MP4 signature. Invalid output fails verification instead of
creating a generated asset placeholder.

## Persistence and security

The store writes through a temporary file before rename. Recorded generation cost
estimates are retained as historical snapshots rather than recalculated with future
pricing. Sanitized attempts, timestamps, output metadata and safe error codes survive
restart; secrets do not.

IPC validates the owning BrowserWindow, main frame, exact local renderer URL and
payload shape. The bridge exposes only fixed generation channels for readiness,
submit, list, get, cancel, retry and recover.

The AI Create workspace enables Generate only when a durable project exists, the
brief is valid, a route exists, the provider is registered and native readiness says
that provider is truly ready. There is no renderer polling loop, fake progress, fake
job ID or fake generated asset.

2A intentionally does not include a real provider adapter, credit settlement,
Scene Planner batch asset orchestration, or insertion of generated assets into the
Media Engine. Those belong to the next generation-runtime block.
