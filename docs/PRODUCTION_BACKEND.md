# Viral AI Tool — Production Backend

This document describes the current single-node production baseline for the Viral AI Tool backend.

## Current production guarantees

- Production mode requires the SQLite durable state driver.
- SQLite runs with WAL, FULL synchronous durability, transactions, and a busy timeout.
- Demo credentials are disabled in production.
- The first production account is created only through explicit bootstrap environment variables.
- Raw access tokens, refresh tokens, checkout tokens, portal tokens, and passwords are not written to durable state.
- Refresh sessions survive restart and rotate as one-time tokens.
- Users can review active device sessions and revoke another device.
- Billing webhooks use HMAC signatures, timestamp validation, and replay protection.
- Fake development checkout and billing portal routes are disabled in production.
- Speech job receipts survive restart without persisting Cloud transcripts.
- Translation and Voice keep durable idempotency/billing receipts to reduce double-charge risk.
- Billing settlement uses a write-ahead `settling` marker before quota charging.
- Audit records omit fields that look like passwords, tokens, secrets, authorization headers, or cookies.
- The server handles SIGTERM/SIGINT with a controlled shutdown path.

## Required environment

Use `.env.example` as the reference.

At minimum for the first production boot:

```text
VIRAL_AI_ENV=production
VIRAL_AI_STATE_DRIVER=sqlite
VIRAL_AI_DEV_DATA_DIR=/var/lib/viral-ai-tool
VIRAL_AI_BOOTSTRAP_EMAIL=owner@example.com
VIRAL_AI_BOOTSTRAP_PASSWORD=<long random password>
```

After the first owner account has been created and login has been verified, remove `VIRAL_AI_BOOTSTRAP_PASSWORD` from the deployment environment. Existing accounts are loaded from SQLite on future boots and do not require bootstrap secrets.

## Networking

The backend currently binds to `127.0.0.1` intentionally. Put a production reverse proxy / load balancer in front of it and terminate HTTPS there.

Do not expose the backend process directly to the public Internet.

If the backend is reachable only through a trusted local reverse proxy, set:

```text
VIRAL_AI_TRUST_PROXY=true
```

This allows per-client rate limiting and audit IPs to use the first `X-Forwarded-For` value. Do not enable this when untrusted clients can connect directly to the backend.

## Billing

Development checkout is intentionally unavailable when `VIRAL_AI_ENV=production`.

Until a real provider adapter is connected, billing-management endpoints return:

```text
BILLING_PROVIDER_NOT_CONFIGURED
```

Signed lifecycle events require:

```text
VIRAL_AI_BILLING_WEBHOOK_SECRET=<long random secret>
```

The desktop client cannot grant itself a paid plan.

## Data files

With SQLite production mode, the data directory contains:

- `state.sqlite` — commercial/auth/job receipt state
- SQLite WAL/shm files while the server is running
- `audit.jsonl` — sanitized audit events
- temporary provider upload/output directories where applicable

Back up `state.sqlite` using a SQLite-safe backup procedure. Do not copy only the main database file while the service is actively writing unless the backup tooling accounts for WAL state.

## Restart behavior

- Access tokens are memory-only and disappear on restart.
- Persisted refresh sessions allow the desktop app to obtain a new access token.
- Uploaded Speech work can resume when its temporary source audio still exists.
- Cloud transcript results are not retained by the durable Speech receipt.
- Terminal Translation/Voice billing receipts protect against silently rerunning a charged idempotency key.
- Stale receipts are cleaned periodically.

## CI checks

The `Backend State` workflow runs:

- durable-state regression tests
- restart/session integration tests
- production SQLite integration tests
- syntax checks across backend and desktop auth/render integration files

Before a production release, this workflow should be green on the release commit.

## Not yet production-complete

The current backend is a hardened single-node baseline. Remaining production work includes:

- real payment provider adapter
- external secret manager integration in deployment
- operational monitoring/alerting
- database backup/restore automation
- multi-instance coordination or migration to a shared database if horizontal scaling is required
- final penetration/security review
