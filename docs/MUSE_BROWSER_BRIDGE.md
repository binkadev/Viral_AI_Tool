> Historical foundation document. For the current production contract see [Muse generation execution](MUSE_GENERATION_EXECUTION.md). Earlier readiness-only and browser-process approaches below are not the current execution path.

# AI Create 2B-2: Muse browser session bridge

Muse uses Google Chrome only on Windows. There is no Edge or system-default-browser fallback. The launch URL is fixed in main-process code to https://muse.ai/ and cannot be supplied by IPC, configuration, or environment variables.

## Architecture

Settings -> fixed preload API -> trusted generation IPC -> GenerationService -> Muse provider -> MuseBrowserBridge -> Chrome. Browser session state is separate from provider readiness. The provider still exposes no runnable models and remains authentication_required when enabled, regardless of browser connection or manual login.

Discovery checks Windows Program Files, Program Files (x86), and Local AppData for Google's Chrome executable. No browser profile is inspected during discovery. Nonstandard Chrome installation locations are not currently supported.

The only profile is app userData/browser-sessions/muse/chrome. Dedicated path segments reject symbolic links/junctions. Normal Chrome profiles and former Edge profiles are never accessed or reused. Chrome itself manages manual authentication in this dedicated profile; the app does not inspect, copy, export, or decrypt credentials or browser storage.

## Connection and lifecycle

Chrome is started with --remote-debugging-address=127.0.0.1 and --remote-debugging-port=0. The port is browser-assigned. The bridge reads only the small DevToolsActivePort connection descriptor from the dedicated profile, validates its numeric port and browser-only endpoint path, and connects to ws://127.0.0.1. Browser.getVersion is the only protocol command sent. No page evaluation, login, prompts, cookies, tokens, storage, downloading, or generation commands exist.

Opening is coalesced across concurrent requests. A live dedicated endpoint is checked with a fresh handshake before reuse, including after app restart. Checks never launch a browser. Stale descriptors cannot report connected without a successful handshake. Startup checks are bounded and represent actual connection attempts, not generation progress.

App will-quit aborts connection work, clears the startup wait, and closes the bridge connection. It does not kill any browser process or delete the dedicated profile. A browser window left open continues to own its loopback endpoint until the user closes it. The UI explains that the dedicated window remains open. Reopening an already connected session reuses it without opening another tab or forcing it to the foreground.

## Public APIs

- openGenerationProviderSession("muse") -> generation:provider-session-open
- checkGenerationProviderSession("muse") -> generation:provider-session-check

Both use the existing trusted main-frame/local-file boundary and strict identifier validation. Opening additionally requires Muse to be enabled. Results contain only id, browser (chrome or null), state, checkedAt, and an optional allowlisted messageCode. States are browser_unavailable, browser_closed, browser_starting, browser_connected. No executable/profile path, port, raw protocol response, or exception reaches the renderer.

## Verification

Run npm run test:muse-browser, npm run test:muse-foundation, and npm run test:core-commercial. The browser tests are in the commercial gate. Existing CI filters already cover services/generation/**, renderer/**, tests/**, main.js, preload.js, and package.json. Existing generation-preview production guards are unchanged.

No generation automation, proof of login, real generation readiness, or generated output is implemented in this block.

## Local Windows verification

Verified with the production code path and an isolated test userData directory: Settings -> enable Muse -> Open Muse launched Google Chrome at the requested URL with its dedicated profile. The bridge returned browser_connected while the provider remained authentication_required and ready=false. The user manually closed the dedicated Chrome window and confirmed it; Check connection returned browser_closed. Reopening returned browser_connected again. VI/EN labels, Home/sidebar interaction, and the disabled Generate control passed. App close exited Electron while leaving Chrome and the profile intact. Windows reported the browser listener bound only to 127.0.0.1. The commercial regression suite, 15 browser tests, 12 foundation/Settings tests, syntax checks, and runtime import checks passed. No login, generation, or packaged installer was tested.
