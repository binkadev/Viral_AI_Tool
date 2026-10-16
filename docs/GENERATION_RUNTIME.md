# Generation runtime foundation (2A)

The production registry is intentionally empty: there is no executable generation
provider in this repository. Account login, speech readiness and catalog presence
never establish generation readiness. No simulated adapters ship with the app.

GenerationService owns routing, cost estimates, idempotency, transitions and a
versioned atomic job store under userData/generation. Jobs are separate from Scene
Plan v3 and project snapshots. IPC validates the owning window, top frame, exact
local document URL and payloads. Raw provider errors are never logged or serialized.

Only normalized text-to-video requests are accepted in 2A. Reference modes require
a trusted media resolver before they can be enabled. Input paths, provider URLs,
credentials, arbitrary settings and provider job identifiers are not accepted.

Adapters are native-only and must implement the contract in provider-registry.js.
Readiness must include real execution configuration; preflight must check relevant
quota, resource and connectivity constraints. Credentials and remote job mappings
belong in native secure storage, never in the request or returned payload. Every
submission uses the durable job ID for provider idempotency. Adapters must verify
output video contents before returning the assigned local filename, and clean
partial outputs before reporting terminal failure or confirmed cancellation.
The service additionally checks output containment, existence and MP4 signature.
No remote URLs, synthetic progress or unverified asset placeholders are published.

On restart, queued/processing/cancelling jobs become recovery_required. The service
never automatically resubmits them. recover invokes adapter reconciliation using
the same durable identity. Unknown outcomes remain blocked, preventing duplicate
billing. Retry is allowed only for confirmed failed/cancelled jobs and requires a
new idempotency key. Store corruption blocks the service without overwriting data.
A failed write prevents dispatch; a failure after dispatch leaves the last durable
active state recoverable. Shutdown uses the existing active-work confirmation and
requests cancellation; unconfirmed remote outcomes remain recoverable on restart.

The IPC bridge exposes status, submit, list, get, cancel, retry and recover. The
workspace refreshes readiness on initialization, app-state events and window focus;
there are no renderer polling or observer loops. There is no provider integration,
credit settlement, asset insertion into scenes or Media Engine modification in 2A.
