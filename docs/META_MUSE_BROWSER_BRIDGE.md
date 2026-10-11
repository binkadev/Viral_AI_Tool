# Meta Muse browser bridge

Status: implementation branch `feat/meta-muse-browser-bridge`; live Muse account acceptance is still required before merge.

## Why this integration is browser-based

The Muse used by this project is **Meta Muse at https://muse.ai**. It is not the former video-hosting product previously called muse.ai and it is not the unrelated `muse-video.com` API service.

Current community integrations such as `MUSE_MCP` and `muse2api` drive a real signed-in Chromium session because Muse does not expose a normal public client API for externally submitting chat/video jobs. The browser owns Muse's authenticated client/session and the integration interacts with the visible composer and generated media.

This project follows the same architectural pattern while keeping Muse behind the existing provider-neutral Automation boundary.

## User flow

1. Complete Brief → Script → Scene Plan.
2. Open **Tư liệu**.
3. The **Meta Muse / muse.ai** card shows the browser connection state.
4. Click **Mở Muse & đăng nhập** on first use.
5. Viral AI Tool opens a dedicated Chrome/Edge profile at `https://muse.ai`.
6. The user completes Meta sign-in manually in that browser window. The tool never asks for or stores the Meta password.
7. Back in Viral AI Tool, click **Kiểm tra kết nối**.
8. Select a scene and click **Tạo cảnh này bằng Muse**.
9. The AssetRequest strategy changes from `stock` to `generated` only for that scene.
10. The existing AssetRouter routes the request to `meta-muse`.
11. The main process sends the scene's visual direction to the signed-in Muse composer, waits for Muse to finish, finds the generated video link, downloads it, probes it with the existing FFmpeg metadata path, and adopts it into the existing Automation asset cache.
12. Project state receives a normal local AssetRef. Composition, Studio preview and final export remain provider-neutral.

## Session and credential boundary

- No Muse API key is required.
- No Meta password is collected by Viral AI Tool.
- Sign-in happens directly inside the Chrome/Edge window opened on `muse.ai`.
- The browser session is stored in a dedicated local profile under Electron `userData/meta-muse-profile`.
- The renderer receives only readiness/status information and normalized local AssetRefs.
- Generated Muse media URLs are kept in an in-memory main-process candidate vault and are not persisted as project truth.
- Generated video is downloaded promptly because browser media links may be temporary.

## Browser automation boundary

`services/automation/meta-muse-browser.js` is the only layer that knows Muse DOM selectors. If Muse changes its UI, that adapter can be repaired without changing AssetRequest, AssetRouter, CompositionPlan or export code.

Current selector contract is intentionally small:

- composer: `[data-hatch-composer-root]`
- editor: `[data-lexical-editor="true"]` with textarea/contenteditable fallbacks
- assistant message: `[data-message-item][data-message-role="assistant"]`
- active generation: `[data-testid="hatch-composer-stop-button"]`
- error notice: `[data-testid="assistant-response-error-notice"]`

## Generation prompt

For each scene, Viral AI Tool sends Muse:

- visual intent;
- narration only as context;
- requested aspect ratio;
- approximate scene duration;
- instruction to avoid subtitles, text overlays, logos and watermarks;
- instruction to generate the actual video rather than return a storyboard.

The local project continues to own subtitles and A1 narration, so Muse is used primarily as the visual-generation source.

## Failure and cancellation

Normalized conditions include:

- `BROWSER_UNAVAILABLE`: Chrome/Edge could not be launched;
- `LOGIN_REQUIRED`: dedicated Muse browser session is not signed in;
- `COMPOSER_NOT_READY`: Muse loaded but its composer is unavailable;
- `PROVIDER_REJECTED`: Muse displayed an assistant error;
- `MUSE_NO_VIDEO`: Muse replied but no downloadable video was found;
- `PROVIDER_TIMEOUT`: generation did not complete within the configured limit;
- `DOWNLOAD_FAILED`: generated media could not be downloaded;
- `CANCELLED`: user stopped the current generation.

Already accepted assets are not deleted when a new Muse attempt fails.

## Acceptance checklist

Before merge:

1. `npm install` installs `playwright-core` but does not download a browser.
2. `npm run test:core-automation-meta-muse` passes.
3. Existing asset-router, stock, composition, Studio and export regressions still pass.
4. On a machine with Chrome or Edge, click **Mở Muse & đăng nhập** and sign in manually.
5. Connection changes to **Đã kết nối**.
6. Generate one scene only.
7. Confirm Muse visibly receives the prompt in its browser window.
8. Confirm Viral AI Tool shows generation progress.
9. Confirm the resulting MP4 is downloaded into the Automation asset cache and **Mở file đã tải** works.
10. Rebuild Composition and verify that scene uses the Muse-generated local clip.
11. Test cancellation during a generation.
12. Only after one-scene acceptance should batch Muse generation be added, because multiple scenes can consume the user's Muse quota.

## Maintenance note

This is a browser integration against a consumer web application, so DOM behavior can change independently of Viral AI Tool. Treat the Muse adapter as a replaceable provider and keep stock generation as a reliable fallback. Users must comply with Muse's applicable terms and use their own authorized accounts.
