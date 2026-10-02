# Changelog

All notable product and release-engineering changes are tracked here.

## 0.14.0 — Production hardening & Windows release baseline

### Product

- Added Cloud/Local account and session architecture.
- Added Free, Creator, Creator Pro, and Business plan entitlements.
- Added usage/quota enforcement, concurrent Cloud job limits, and model-tier access.
- Added subscription lifecycle states including trial, active, past due, grace period, cancellation, upgrade, and scheduled downgrade.
- Added provider-neutral billing core, checkout/portal abstractions, invoice history, and signed billing lifecycle events.
- Added secure device/session management with remote session revocation.
- Added localized final render pipeline:
  - translated subtitle timing
  - AI voice timing fit
  - original audio background mix
  - burned subtitles
  - H.264/AAC MP4 output
  - retry/cancel/progress handling

### Reliability & security

- Added durable backend state with SQLite production mode.
- Added atomic development state storage and corrupt-state recovery.
- Added refresh-token hashing and rotation.
- Added audit logging with credential/token redaction.
- Added rate limiting and explicit trusted-proxy handling.
- Added durable job/idempotency receipts and billing write-ahead settlement guards.
- Added restart/session integration tests.
- Added production SQLite integration tests.
- Added graceful backend shutdown handling.
- Disabled development credentials and fake billing routes in production mode.

### Updates & releases

- Added branded Windows installer icon.
- Added deterministic Windows artifact naming.
- Added embedded release metadata and release channels.
- Added release manifest and SHA-256 checksum generation.
- Added verified update download:
  - trusted GitHub release path enforcement
  - size verification
  - SHA-256 verification while downloading
  - SHA-256 verification again immediately before launch
  - stale installer cleanup
- Stable builds cannot switch themselves to Preview updates.
- Stable update manifests reject prerelease versions.
- Update installation is blocked while AI/render/model work is active.
- App exits cleanly after handing off to the verified Windows installer.
- Added Windows installer silent install/uninstall smoke tests.
- Added release-readiness and Windows icon structure regression tests.
- Tagged Stable releases require Windows code-signing secrets.

### Release status

The unsigned branch-validation Windows artifact is buildable and installable.

A public Stable tag should only be created after:

- Windows code-signing credentials are configured.
- Production backend is deployed behind HTTPS.
- A real production billing provider is connected for paid public launch.
- The packaged app has been smoke-tested on a clean Windows user machine.
