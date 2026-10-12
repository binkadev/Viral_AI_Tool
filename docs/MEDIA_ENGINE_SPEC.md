# Block 5 — Media Engine Product & Domain Contract

Status: active implementation.

## User problem

A creator needs reusable project media, not only one imported source video. The product must let the creator bring local media into a project, discover licensed stock media, later generate AI media, understand where assets came from, recover missing local files, and safely use media in the editor without leaking provider complexity into normal workflow copy.

## Scope boundaries

This block owns:
- project media-library records;
- local media import;
- remote media discovery abstraction;
- attribution/license metadata;
- remote asset acquisition/download lifecycle;
- cache/project ownership metadata;
- favorites and project-level selection;
- recovery state for missing/interrupted media.

This block does not own:
- semantic scene planning (Block 6);
- automatic asset ranking/matching (Block 7);
- final script-to-video orchestration (Block 8);
- social publishing (Blocks 9-11).

## Security boundary

Provider credentials MUST remain server-side. The desktop renderer and packaged application must never receive Pexels/Pixabay secret API keys.

Desktop flow:
`Renderer -> preload IPC -> desktop media/cloud client -> Viral AI backend -> provider adapter`

The backend returns normalized provider-neutral results only.

## Domain entities

### MediaAsset

Stable project-owned record:
- `id`
- `kind`: `video | image | audio`
- `origin`: `source | local | stock | generated`
- `provider`
- `providerAssetId`
- `name`
- `localPath`
- `previewUrl`
- `remoteUrl` only when safe/necessary; prefer backend download tickets for production acquisition
- `status`
- `fileState`
- `progress`
- `favorite`
- `meta`: width/height/duration/size/mime/orientation
- `attribution`: creator/source/license data
- timestamps

### MediaSearchResult

Ephemeral discovery result; not persisted into project until user adds/downloads it.

Required normalized fields:
- `provider`
- `providerAssetId`
- `kind`
- `name`
- `previewUrl`
- `thumbnailUrl`
- `meta`
- `attribution`
- `variants[]` with provider-neutral quality metadata

Do not expose provider authorization details.

### MediaAcquisitionJob

Long-running remote-to-local operation:
- job id
- project id
- target asset identity
- selected variant
- destination/cache ownership
- state
- progress
- cancellation state
- public error code
- timestamps

## State machine

Remote acquisition:

```text
idle
  -> validating
  -> queued
  -> downloading
  -> verifying
  -> ready

validating/downloading/verifying
  -> cancelling
  -> cancelled

validating/queued/downloading/verifying
  -> failed

active state present after app restart
  -> interrupted
```

Rules:
- cancelled != failed;
- original/local user media is never modified;
- partial generated/downloaded outputs are removed on cancellation/failure where safe;
- duplicate active acquisition of the same provider asset into the same project is rejected;
- an existing ready asset is returned as duplicate rather than silently downloaded again;
- restart must never resurrect an in-memory network job;
- destination path must be validated before network transfer begins.

## Provider abstraction

Server provider interface:

```text
id
isConfigured()
search({ query, kind, orientation, page, perPage })
normalizeResult(raw)
```

Search service responsibilities:
- validate query and filters;
- select configured providers;
- enforce timeout/cancellation;
- normalize results;
- deduplicate within provider and across repeated pages;
- never return raw provider errors to clients;
- retain attribution/license source data;
- report provider availability separately from zero search results.

## Initial providers

### Pexels
First production adapter.
- credentials from backend environment only;
- video search first;
- orientation mapping supported;
- creator/source attribution retained.

### Pixabay
Second adapter after Pexels contract and UI are stable.

### Coverr
Deferred until commercial/API terms are explicitly reviewed.

## Public error codes

Search:
- `MEDIA_SEARCH_INVALID`
- `MEDIA_SEARCH_UNAVAILABLE`
- `MEDIA_SEARCH_TIMEOUT`
- `MEDIA_PROVIDER_UNAVAILABLE`
- `MEDIA_AUTH_REQUIRED` when the product policy requires authenticated cloud use
- `MEDIA_QUOTA_EXCEEDED`

Acquisition:
- `MEDIA_SOURCE_UNAVAILABLE`
- `MEDIA_DESTINATION_UNAVAILABLE`
- `MEDIA_DISK_SPACE_LOW`
- `MEDIA_DOWNLOAD_DUPLICATE`
- `MEDIA_DOWNLOAD_FAILED`
- `MEDIA_VERIFY_FAILED`
- `MEDIA_CANCELLED`

Customer UI maps these to localized messages. Raw URLs, secrets, provider response bodies, stack traces and filesystem paths must not appear in normal errors.

## Search UX contract

Normal user labels:
- `Tìm tư liệu` / `Search media`
- search field
- tabs/filters for Video / Images (Audio later if supported by provider)
- orientation filter when useful
- source attribution visible on asset detail/card footer without overwhelming the workflow
- `Xem trước` / `Preview`
- `Thêm vào dự án` / `Add to project`
- download/progress/cancel/retry states

Empty states must distinguish:
- no results;
- provider/search unavailable;
- not connected/authenticated;
- query not entered.

## Persistence contract

Project snapshot owns the stable MediaAsset library. Ephemeral search results and active network controllers are not persisted.

On restart:
- stable ready/cancelled/failed records remain;
- active asset states normalize to `interrupted`;
- user can retry interrupted remote acquisitions;
- local missing files remain recorded as `missing` and offer relink/remove-from-library actions.

## Definition of done for Block 5

Before Block 5 is complete:
- local video/image/audio import works end-to-end;
- project media library UI renders persisted assets;
- Pexels search works through backend without exposing API key;
- search result normalization is tested;
- add/download lifecycle implements duplicate, cancel, retry, failure and restart behavior;
- attribution metadata survives into project media records;
- missing local file recovery remains available;
- VI/EN copy exists;
- tests cover domain model, provider normalization, public error isolation, persistence and critical UI contracts;
- commercial regression passes.
