# Windows release runbook

This runbook is the release procedure for Viral AI Tool Windows builds.

## Release channels

- **Branch validation / Preview build**: generated from `master` when release-related files change. It is uploaded only as a GitHub Actions artifact and is not published as a public GitHub Release.
- **Stable release**: generated only from a tag matching the package version, such as `v0.14.0`.

Stable tags are intentionally blocked unless signing, production Cloud, and billing readiness gates are satisfied.

## GitHub repository configuration

### Required Actions secrets for Stable

```text
WINDOWS_CSC_LINK
WINDOWS_CSC_KEY_PASSWORD
```

`WINDOWS_CSC_LINK` must contain the Windows code-signing certificate accepted by electron-builder. Keep the certificate and password in GitHub Actions secrets only.

### Required Actions variables for Stable

```text
PRODUCTION_CLOUD_URL=https://api.example.com
PRODUCTION_BILLING_READY=true
```

Requirements for `PRODUCTION_CLOUD_URL`:

- absolute HTTPS URL
- no username/password in the URL
- `GET /health` must be reachable from GitHub-hosted Windows runners
- health must report:
  - `environment = production`
  - `stateDriver = sqlite`
  - `durableState = true`
  - `shuttingDown = false`

The release workflow also probes `/v1/billing/catalog`. A backend that still returns `BILLING_PROVIDER_NOT_CONFIGURED` is rejected.

`PRODUCTION_BILLING_READY=true` is an explicit operator acknowledgement that the real production billing adapter has been configured and tested.

### Optional Preview variable

```text
PREVIEW_CLOUD_URL=https://preview-api.example.com
```

When present, branch-validation installers embed this URL. When absent, Preview artifacts remain useful for Local/on-device testing and developers can configure Cloud manually in developer mode.

## What gets embedded into the app

GitHub Actions rewrites `release-info.json` before packaging with:

- channel
- commit SHA
- build timestamp
- update manifest URL
- release page URL
- Cloud backend URL

Stable packaged builds treat the embedded Cloud backend as locked configuration. A normal end user cannot replace the production endpoint from the app UI.

For debugging a packaged build, a developer can explicitly start it with:

```text
VIRAL_AI_DEV_MODE=1
```

and then override the endpoint through Developer settings.

## Pre-tag checklist

Before creating a Stable tag:

1. `master` must contain the intended release commit.
2. **Backend State** workflow must be green.
3. **Windows Release** branch-validation workflow must be green.
4. Production backend must be deployed behind HTTPS.
5. Production backend health must report production + SQLite durable state.
6. Real production billing provider must be connected and tested.
7. `PRODUCTION_BILLING_READY` must be `true`.
8. Windows code-signing secrets must be configured.
9. Package version and intended tag must match exactly.
10. Review `CHANGELOG.md`.

## Create the Stable release

For version `0.14.0`:

```bash
git checkout master
git pull --ff-only
git tag -a v0.14.0 -m "Viral AI Tool v0.14.0"
git push origin v0.14.0
```

The tag workflow then verifies:

- tag is the current `master` commit
- tag equals `v<package.json version>`
- version is a Stable `X.Y.Z` version
- signing secrets exist
- production Cloud URL is valid
- production backend health is valid
- billing readiness is enabled
- runtime dependency audit passes
- backend persistence/restart/production tests pass
- release/update/diagnostic privacy tests pass
- Windows icon assets pass
- installer builds
- packaged ASAR contains required release files
- silent install/startup/uninstall smoke test passes
- Authenticode signatures are valid
- release manifest and SHA-256 checksums validate

Only after those checks does GitHub create the public Release and upload artifacts.

## Expected Stable artifacts

A Stable GitHub Release includes:

```text
Viral AI Tool-<version>-x64.exe
Viral AI Tool-<version>-x64.exe.blockmap
latest.yml
SHA256SUMS.txt
RELEASE-MANIFEST.json
```

The desktop updater uses `RELEASE-MANIFEST.json` and verifies the declared size and SHA-256 before allowing the installer to launch.

## If a tag workflow fails

Do not force-upload files manually to a partially failed Stable release.

Fix the root cause on `master`, bump the version if release artifacts have already been publicly distributed, and create a new tag. For a tag that failed before any public release was created, follow your repository's release policy before deciding whether to recreate the tag.

## Current v0.14.0 status

The unsigned branch-validation installer already passes:

- runtime dependency audit
- backend durable state tests
- restart/session integration tests
- production SQLite integration tests
- release policy tests
- update client verification tests
- diagnostic privacy tests
- packaged ASAR checks
- Windows silent install/startup/uninstall smoke test
- generated manifest validation

A public Stable `v0.14.0` should not be created until the production Cloud/billing and Windows signing requirements above are configured.
