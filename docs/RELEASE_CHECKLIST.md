# Viral AI Tool — Release Checklist

This checklist is for a real public Windows Stable release.

## 1. Source and version

- [ ] `package.json` contains the intended Stable version.
- [ ] `package-lock.json` root version matches.
- [ ] `CHANGELOG.md` contains the release entry.
- [ ] Intended release commit is the current `master` commit.
- [ ] No public Stable tag for this version already exists.
- [ ] `Backend State` workflow is green.
- [ ] `Windows Release` validation workflow is green.

Stable versions must use:

```text
X.Y.Z
```

The tag must exactly match:

```text
v<package.json version>
```

For version `0.14.0`:

```text
v0.14.0
```

Do not force-move a published Stable tag.

## 2. Windows identity and code signing

Tagged Stable releases are intentionally blocked unless these GitHub repository secrets exist:

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

Before tagging:

- [ ] Certificate is valid and not expired.
- [ ] Publisher identity is the intended commercial publisher.
- [ ] `assets/icon.ico` passes the release asset test.
- [ ] Application icon looks correct in Explorer, taskbar and Start Menu.

Tagged workflow must report valid Authenticode for:

- [ ] NSIS installer.
- [ ] Packaged `Viral AI Tool.exe`.

Do not weaken the signing guard merely to make a release pass.

## 3. Production backend

- [ ] Production backend is deployed behind HTTPS.
- [ ] `VIRAL_AI_ENV=production`.
- [ ] Production uses the approved durable state driver.
- [ ] SQLite backup/restore procedure is available for the current single-node baseline.
- [ ] Production owner bootstrap has completed.
- [ ] Bootstrap password has been removed from the deployment environment.
- [ ] `VIRAL_AI_TRUST_PROXY=true` is enabled only when traffic reaches the backend exclusively through the trusted proxy.
- [ ] Audit log retention/rotation is understood.
- [ ] Health endpoint is monitored.
- [ ] Restart/session integration behavior has been verified.

## 4. Billing

For a paid public launch:

- [ ] Real billing provider adapter is connected.
- [ ] Production `/ready` reports `releaseReady: true`.
- [ ] Billing readiness reports `providerConfigured: true`.
- [ ] Billing readiness reports `checkoutReady: true`.
- [ ] Billing readiness reports `portalReady: true`.
- [ ] Billing readiness reports `invoicesReady: true`.
- [ ] Billing readiness reports `webhookReady: true`.
- [ ] Development checkout/portal is unavailable in production.
- [ ] Billing webhook secret is stored in the production secret manager.
- [ ] Signed lifecycle webhook has been tested.
- [ ] Upgrade has been tested.
- [ ] Scheduled downgrade has been tested.
- [ ] Cancel/resume has been tested.
- [ ] Payment failed → grace-period behavior has been tested.
- [ ] Invoice history reflects provider records.

If public billing is intentionally not launched yet, purchase UI must not imply that real payment is available.

## 5. Automated release tests

Run the source-level preflight first:

```text
npm run release:preflight
```

This command checks version/lockfile/changelog/icon/release metadata and the core release-policy/update/privacy tests in one pass. It does not replace external Stable checks such as Windows signing, production HTTPS/backend readiness, real billing readiness, or a clean-machine installer smoke test.

The intended release commit must pass:

```text
npm run test:backend-state
npm run test:backend-restart
npm run test:backend-production
npm run test:release-policy
npm run test:release-assets
npm run test:release-readiness
npm run test:generated-manifest
```

Also confirm:

- [ ] `npm audit --omit=dev --audit-level=high` passes.
- [ ] Verified updater regression tests pass.
- [ ] Generated release manifest is accepted by the same policy used inside the app.

## 6. Windows artifact validation

Validation build must pass:

- [ ] Locked dependency install.
- [ ] NSIS packaging.
- [ ] Silent installer.
- [ ] Installed ProductVersion validation.
- [ ] Installed application startup smoke test.
- [ ] Silent uninstaller.
- [ ] Release manifest generation.
- [ ] Release manifest validation.
- [ ] SHA-256 generation.
- [ ] Artifact upload.

Expected artifacts include:

- Windows installer `.exe`
- blockmap/update metadata when generated
- `SHA256SUMS.txt`
- `RELEASE-MANIFEST.json`

## 7. Clean Windows machine smoke test

Before the first public Stable release, test on a clean Windows user/VM that has not run the development build.

Confirm:

- [ ] Installer opens normally.
- [ ] No unexpected administrator elevation is requested.
- [ ] Branding/icon is correct.
- [ ] Application launches.
- [ ] Window size/layout is correct.
- [ ] File picker works.
- [ ] A local video can be imported.
- [ ] Local processing works.
- [ ] Production Cloud login works.
- [ ] Account/session management works.
- [ ] Cloud Speech/Translation/Voice behave correctly.
- [ ] Localized render produces a playable MP4.
- [ ] Settings shows correct version/channel/commit/build timestamp.
- [ ] Uninstaller completes.
- [ ] User-owned source videos remain untouched.

## 8. Private Commercial / Early Access

When Windows code-signing credentials are not available yet, run **Windows Release** manually from GitHub Actions on `master` with:

```text
stable_candidate = false
private_commercial = true
```

This mode intentionally keeps Windows signing disabled while embedding and validating the real production Cloud backend. It is intended for private commercial/early-access users before the public signed Stable launch:

- [ ] Current commit is the latest `master`.
- [ ] `PRODUCTION_CLOUD_URL` exists and is valid HTTPS.
- [ ] Production `/health` responds and reports production + durable SQLite state.
- [ ] Cloud Speech, Translation and Voice providers report configured.
- [ ] Production `/ready` responds with `ready=true`.
- [ ] Automated billing may remain unavailable for this private build; accounts/plans must be provisioned explicitly until public billing is connected.
- [ ] Normal release-policy, backend, updater, diagnostics, Cloud-config and render tests pass.
- [ ] Unsigned Windows installer builds and passes install/launch/uninstall smoke test.
- [ ] Preview/internal artifact uploads successfully.
- [ ] No tag or GitHub Release is created.

The resulting artifact is an unsigned private-commercial build. It may use real production Cloud APIs and real account/quota enforcement, but Windows may show an Unknown publisher/SmartScreen warning. It is not the public signed Stable release and does not replace the later signed Stable Candidate run.

## 9. Stable Candidate dry run

Before creating the first Stable tag, run **Windows Release** manually from GitHub Actions on `master` with:

```text
stable_candidate = true
```

This dry run intentionally does **not** create a tag or GitHub Release. It must exercise the production-only guards first:

- [ ] Current commit is the latest `master`.
- [ ] Windows signing secrets are available.
- [ ] `PRODUCTION_CLOUD_URL` is valid HTTPS.
- [ ] `PRODUCTION_BILLING_READY=true`.
- [ ] Production `/health` and `/ready` checks pass.
- [ ] Production billing readiness contract passes.
- [ ] Installer and packaged application have valid Authenticode signatures.
- [ ] Live updater publisher/signature rule passes.
- [ ] Stable-shaped release metadata and manifest validation pass.
- [ ] Stable Candidate artifact is uploaded for inspection.

Do not create `v0.14.0` until this dry run is green.

## 10. Stable tag workflow

Only create the Stable tag after all mandatory items above pass.

The tagged workflow must enforce:

- tag version == package version
- package version is non-prerelease `X.Y.Z`
- tag commit == current `master`
- Windows signing secrets exist
- installer/application Authenticode signatures are valid
- generated manifest passes app update policy

## 11. Published release verification

After GitHub Release is created:

- [ ] Installer is attached.
- [ ] `SHA256SUMS.txt` is attached.
- [ ] `RELEASE-MANIFEST.json` is attached.
- [ ] Release notes are correct.
- [ ] Release was assembled as a draft and published only after all required assets uploaded successfully.
- [ ] A rerun cannot replace assets on an already published Stable release.
- [ ] Manifest installer URL points to this exact tagged release.
- [ ] SHA-256 in manifest matches the uploaded installer.
- [ ] Release page opens from the app.

## 12. Update verification

From the previous Stable build:

- [ ] Check for updates discovers the new Stable version.
- [ ] Preview is not offered to Stable users.
- [ ] Installer downloads successfully.
- [ ] Download size matches manifest.
- [ ] SHA-256 validation succeeds while downloading.
- [ ] SHA-256 validation succeeds again before installer launch.
- [ ] Update is blocked while AI/render/model work is active.
- [ ] Verified installer opens.
- [ ] Old app exits cleanly.
- [ ] Updated app reports the new Stable version.

## 13. Rollback and incident readiness

Before publishing:

- [ ] Previous Stable installer is retained.
- [ ] Production database backup exists.
- [ ] Backend rollback/restore procedure is known.
- [ ] Release owner is identified.

If a release is defective:

1. Stop promoting the defective release.
2. Keep the published tag immutable for traceability.
3. Fix forward with a new patch version.
4. Restore backend data only through the tested backup/restore procedure if needed.
5. Document the incident/fix in the changelog and release notes.

## Do not tag yet when

Do **not** create a Stable tag if any of these are true:

- Windows code-signing secrets are absent.
- Windows validation workflow is red.
- Backend workflow is red.
- Production backend is not behind HTTPS.
- Real billing provider is not connected for a paid public launch.
- Installer has not been smoke-tested on a clean Windows machine.
