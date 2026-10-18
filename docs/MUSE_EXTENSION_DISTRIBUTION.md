# Muse extension distribution

Release configuration lives in `services/generation/bridge/extension-distribution.json` and ships in the application archive. It is build configuration, never a renderer-supplied URL or identity.

- `expectedExtensionVersion`: minimum supported extension version (currently 0.2.0).
- `protocolVersion`: exact supported protocol (currently 1).
- `chromeWebStoreExtensionId`: official 32-character Chrome ID; blank until assigned.
- `chromeWebStoreUrl`: HTTPS chromewebstore.google.com detail URL ending in that same ID; blank until available. Credentials, query strings, fragments, other hosts and mismatched IDs are rejected.
- `distributionMode`: production, development or support. Production enforces the official extension origin when an ID is configured. Development/support permit unpacked IDs while retaining loopback, Host, origin, session-token and payload validation. With no official ID, production retains the existing unpacked bridge protection and explicitly reports store distribution unavailable.

## State contract

Distribution status (`extensionState`) is independent of Muse tab/authentication status (`state`). A fresh compatible connection yields `extension_connected`; missing/expired evidence yields `extension_install_required`. Absence never proves the extension is uninstalled. Copying files never reports an installed or connected extension.

A lower extension version yields `extension_outdated`; a lower explicit protocol yields `extension_update_required`. A newer, malformed or unknown missing protocol yields `extension_error`. These states block Open Muse commands. Released 0.1.0 and 0.2.0 without a protocol field are explicitly mapped to protocol 1; 0.1.0 still needs an update. New workers send protocolVersion: 1. Higher extension versions are compatible only with the supported protocol. Generate remains disabled.

## Installation and recovery

The normal action opens only the validated Web Store listing. Without configuration it is disabled and explanatory VI/EN copy appears. No fake installation or silent installation occurs. A support disclosure contains manual instructions: chrome://extensions ? Developer mode ? Load unpacked ? select the revealed userData/meta-muse-extension folder. An updated unpacked extension must be reloaded by the user, then the Muse tab refreshed.

The reveal action stages only the known bundled files, replaces the manifest last, rejects redirected target directories/files, and leaves Chrome profiles untouched. Incomplete source bundles leave the managed copy untouched. Errors surface through the existing localized connection error; retry is available. Actions are short and do not create jobs or cancellation state. Repeated UI actions are disabled while pending; concurrent store opens coalesce. No installation claim persists: connection evidence expires and is rebuilt after restart. Only the existing selected profile identifier persists.

## Verification

`npm run test:muse-extension` covers real loopback requests, protocol compatibility, official origins, token isolation, store URL validation, manual-folder boundaries, and production archive removal failures. `npm run test:core-commercial` includes these checks and VI/EN settings tests.

`afterPack` runs scripts/verify-muse-package.js: all seven extension files must exist in app.asar and match source bytes; the packaged version contract must match. A broken archive fails packaging.

Opt-in desktop check: clear ELECTRON_RUN_AS_NODE, then run `electron tests/muse-distribution.desktop.js`. This starts the application, waits for an existing Chrome heartbeat without altering its session, and exercises missing-extension status, refusal of an unconfigured store action, and the real manual-folder reveal. It quits the verification app afterwards. Do not run alongside another application instance.

No cookies, passwords, page storage, authentication headers, profile copying, debugging connections, Chrome policies or automated Developer Mode are used.
