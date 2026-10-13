# Viral AI Tool — Product Execution Handoff

This document is the durable continuity contract for product, architecture, UX, and implementation work. Read it together with `AGENTS.md` and `docs/PRODUCT_GUARDRAILS.md` before continuing substantial work.

## Product goal

Viral AI Tool is a Windows-first commercial creator workstation that evolves into a content operating system. The product must feel coherent, premium, reliable, and understandable to non-technical creators.

The long-term loop is:

```text
Research / Idea
  -> Script
  -> Scene planning
  -> Find or generate media
  -> Edit / localize / voice / subtitle
  -> Export
  -> Publish
  -> Measure
  -> Learn
  -> Create again
```

Do not reduce the product to a generic video editor, a translation tool, or a collection of unrelated AI buttons.

## Product principles

1. Business/domain logic comes before UI decoration.
2. Every long-running workflow has an explicit state machine and restart behavior.
3. UI is a projection of domain state, not the owner of business rules.
4. Project-owned state must survive restart semantically; transient search results and temporary provider state should not pollute project persistence.
5. External providers are adapters. User-facing product concepts must not depend on provider names unless attribution or account selection genuinely requires it.
6. Never expose raw provider/library/engine errors to customers.
7. Prefer recovery over destructive behavior.
8. Features must work in Vietnamese and English.
9. Premium Dark is the approved default visual direction. New screens must use the same workstation hierarchy, typography, spacing, interaction language, and restrained motion.
10. Do not add a feature merely because a competitor has it; fit it into the domain model and end-to-end workflow first.

## Current completed foundation

The repository now contains the commercial shell, creator home, player/timeline synchronization, long-form transcript workstation, source recovery, output recovery, translation/voice flows, auth/billing/cloud foundations, update flow, project persistence, and the V1 commercial Media Engine.

The Media Engine owns project media as durable state instead of decorative UI-only records. It includes local media foundations, provider-neutral stock discovery, Pexels/Pixabay backend adapters, signed user-bound acquisition tickets, secure native cache/download, duplicate protection, cancellation, verification, attribution, pagination, project-safe completion, restart/recovery contracts, VI/EN workbench UX, and permanent regression coverage.

Generated-media entries remain part of the shared media model, but provider-specific AI image/video generation is intentionally implemented through later generation/script-to-video blocks rather than reopening the stock discovery/acquisition boundary.

## Roadmap and order

Do not reorder this sequence casually. A later block may be prototyped, but production integration should respect dependencies.

```text
Block 1 — Commercial Shell                 DONE
Block 2 — Player + Timeline                 DONE
Block 3 — Transcript Workstation            DONE
Block 4 — Project Persistence               DONE
Block 5 — Content / Media Engine            DONE
Block 6 — AI Scene Planner                  CURRENT
Block 7 — Automated Media Matching
Block 8 — Script -> Full Video
Block 9 — Publish Hub
Block 10 — TikTok / Instagram / YouTube connections
Block 11 — Scheduling + Publishing Queue
Block 12 — Analytics / Growth Loop

Later / V1.5+
- Telegram remote control + notifications + approvals
- Trend intelligence
- Viral score
- A/B testing
- Revenue intelligence
- Multi-account / agency mode
- Autonomous agent workflows
```

Telegram is an integration layer, not a core workflow owner. It should call the same Notification, Approval, Job, and Publishing services used by the desktop app.

## Block 5 — Media Engine scope (completed V1 commercial foundation)

The Media Engine contract supports:

- project source media;
- local video/image/audio imports;
- stock search adapters;
- generated image/video/audio asset records for later generation providers;
- download/cache lifecycle;
- attribution/license metadata;
- favorites and project library organization;
- duplicate protection;
- missing-file recovery/relink contracts;
- cancellation/retry/recovery;
- persistence/restart behavior;
- project ownership;
- VI/EN commercial UX.

### Media concepts

A project media asset has at minimum:

```text
id
kind: video | image | audio
origin: source | local | stock | generated
provider
providerAssetId
name
localPath
previewUrl
remoteUrl
status
fileState
progress
favorite
meta
attribution
createdAt
updatedAt
```

Provider search results are transient until the user adds/downloads/selects them for the project. Do not persist arbitrary search pages into the project snapshot.

### Asset lifecycle

Use these semantic states unless a later design deliberately evolves them:

```text
ready
validating
queued
downloading
generating
verifying
cancelling
cancelled
failed
interrupted
```

Active work must become `interrupted` after app restart unless there is a real resumable job protocol. Never pretend an old download/generation is still running.

### File state

Keep processing state separate from local file availability:

```text
available
missing
remote
trashed
unknown
```

Examples:
- `ready + remote`: provider asset is known but not downloaded locally.
- `ready + available`: local/project asset is accessible.
- `failed + available`: processing failed, but the original local file still exists.
- `ready + missing`: metadata remains but the user needs to relink.

### Duplicate identity

Prefer semantic duplicate identity:

1. provider + providerAssetId for stock/generated provider assets;
2. normalized local path for local media;
3. remote URL when provider identity is unavailable;
4. asset id only as final fallback.

Do not rely on UI-disabled buttons for duplicate prevention.

## Block 5 implementation slices

### 5A — Domain + persistence foundation — DONE

- pure media library model;
- normalization and duplicate rules;
- restart-safe state normalization;
- attribution metadata;
- project snapshot schema migration;
- regression tests.

### 5B — Native local-media bridge — DONE

- secure file picker for video/image/audio;
- native validation of selected files;
- media description/probe layer;
- no renderer Node access;
- no arbitrary path execution.

### 5C — Commercial Media Library UI — DONE for V1 discovery/acquisition workflow

Assets panel is a real project library/workbench and can surface project media plus discovery/acquisition states. Generated-provider screens can extend this surface later without changing project ownership rules.

### 5D — Stock provider architecture — DONE

- provider-neutral search contract;
- Pexels/Pixabay backend adapters;
- secrets stay backend-only;
- license/attribution retained with selected assets;
- normalized search results;
- pagination/cancellation/rate-limit handling;
- signed short-lived user-bound acquisition descriptors.

### 5E — Download/cache lifecycle — DONE

State machine:

```text
idle -> validating -> queued -> downloading -> verifying -> ready
                              -> cancelling -> cancelled
                              -> failed
```

The native layer validates source/provider identity, destination, allowed host/content type, file size/disk constraints, duplicate active work, partial-output cleanup, verification, project binding, and safe shutdown cancellation.

## Block 6 — AI Scene Planner (CURRENT)

Scene Planner turns a script or transcript into a durable, editable visual plan before any automatic stock matching or generation occurs.

The planner must not be an opaque one-click generator. It should produce reviewable scenes with timing, source-text ownership, visual intent, search/generation prompts, shot/motion preference, and confidence. Manual edits must be preserved and distinguishable from AI suggestions where relevant.

The initial implementation order is:

1. define scene-plan schema, ownership and migration;
2. deterministic transcript/script segmentation foundation;
3. AI planner provider contract and backend boundary;
4. validation/recovery/cancellation/restart behavior;
5. planner workbench UI in the editor;
6. persistence and edit semantics;
7. regression tests;
8. only then connect Block 7 automatic media matching.

## Blocks after Scene Planner

### Automated Media Matching

Rank candidates by semantic relevance, orientation, duration, resolution, duplicate score, visual diversity, and licensing/availability constraints.

### Script -> Full Video

Use Scene Planner + Media Engine + voice/subtitles/music/editing to create a reviewable project, not an opaque one-click black box.

### Publish Hub

Exported media -> destination selection -> caption/metadata -> now/schedule -> per-platform independent states. Publishing failures must be recoverable and platform-specific.

### Analytics / learning

Performance data should feed recommendations only after publishing/account integrations are stable. Keep evidence and confidence visible; do not promise guaranteed virality or revenue.

## UI/UX quality bar

Every substantial screen should answer:

- What am I looking at?
- What can I do next?
- What is currently selected?
- What is processing?
- What failed and how do I recover?
- What will be destructive?
- Where did this media come from when attribution matters?

Avoid generic AI dashboard card soup. Prefer a coherent creator workstation with strong hierarchy, useful density, polished empty/loading/error states, visible keyboard/focus behavior, and restrained purposeful motion.

## Engineering workflow

For each feature slice:

```text
1. Define user outcome
2. Define entities and ownership
3. Define state machine
4. Define service/native boundary
5. Define persistence/restart behavior
6. Define failure/recovery paths
7. Define UI states and interactions
8. Implement
9. Add regression tests
10. Review against AGENTS.md + PRODUCT_GUARDRAILS.md
11. Merge only when the slice is coherent
```

Use Codex for implementation-heavy work when available, but give it a locked spec/state model rather than a vague feature prompt. Parallel agents should own separable surfaces; avoid several agents simultaneously editing central files such as `renderer/app.js`, `renderer/i18n.js`, `main.js`, and `preload.js` without explicit coordination.

## New-chat recovery instructions

If a conversation loses context, the user should say something like:

> Continue the Viral AI Tool project from the repository. Read `AGENTS.md`, `docs/PRODUCT_GUARDRAILS.md`, and `docs/PROJECT_EXECUTION_HANDOFF.md`, inspect the latest master/active feature branch and recent PR/review history, then continue from the first unfinished roadmap slice. Do not redesign the product direction or skip domain/state/persistence rules.

The assistant should then:

1. inspect the repository and latest commits/PRs;
2. read the three documents above;
3. identify the active branch and exact incomplete slice;
4. run/read relevant regression tests and review comments;
5. continue implementation without asking the user to reconstruct old chat context unless an actual product decision is missing from the repository.

As of the Block 5 merge, the first unfinished roadmap slice is Block 6 — AI Scene Planner. PR #38 is historical context for the completed Media Engine and should not be reopened unless a real regression is found.

This file is the canonical continuity summary. Update it whenever product architecture, roadmap ordering, state contracts, or major workflow decisions change.
