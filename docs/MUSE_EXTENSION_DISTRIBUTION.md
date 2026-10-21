# Muse extension distribution

Release configuration lives in `services/generation/bridge/extension-distribution.json` and ships in the application archive. It is build configuration, never a renderer-supplied URL or identity.

- `expectedExtensionVersion`: minimum supported extension version (currently 0.3.6).
- `expectedWorkerBuild` / `expectedContentBuild`: version-specific executing markers required by controlled diagnostic preflight; staged bytes alone cannot prove runtime identity.
- `protocolVersion`: exact supported protocol (currently 1).
- `chromeWebStoreExtensionId`: official 32-character Chrome ID; blank until assigned.
- `chromeWebStoreUrl`: HTTPS chromewebstore.google.com detail URL ending in that same ID; blank until available. Credentials, query strings, fragments, other hosts and mismatched IDs are rejected.
- `distributionMode`: production, development or support. Production enforces the official extension origin when an ID is configured. Development/support permit unpacked IDs while retaining loopback, Host, origin, session-token and payload validation. With no official ID, production retains the existing unpacked bridge protection and explicitly reports store distribution unavailable.

## State contract

Distribution status (`extensionState`) is independent of Muse tab/authentication status (`state`). A fresh compatible connection yields `extension_connected`; missing/expired evidence yields `extension_install_required`. Absence never proves the extension is uninstalled. Copying files never reports an installed or connected extension.

A lower extension version yields `extension_outdated`; a lower explicit protocol yields `extension_update_required`. A newer, malformed or unknown missing protocol yields `extension_error`. These states block Open Muse commands. Released 0.1.0 and 0.2.0 without a protocol field are explicitly mapped to protocol 1; both legacy versions need an update. New workers send protocolVersion: 1. Higher extension versions are compatible only with the supported protocol. Generation also requires execution contract 3, receipt capability 2, a selected authenticated ready tab and the native verifier; version compatibility alone never enables it.

## Installation and recovery

The normal action opens only the validated Web Store listing. Without configuration it is disabled and explanatory VI/EN copy appears. No fake installation or silent installation occurs. A support disclosure contains manual instructions: chrome://extensions ? Developer mode ? Load unpacked ? select the revealed userData/meta-muse-extension folder. An updated unpacked extension must be reloaded by the user, then the Muse tab refreshed.

The reveal action validates and reads all nine known bundled files first, including the pure acceptance replay module, writes a complete sibling bundle with its manifest last, and verifies every byte before and after directory publication. The old directory is retained for rollback until publication succeeds. Incomplete sources and write failures leave the managed copy untouched; failed publication restores the old bundle or leaves execution safely unavailable. Redirected ancestors/directories/files and unexpected entries are rejected. Chrome profiles remain untouched. A safe result reports extensionVersion and bundleVerified without a private path. Errors surface through the existing localized connection error; retry is available. Actions are short and do not create jobs or cancellation state. Repeated UI actions are disabled while pending; concurrent store opens coalesce. No installation claim persists: connection evidence expires and is rebuilt after restart. Only the existing selected profile identifier persists.

## Development diagnostics mode

Repository extension source and the production ASAR manifest have no
`version_name`. No separate Chrome Web Store archive builder currently exists;
the production source remains unmarked and safe for that distribution path.
`afterPack` rejects a diagnostic marker in the shipped manifest.

Only the unpackaged main process (`!app.isPackaged`) enables the managed
development overlay. `readBundle`/`stageBundle` take that authority as a separate
native option, not a renderer preference or distribution configuration field.
For this mode, the effective manifest is exactly the parsed production manifest
plus `version_name: "development-diagnostics"`, serialized with two-space
indentation and a final LF. The other eight files are unchanged. Production
staging continues to copy the source manifest byte-for-byte.

Every staged-file check and runtime preflight verifies the appropriate effective
bundle; arbitrary manifest edits are rejected. Worker and content read their
actually loaded manifest marker, and the heartbeat reports their combined
`diagnosticsEnabled` capability. Development preflight also requires that live
capability; matching version/build markers alone cannot enable diagnosis.
The native ownership API is omitted from packaged preload and rejected by native
IPC/service/bridge gates, even if someone loads a diagnostic extension manually.
Neither renderer state, user settings nor process arguments can opt production
into this capability.

## Verification

`npm run test:muse-extension` covers real loopback requests, protocol compatibility, official origins, token isolation, store URL validation, manual-folder boundaries, and production archive removal failures. `npm run test:core-commercial` includes these checks and VI/EN settings tests.

`afterPack` runs scripts/verify-muse-package.js: all nine extension files must exist in app.asar and match source bytes; the packaged version contract must match. A broken archive fails packaging.

Opt-in desktop check: clear ELECTRON_RUN_AS_NODE, then run `electron tests/muse-distribution.desktop.js`. This starts the application, waits for an existing Chrome heartbeat without altering its session, and exercises missing-extension status, refusal of an unconfigured store action, and the real manual-folder reveal. It quits the verification app afterwards. Do not run alongside another application instance.

No cookies, passwords, page storage, authentication headers, profile copying, debugging connections, Chrome policies or automated Developer Mode are used.

Current execution, ownership and acquisition: [Muse generation execution](MUSE_GENERATION_EXECUTION.md).
