# Muse Video provider

Status: implementation branch `feat/muse-video-provider`; live paid-generation acceptance pending.

This integration targets the independent API service at `muse-video.com`. It is not the official Meta Muse Video product.

## Runtime flow

1. User completes Brief → Script → Scene Plan.
2. In **Tư liệu**, each scene still defaults to `stock`.
3. User may choose **Tạo cảnh này bằng Muse** or **Tạo tất cả cảnh bằng Muse**.
4. The selected Scene Plan entries switch their AssetRequest strategy from `stock` to `generated`.
5. Existing provider-neutral `AssetRouter` routes only those generated requests to `muse-video`.
6. Electron main process calls Muse:
   - `POST https://muse-video.com/api/v1/generate`
   - polls `GET https://muse-video.com/api/v1/status?task_id=...`
7. On `SUCCESS`, the hosted result URL remains in the main-process candidate-token vault.
8. The main process immediately downloads the result into the existing Automation asset cache.
9. Project state receives a normal local `AssetRef` with provider, providerAssetId, localPath, dimensions, duration, checksum, cacheKey, license and attribution.
10. Composition, Studio preview and final export continue through the existing pipeline without provider-specific branches.

## Secrets

The renderer never reads `MUSE_VIDEO_API_KEY`.

Users have two supported configuration paths:

- enter the key in **Automation → Tư liệu → Muse Video → Cấu hình**; Electron `safeStorage` encrypts the secret for the current OS user;
- set `MUSE_VIDEO_API_KEY` in the process environment / deployment secret manager.

Environment configuration wins over the local encrypted key. Project JSON, AssetRequest, AssetRef and renderer localStorage must never contain the key.

Muse result/download URLs may be short-lived or signed. They are held behind an in-memory candidate token and are not persisted into project state.

## Default model

Default: `kling26-text-to-video` (Muse labels this route **Omni Video**).

Default generated audio is **off**. Viral AI Tool already owns narration through the A1 voice track, and current Composition preview/export intentionally mixes A1 rather than source-video audio. Enabling Muse model audio can increase provider credit usage and should be treated as an advanced option until source-audio mixing is a product feature.

Supported text-to-video routes exposed by this adapter:

- Omni Video (`kling26-text-to-video`)
- Kling 3.0 Standard (`kling3-standard-text-to-video`)
- Kling 3.0 Pro (`kling3-pro-text-to-video`)
- Grok Imagine (`grok-imagine-text-to-video`)
- HappyHorse 1.0 (`happyhorse-1.0-text-to-video`)

Image-to-video and motion-control routes are intentionally out of this first integration checkpoint because Automation currently creates text-led visual intents per ScenePlan. They can be added later without replacing the provider contract.

## Cancellation and failure behavior

- Single-scene generation has an `AbortController` from renderer AssetState through IPC to the Muse HTTP request/poll loop.
- Batch generation runs scenes sequentially and can be stopped without deleting already materialized scene assets.
- App quit cancels active Muse operations in `before-quit`.
- Authentication, credits, rate limiting, timeout, provider rejection and cancellation are normalized into existing Automation error categories.
- Failed tasks do not overwrite an already accepted local AssetRef.

## Credit safety

`Tạo tất cả cảnh bằng Muse` always asks for confirmation because it can spend credits once per unresolved scene. The UI does not estimate a fake total because pricing differs by model, duration, resolution and audio. Muse's returned `consumed_credits` is captured as transient generation metadata; the local AssetRef remains provider-neutral.

## Acceptance

Before merging:

1. Run `npm run test:core-automation-muse-video`.
2. Run `npm run test:core-automation-asset-router` and `npm run test:core-automation-stock-assets`.
3. Start Electron and configure a real Muse API key through the Muse panel (do not paste the key into chat or project files).
4. Generate one scene first.
5. Confirm progress: submit → polling → download → local AssetRef.
6. Open the downloaded asset from the Tư liệu inspector.
7. Rebuild Composition and confirm the Muse scene appears in Studio.
8. Export and verify the local Muse clip is used in the final MP4.
9. Test cancel during generation and verify no partial local file/project replacement remains.
10. Only after one-scene acceptance, test **Tạo tất cả cảnh bằng Muse** because it can consume multiple paid generations.
