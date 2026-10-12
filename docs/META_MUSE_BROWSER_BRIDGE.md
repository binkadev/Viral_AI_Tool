# Meta Muse current-profile extension bridge

Status: implementation branch `feat/meta-muse-extension-bridge`; live Chrome + Muse acceptance is required before merge.

## Why this integration uses a Chrome extension

The Muse used by this project is **Meta Muse at https://muse.ai**. It is not the unrelated `muse-video.com` API service.

The user may already be signed into Muse in a normal Chrome profile. Opening a second automation-only browser profile can trigger a different Meta/Instagram authentication path and does not reliably reuse the session the user actually wants. Viral AI Tool therefore connects to the user's **existing Chrome profile and existing muse.ai tab** through a small local extension bridge.

The extension does not export cookies, passwords or Meta tokens. It only receives bounded commands from Viral AI Tool over a loopback-only local bridge and executes those commands inside the selected muse.ai tab.

## Multi-profile model

Each Chrome profile has its own extension instance and its own local extension storage. The bridge generates a stable `instanceId` per profile.

Viral AI Tool lists connected sessions as:

`Browser · Profile label · Muse tab · readiness`

Rules:

- one Chrome profile = one extension instance;
- one extension instance may expose multiple Muse tabs;
- when exactly one profile/tab is available, the tool may use it automatically;
- when multiple profiles are available, Viral AI Tool does **not guess** which account to use;
- the user chooses the profile/tab explicitly and the selected profile instance is remembered;
- Chrome cookies/session data remain owned by Chrome and never become project data.

The extension popup lets the user assign a human-readable profile label such as `Personal`, `Work` or `Muse A` so multiple Chrome profiles are easy to distinguish.

## First-time setup

1. Open **Tạo bằng AI → Tư liệu → Meta Muse**.
2. Click **Mở thư mục tiện ích**.
3. Chrome → `chrome://extensions`.
4. Enable **Chế độ dành cho nhà phát triển / Developer mode**.
5. Choose **Tải tiện ích đã giải nén / Load unpacked**.
6. Select the folder opened by Viral AI Tool.
7. Open `https://muse.ai` in that same Chrome profile and sign in normally.
8. Return to Viral AI Tool and click **Kiểm tra kết nối**.
9. If multiple profiles/tabs are connected, choose the desired **Phiên Muse**.

The installed extension files are copied into Electron `userData/meta-muse-extension` so packaged builds do not ask Chrome to load files directly from an ASAR archive.

## Local bridge protocol

`services/automation/meta-muse-extension-bridge.js` owns a loopback-only HTTP bridge on `127.0.0.1`, scanning ports `32147–32157`.

The extension:

- discovers the local bridge;
- registers its stable profile instance ID;
- receives an in-memory session token;
- reports open muse.ai tabs and composer readiness;
- polls for bounded commands;
- returns command results/progress.

The server rejects non-loopback clients and only permits Chrome-extension origins for bridge requests. Session tokens are memory-only and rotate after an app restart/re-registration.

## Generation flow

1. Scene Plan produces an AssetRequest.
2. User chooses **Tạo cảnh này bằng Muse**.
3. That scene's request strategy switches from `stock` to `generated`.
4. Existing AssetRouter routes it to provider `meta-muse`.
5. Main process sends a generated scene prompt to the selected extension instance/tab.
6. The content script writes the prompt into Muse's composer and submits it.
7. It watches the assistant response until a generated video URL appears or an error/timeout occurs.
8. The main process immediately downloads the generated media. If direct download is not possible, the extension may use Chrome's download manager and return the local downloaded file path.
9. Existing FFmpeg probing validates dimensions/duration.
10. Existing AssetCache adopts the local video.
11. Project state receives a normal local AssetRef.
12. Composition → Studio → Export remain provider-neutral.

## Muse DOM boundary

Only `extensions/meta-muse-bridge/content-script.js` knows Muse page selectors.

Current selector contract:

- composer: `[data-hatch-composer-root]`;
- editor: `[data-lexical-editor="true"]` with textarea/contenteditable fallbacks;
- assistant message: `[data-message-item][data-message-role="assistant"]`;
- active generation: `[data-testid="hatch-composer-stop-button"]`;
- error notice: `[data-testid="assistant-response-error-notice"]`.

If Muse changes its UI, this layer can be repaired without changing AssetRequest, AssetRouter, CompositionPlan or export code.

## Security boundary

- No Muse API key is required.
- No Meta password is collected.
- No Chrome cookie/session database is read or copied.
- No browser profile folder is cloned.
- The bridge listens only on `127.0.0.1`.
- The renderer receives only normalized connection state and project-safe AssetRefs.
- Generated media URLs remain transient candidate data and are not project truth.

## Failure and cancellation

Normalized conditions include:

- `EXTENSION_DISCONNECTED`: selected Chrome extension instance is no longer connected;
- `MUSE_SESSION_REQUIRED`: multiple/no sessions require an explicit selection;
- `MUSE_TAB_NOT_FOUND`: selected Muse tab was closed;
- `LOGIN_REQUIRED`: selected Muse tab does not expose a ready composer;
- `COMPOSER_NOT_READY` / `PROMPT_NOT_SENT`: Muse UI is not ready for automation;
- `MUSE_RESPONSE_ERROR`: Muse displayed an assistant error;
- `MUSE_NO_VIDEO`: Muse replied but no video was detected;
- `PROVIDER_TIMEOUT`: Muse did not finish in the allowed window;
- `MEDIA_DOWNLOAD_FAILED`: generated video could not be materialized;
- `CANCELLED`: user stopped the current generation.

A failed retry never deletes an already accepted local AssetRef.

## Acceptance checklist

Before merge:

1. `npm run test:core-automation-meta-muse` passes.
2. AssetRouter, stock, composition and Studio regressions still pass.
3. Click **Mở thư mục tiện ích**, load the unpacked extension into the Chrome profile shown in the user's screenshot.
4. Open the already signed-in `muse.ai` tab.
5. Viral AI Tool changes from **Chưa nối Chrome** to a profile/tab option.
6. If multiple Chrome profiles are connected, verify the tool requires explicit selection and never silently switches accounts.
7. Select one ready Muse session and confirm **Đã kết nối**.
8. Generate one scene only.
9. Verify the prompt appears in the existing Muse tab the user selected.
10. Verify progress returns to Viral AI Tool and the resulting video becomes a local AssetRef.
11. Rebuild Composition and verify Studio uses the Muse-generated clip.
12. Test cancel and tab/profile disconnect recovery.
13. Only after one-scene acceptance should batch Muse generation be enabled, because multiple scenes can consume the user's Muse quota.

## Maintenance note

This is an integration against a consumer web application, so DOM behavior can change independently of Viral AI Tool. Keep Meta Muse as a replaceable provider behind AssetRouter and retain stock as a reliable fallback. Users must use their own authorized accounts and comply with Muse's applicable terms.
