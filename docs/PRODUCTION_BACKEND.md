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

## Container deployment baseline

The repository includes a production container baseline under `deploy/`:

- `backend.Dockerfile` — Node 22 backend image running as the non-root `node` user.
- `docker-compose.production.yml` — backend + Caddy HTTPS reverse proxy.
- `Caddyfile` — automatic TLS termination and reverse proxy to the private backend network.
- `.env.production.example` — production environment template.

The backend container is **not** published directly to the host Internet. Only Caddy publishes ports 80/443.

Typical single-server bootstrap:

```bash
cp deploy/.env.production.example deploy/.env.production
```

Edit `deploy/.env.production` and set at minimum:

```text
VIRAL_AI_DOMAIN=api.your-domain.example
VIRAL_AI_BOOTSTRAP_EMAIL=<owner email>
VIRAL_AI_BOOTSTRAP_PASSWORD=<long random first-boot password>
VIRAL_AI_ADMIN_TOKEN=<different random token, at least 32 chars>
VIRAL_AI_OPERATIONS_TOKEN=<different random token, at least 32 chars>
OPENAI_API_KEY=<server-side API key>
```

Then start the stack from the repository root:

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.production.yml \
  up -d --build
```

Point the DNS A/AAAA record for `VIRAL_AI_DOMAIN` at the server before starting Caddy so TLS can be issued.

Verify:

```bash
curl https://api.your-domain.example/health
curl https://api.your-domain.example/ready
```

For a Private Commercial build, `/health` must report:

- `environment = production`
- `stateDriver = sqlite`
- `durableState = true`
- `speechProviderConfigured = true`
- `translationProviderConfigured = true`
- `voiceProviderConfigured = true`
- `adminProvisioningConfigured = true`

After the first owner login succeeds, remove `VIRAL_AI_BOOTSTRAP_PASSWORD` from `deploy/.env.production` and restart the backend. Do not remove the persisted SQLite volume.

## Monitoring and readiness

Use the unauthenticated readiness endpoint for load-balancer or container readiness probes:

```text
GET /ready
```

A ready production instance returns HTTP 200 with:

- `ready = true`
- `environment = production`
- `stateDriver = sqlite`
- `checks.stateReadable = true`
- `checks.shuttingDown = false`

During controlled shutdown or if durable state cannot be read, `/ready` returns HTTP 503.

For deeper operational monitoring, configure a random token of at least 32 characters:

```text
VIRAL_AI_OPERATIONS_TOKEN=<long random token>
```

Then query:

```bash
curl -H "x-viral-ai-ops-token: $VIRAL_AI_OPERATIONS_TOKEN" \
  https://api.example.com/v1/internal/ops/status
```

The protected operations response contains only aggregate technical data:

- uptime
- memory usage
- access/refresh session counts
- Speech/Translation/Voice job counts by state
- provider configured flags
- billing webhook configured flag
- latest backup timestamp, age, size, and integrity marker

It does not include account email, passwords, tokens, Cloud URLs, filesystem paths, video names, transcripts, translations, or generated voice content.

Recommended alerts:

- `/ready` is non-200 for more than 2–5 minutes
- process restarts unexpectedly
- memory grows continuously beyond the deployment limit
- job counts remain stuck in non-terminal states
- required production AI provider is not configured
- billing webhook becomes unconfigured
- latest verified backup age exceeds your recovery objective

Keep the operations token in a secret manager and do not put it in desktop clients, URLs, dashboards, or source control.

## Private Commercial account provisioning

Private Commercial / Early Access does not expose public signup. Accounts are provisioned by the operator through a protected backend endpoint.

Configure a separate random token of at least 32 characters:

```text
VIRAL_AI_ADMIN_TOKEN=<long random token>
```

This token is server/operator-only:

- never embed it in the Electron app;
- never send it to an end user;
- never put it in GitHub source, URLs, logs, or screenshots;
- store it in the deployment secret environment.

Create an account:

```http
POST /v1/internal/admin/users
x-viral-ai-admin-token: <admin token>
content-type: application/json

{
  "email": "user@example.com",
  "password": "<temporary strong password>",
  "name": "Early User",
  "planId": "creator"
}
```

Supported plan IDs are currently:

```text
free
creator
creator_pro
business
```

A successful request creates:

- an independent user ID;
- salted/scrypt password hash;
- active subscription state;
- the plan's monthly quota;
- zeroed usage counters.

The user then signs in through the normal desktop login flow. The admin token is not required by the desktop client.

The endpoint rejects:

- missing/incorrect admin token;
- duplicate email;
- malformed email;
- passwords shorter than 12 characters;
- unknown plan IDs.

Production integration tests verify that provisioned accounts can log in, retain their plan and survive a backend restart.

## Billing

Development checkout is intentionally unavailable when `VIRAL_AI_ENV=production`.

Until a real provider adapter is connected, billing-management endpoints return:

```text
BILLING_PROVIDER_NOT_CONFIGURED
```

The backend exposes a provider-neutral billing readiness contract through `/ready`.

For a paid Stable release, all of these must be true:

- `providerConfigured`
- `checkoutReady`
- `portalReady`
- `invoicesReady`
- `webhookReady`

`VIRAL_AI_BILLING_PROVIDER` names the intended provider adapter, but setting the variable alone does **not** make billing ready. A real adapter must register working capabilities in code.

Signed lifecycle events require:

```text
VIRAL_AI_BILLING_PROVIDER=<provider-id>
VIRAL_AI_BILLING_WEBHOOK_SECRET=<long random secret>
```

The desktop client cannot grant itself a paid plan.

## Data files

With SQLite production mode, the data directory contains:

- `state.sqlite` — commercial/auth/job receipt state
- SQLite WAL/shm files while the server is running
- `audit.jsonl` — sanitized audit events
- temporary provider upload/output directories where applicable

Do not copy only the main database file while the service is actively writing.

### Online backup

The repository includes a SQLite online-backup command:

```bash
VIRAL_AI_DEV_DATA_DIR=/var/lib/viral-ai-tool \
VIRAL_AI_BACKUP_DIR=/var/backups/viral-ai-tool \
VIRAL_AI_BACKUP_KEEP=14 \
npm run backup:state
```

The command:

- uses SQLite's online backup API rather than copying the live WAL database
- runs `PRAGMA integrity_check` on the new backup
- calculates SHA-256
- writes a sidecar JSON manifest
- keeps only the configured number of newest backups

A successful backup produces:

```text
state-backup-YYYYMMDDTHHMMSSZ-xxxxxxxx.sqlite
state-backup-YYYYMMDDTHHMMSSZ-xxxxxxxx.sqlite.json
```

### Verify a backup

```bash
npm run verify:state-backup -- /var/backups/viral-ai-tool/state-backup-....sqlite
```

Verification checks SQLite integrity, required schema, file size, SHA-256, and available state sections.

### Restore procedure

Restore is intentionally not automated into the running service. A restore is destructive and should require an operator decision.

1. Stop the backend cleanly.
2. Verify the selected backup with `verify:state-backup`.
3. Keep the current `state.sqlite`, `state.sqlite-wal`, and `state.sqlite-shm` as an incident copy.
4. Copy the verified backup to a new `state.sqlite` in the configured data directory.
5. Remove stale WAL/SHM files belonging to the old database only after the old database files have been preserved.
6. Start the backend.
7. Check `/health`.
8. Verify account login, subscription state, quota, and recent billing/audit behavior before reopening normal traffic.

Never overwrite the live database while the backend process is running.

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
- external alert delivery/dashboard integration
- off-host backup scheduling and restore-drill automation
- multi-instance coordination or migration to a shared database if horizontal scaling is required
- final penetration/security review
