# Viral AI Tool — Windows Code Signing

Stable Windows releases are intentionally blocked until a valid code-signing certificate is configured.

## Why this is required

A public commercial Windows installer should be signed so Windows can verify:

- who published the app;
- that the installer was not modified after signing;
- that the packaged executable matches the signed publisher identity.

The release workflow checks Authenticode for both:

- the NSIS installer;
- packaged `Viral AI Tool.exe`.

## GitHub repository secrets

The Windows release workflow expects:

```text
WINDOWS_CSC_LINK
WINDOWS_CSC_KEY_PASSWORD
```

Do not commit certificate files or passwords to the repository.

## Using a PFX / P12 certificate

Electron Builder accepts a certificate payload through `CSC_LINK`.

A practical GitHub Actions setup is to store the certificate as Base64 in the secret.

### PowerShell — convert PFX to Base64

Run locally on a trusted machine:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("C:\secure\certificate.pfx")
[Convert]::ToBase64String($bytes) | Set-Clipboard
```

Paste the result into the GitHub Actions secret:

```text
WINDOWS_CSC_LINK
```

Store the PFX password separately as:

```text
WINDOWS_CSC_KEY_PASSWORD
```

After saving, clear the clipboard.

## GitHub UI

Repository:

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

Create:

1. `WINDOWS_CSC_LINK`
2. `WINDOWS_CSC_KEY_PASSWORD`

Only users who should be allowed to publish releases should have permission to change release secrets.

## Certificate requirements

Before using the certificate for Stable release, confirm:

- certificate is intended for Windows code signing;
- certificate has not expired;
- private key is available;
- publisher/organization name is correct;
- certificate chain is trusted;
- timestamp signing is supported by the signing provider/toolchain.

If using an EV/cloud-HSM certificate, setup may differ from PFX-based signing. Keep the workflow signing gate, but adapt the signing integration to the provider rather than exporting a private key if the provider prohibits export.

## Validation build versus Stable tag

Normal `master` validation builds may be unsigned.

They still test:

- NSIS packaging;
- installer install;
- app startup;
- uninstall;
- packaged ASAR contents;
- update manifest;
- SHA-256 checksums.

A tagged Stable release is stricter.

It must pass:

- signing secrets present;
- Authenticode installer status = `Valid`;
- Authenticode app executable status = `Valid`.

## Release flow

Once the signing secrets are configured and all other release gates are complete:

1. Confirm current `master` is the intended release commit.
2. Confirm `package.json` is `0.14.0`.
3. Confirm Backend State workflow is green.
4. Confirm Windows Release branch validation is green.
5. Create tag:

```text
v0.14.0
```

The workflow will verify:

- tag matches package version;
- tag commit equals current `master`;
- code-signing secrets exist;
- release tests pass;
- installer builds;
- app starts;
- signatures are valid;
- release manifest validates;
- SHA-256 is generated;
- GitHub Release assets are uploaded.

## Do not bypass the signing gate

Do not remove the signing requirement simply to publish faster.

If signing is not ready, continue distributing only internal/validation artifacts. A public Stable commercial release should wait.

## Secret hygiene

- Never paste the certificate password into issues, chat logs, source files or workflow YAML.
- Never commit the PFX/P12 certificate.
- Rotate/revoke credentials if exposure is suspected.
- Restrict repository and Actions permissions.
- Prefer organization secret management or an external secret manager for larger production deployments.
