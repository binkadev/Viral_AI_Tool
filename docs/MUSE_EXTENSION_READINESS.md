> Historical foundation document. For the current production contract see [Muse generation execution](MUSE_GENERATION_EXECUTION.md). Earlier readiness-only and browser-process approaches below are not the current execution path.

# Muse extension readiness

This block connects the existing Chrome profile's Muse extension to the current
GenerationService. It does not generate, submit prompts, download, or create jobs.

## Source and scope

Reference: `feat/meta-muse-extension-bridge`, its extension manifest, worker,
content script, localhost bridge, IPC, tests, and `META_MUSE_BROWSER_BRIDGE.md`.
Only the v1 discovery/registration/heartbeat/poll/result concept and composer
presence signals were adapted. No legacy Automation modules were restored.

Main starts `services/generation/bridge/meta-muse-extension-bridge.js` without
waiting for it to connect. Muse provider exposes session operations through
GenerationService and trusted-main-frame generation IPC. Session results are
allowlisted again before crossing preload. Generation readiness is always false,
with no model IDs and no executable generation route.

## Setup and recovery

Use Settings → AI Video Providers → Muse. Open extension folder copies the bundled
readiness-only extension to `userData/meta-muse-extension` and reveals it. Load it
unpacked in Chrome, or reload the already installed extension if it uses that
folder, then refresh the existing Muse tab. No Chrome process is launched.
The popup lets the user name the profile and reconnect; its VI/EN strings are
generated from `renderer/i18n.js` and checked for parity by tests.

The v1 wire format remains compatible with installed 0.1.0. Legacy title and
account-label fields are bounded then discarded immediately. Upgrading to 0.2.0
removes collection of those fields, prompt/download code and download permission.
The application never sends the old generation/download/cancel commands.

## Protocol and trust boundary

- IPv4 loopback `127.0.0.1`, compatible ports 32147–32157; no environment override.
- Random server UUID and 256-bit registration token per instance; token never
  crosses preload or persists in application config. The new worker keeps its
  bridge token in memory; extension-local storage contains only instance ID and
  editable label. It removes the old worker's persisted bridge connection keys.
- Registration requires a syntactically valid extension origin, Chrome client,
  strict schema, and a non-conflicting instance ID. Extension IDs are not hardcoded.
- Chrome omits Origin on GET discovery/poll. Origin-less GET is allowed; session
  polling still requires its token. POST requires the registered extension origin.
  Web origins, non-loopback peers and foreign Host headers are rejected.
- Registration discovers a local trusted extension, not a signed identity proof.
  A malicious local process/extension is outside this protocol's trust boundary.
- JSON bodies are capped at 32 KiB, 16 profiles and 20 tabs/profile; header,
  connection, request and command limits apply. Errors contain fixed codes only.
- Evidence expires 12 seconds after the last heartbeat. Polling does not extend
  its lifetime. Closing the app rejects pending opens and closes HTTP connections;
  it does not affect Chrome or delete any browser data.
- Only `openMuse` is queued, only for the selected instance. It carries an optional
  selected tab ID, never a URL. Timeout removes the pending command. New extension
  reuses the selected/sole Muse tab; old 0.1.0 may open a new Muse tab instead.

## Selection and authentication

All public sessions contain only instance ID, user label, tab ID, and auth state.
No tab titles, URLs, DOM, account identities, or bridge credentials reach renderer.
With multiple profiles or tabs, the user must choose. Only the explicitly selected
instance ID is saved atomically in `userData/meta-muse-extension-selection.json`.
Tab IDs stay in memory. Restart recovers a sole tab in the remembered profile;
multiple tabs require another choice. An absent remembered profile never falls
back silently to another profile. Stale selections fail without overwriting data.

The installed 0.1.0 extension reported a live composer-ready muse.ai tab during
Windows verification on 2026-10-18. Its historical root/editor signal was the
basis for the port. New content script additionally requires a visible, editable,
enabled editor inside `[data-hatch-composer-root]`. It reads no entered text,
identity, credentials, page storage, or network headers. Missing composer means
authentication_required; unavailable inspection means unknown. This is a current
workspace usability observation, not proof of generation capability. Site changes
can invalidate selectors; uncertain evidence must never enable generation.

## Legacy preservation

`services/generation/browser/` remains on disk with its isolated tests but is no
longer instantiated or imported by main or the canonical Muse session path.
`meta-muse-profile` and `browser-sessions` are neither used nor deleted. The prior
unfinished `feature/muse-auth-readiness` work is preserved in a named git stash.

## Windows verification completed

On 2026-10-18, the user reloaded 0.2.0 in the existing Chrome profile and refreshed
Muse. The restarted verification app recovered the persisted instance ID with a
changed live tab ID, detected the usable composer as authenticated, and returned
only the allowlisted session fields through preload. Clicking Open Muse reused
that same tab without creating a duplicate. Generation Runtime remained
`ready: false` and the Create AI Generate control remained disabled. Native
Settings selection, VI/EN labels, Home/sidebar navigation and window close were
also exercised. Multi-profile ambiguity and expiry were tested with isolated
bridge instances; no synthetic sessions were inserted into the desktop run.
