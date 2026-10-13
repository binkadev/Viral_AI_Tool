# Viral AI Tool — Media Acquisition in Production

This document defines the production security and durability contract for stock-media acquisition.

## Server-side credentials

Online **Find media** uses backend-only stock provider credentials:

```text
PEXELS_API_KEY=<server-side Pexels key, optional when Pixabay is configured>
PIXABAY_API_KEY=<server-side Pixabay key, optional when Pexels is configured>
```

Never place these values in Electron main/preload code, renderer source, project snapshots, logs, diagnostics exports, or user-visible settings.

## Acquisition ticket secret

Configure a separate stable random secret:

```text
VIRAL_AI_MEDIA_TICKET_SECRET=<different random 32+ byte secret>
```

The backend uses this value to sign short-lived, account-bound acquisition tickets returned with eligible search results. A ticket binds the authenticated account to the provider asset identity and the server-selected download descriptor. The desktop client redeems the ticket through the authenticated backend before any native download begins.

Do not reuse the operations, admin, billing-webhook, or provider API secrets for this purpose. Rotating the media ticket secret invalidates outstanding short-lived tickets but does not affect media that has already been verified and cached locally.

## Durable project rule

Provider search results are transient. Clicking **Add to project** must not persist provider CDN URLs as the durable project asset.

The production flow is:

```text
search result
  -> signed acquisition ticket
  -> desktop validates destination/resources
  -> queued
  -> download to .part
  -> verify type/size/source
  -> atomic finalize in app-owned media cache
  -> project asset becomes ready + available
```

Only after successful verification may the renderer add the asset to project-owned media state. The durable record stores the local cache path, provider identity and attribution metadata. Search-time preview/download URLs are not the durable source of truth.

## Failure and cancellation

- cancellation aborts active network work and removes partial output;
- failed verification never creates a ready project asset;
- duplicate active acquisition is rejected by the native service, not only by UI state;
- insufficient disk/destination failures are recoverable and do not modify original user media;
- app shutdown or cloud-endpoint changes cancel active acquisition work safely;
- completed cached media remains usable independently of provider CDN URL expiry.

## Provider quota discipline

Provider adapters must not walk an unbounded number of result pages inside one UI request. Filtered searches use a fixed provider-page budget and return a continuation page when more provider results may exist. This keeps shared commercial provider credentials from being exhausted by one rare-orientation query while preserving explicit continuation semantics.
