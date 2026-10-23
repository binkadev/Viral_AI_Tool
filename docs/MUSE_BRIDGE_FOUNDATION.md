> Historical foundation document. For the current production contract see [Muse generation execution](MUSE_GENERATION_EXECUTION.md). Earlier readiness-only and browser-process approaches below are not the current execution path.

# AI Create 2B-1: Muse foundation

Muse is registered behind the existing ProviderRegistry and GenerationService. It uses the runtime's readiness/preflight/start/reconcile/cancel contract; reconcile remains the future polling/recovery boundary. No separate jobs or media state are created.

## Configuration and status

Only `enabled: boolean` is accepted, stored atomically in userData/generation/provider-config/muse.json with schema version 1. Missing file means unconfigured. Disabled means unavailable with DISABLED. Enabled means authentication_required with AUTHENTICATION_NOT_CONNECTED. Invalid/unreadable configuration means error with CONFIG_ERROR. A valid enable/disable write can replace invalid configuration; I/O failures return a safe error and retain the previous file where possible.

No endpoint, account, credentials, cookie, token, model preference, or environment setting is introduced. The cloud store's atomic-file pattern is reused in a separate provider-neutral store; cloud account authentication is not evidence of Muse authentication.

The contract supports unconfigured, checking, ready, unavailable, authentication_required, error, and the legacy not_configured value. Checking in Settings indicates a pending native check. Muse cannot reach ready in this block. Its declared text-to-video category is intended scope, not a validated executable capability. Its modelIds list is empty until a future authenticated implementation can prove supported models. The registry never makes connection-only adapters routable.

## Boundaries

- Existing generation:providers / listGenerationProviders returns registry status.
- generation:provider-check / checkGenerationProvider(id) reads canonical runtime status.
- generation:provider-configure / configureGenerationProvider({id, enabled}) validates and persists non-secret configuration, then reads canonical status.
- Both new channels retain the existing trusted-window/main-frame/local-file checks.
- Status uses allowlisted state, messageCode, capabilities, enabled, checkedAt, id and ready fields. No raw errors or configuration objects reach the UI.
- GenerationService still validates/routes every request before creating a job. Muse cannot submit, reconcile or cancel; operations reject with PROVIDER_UNAVAILABLE, and preflight remains not ready.

No browser automation, external network checks, model discovery, output creation, login, or downloading exists. No Muse dev fixture is supported, in development or production. Existing generation preview isolation is unchanged. All new production paths are already covered by core-commercial CI's services/generation/** and renderer/** filters.

## Validation

Run `npm run test:muse-foundation` and `npm run test:core-commercial`. The new tests are included in the commercial gate.

Local validation for this block: the full commercial regression gate passed, including 10 new tests. Isolated Electron runs exercised Settings, native mouse clicks on Muse enable/check/disable, VI/EN, keyboard focus, scrolling, Home-card navigation, sidebar navigation, and native minimize/maximize/restore/close. Native status remained not ready and Generate remained disabled. A second run used production mode with attempted dev-ready flags and 40% larger Settings text. No packaged installer or real Muse connection was tested.

Browser session support is now described in MUSE_BROWSER_BRIDGE.md (2B-2). Its Chrome-only connection does not change the readiness restrictions documented above.
