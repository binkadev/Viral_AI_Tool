# Viral AI Tool — Release Checklist

This checklist is for a real public Windows Stable release.

## Before tagging

1. Ensure the `Backend State` workflow is green on the intended commit.
2. Ensure the `Windows Release` validation build is green.
3. Confirm the generated Windows artifact installs and launches on a clean Windows machine.
4. Confirm the app shows the expected:
   - version
   - release channel
   - commit
   - build timestamp
5. Confirm Cloud login, local processing, Cloud processing, localized export, billing UI, and update UI work in the packaged build.
6. Confirm `npm audit --omit=dev --audit-level=high` passes.
7. Confirm the production backend is deployed behind HTTPS.
8. Confirm development billing routes are unavailable in production.
9. Confirm backup/restore for production SQLite is available.

## Windows code signing

A tagged Stable release is intentionally blocked unless these repository secrets exist:

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

`WINDOWS_CSC_LINK` should contain the certificate payload or a supported certificate reference understood by electron-builder.

Do not weaken or remove this guard just to make a release pass. An unsigned commercial installer will create avoidable SmartScreen/trust problems.

## Versioning

Stable releases must use:

```text
X.Y.Z
```

Examples:

- `0.14.0`
- `1.0.0`

Prerelease versions such as `0.15.0-beta.1` are rejected by the Stable update policy.

The Git tag must exactly match:

```text
v<package.json version>
```

For version `0.14.0`, the tag is:

```text
v0.14.0
```

## Stable release output

A tagged release produces:

- Windows NSIS installer
- blockmap/update metadata where generated
- `SHA256SUMS.txt`
- `RELEASE-MANIFEST.json`
- GitHub Release notes

The desktop updater only accepts installers that:

- belong to this GitHub repository's release path
- match the expected version/channel
- match manifest size
- match SHA-256 at download time
- match SHA-256 again immediately before launch

## Do not tag yet when

Do not create a Stable tag if any of these are true:

- Windows signing secrets are absent
- Windows validation workflow is red
- backend workflow is red
- production billing provider is not connected for a paid public launch
- production backend is not behind HTTPS
- installer has not been smoke-tested on a clean Windows machine
