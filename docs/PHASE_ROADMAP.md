# Viral AI Tool — Phase Roadmap

Status: **Automation Foundation approved to start**

This roadmap starts after Stable Editor Core runtime verification. MoneyPrinterTurbo is a design/reference input only; it is not a subsystem of Viral AI Tool.

## Phase Gate A0 — Architecture audit

Deliverables:

- `docs/ARCHITECTURE_V2.md`
- `docs/AUTOMATION_ENGINE.md`
- `docs/PHASE_ROADMAP.md`
- REUSE / EXTEND / NEW mapping based on the actual codebase
- MoneyPrinterTurbo reference mapping

Rules:

- no automation provider/business implementation before these docs exist;
- do not fork/embed MoneyPrinterTurbo;
- do not create a second editor/project/job/playback architecture;
- docs must reflect the current project, not a greenfield rewrite.

Exit criteria:

- all three documents exist on the Automation Foundation branch;
- implementation order is explicit;
- provider and persistence boundaries are explicit;
- AI-video work is visibly deferred behind AssetRouter.

## Phase A1 — ContentBrief Foundation

Goal: establish the first persistent Automation domain object without calling external providers.

Work:

- add `automation` subtree to project snapshot schema;
- define `ContentBrief` validation/normalization;
- migrate existing project snapshots safely;
- add input signature helper;
- add stale dependency metadata foundation;
- add unit tests for schema migration and brief validation;
- no UI redesign yet; a minimal entry surface may be added only after domain tests pass.

Must reuse:

- `core-project-snapshot.js` schema/migration philosophy;
- `core-project-persistence.js` persistence path;
- current localization and product guardrails.

Exit criteria:

- old projects still restore;
- brief survives close/reopen;
- invalid brief never enters project state;
- no provider secret is persisted;
- current Import/Studio workflow remains regression-green.

## Phase A2 — ScriptEngine

Goal: `ContentBrief → editable ScriptDocument`.

Work:

- define provider-neutral text-generation adapter;
- implement one initial text provider adapter using existing backend/provider conventions;
- create script job with canonical job states;
- progress/cancel/retry behavior;
- duplicate request protection;
- result normalization;
- script provenance and signature;
- script editing with downstream stale-state rules;
- bilingual user-facing statuses.

Do not:

- generate assets yet;
- render a video directly from script;
- couple script document to a specific model/provider response.

Exit criteria:

- one real brief can generate a script;
- script remains editable;
- retry does not destroy accepted user edits;
- close/reopen restores script and job/result state;
- provider failure is normalized and recoverable.

## Phase A3 — ScenePlanner

Goal: `ScriptDocument → editable ScenePlan`.

Work:

- scene schema and stable scene IDs;
- narration-to-scene segmentation;
- timing hints;
- visual intent;
- search terms;
- asset strategy field;
- scene editing;
- partial stale propagation;
- tests for structural vs non-structural edits.

Exit criteria:

- a script becomes ordered scenes;
- scene plan is persisted;
- user can edit scene narration/visual intent/search terms;
- only affected downstream work becomes stale.

## Phase A4 — AssetRequest + AssetRouter

Goal: create the provider-neutral media routing foundation before integrating any AI-video generator.

Work:

- `AssetRequest` schema;
- `AssetCandidate` / `AssetRef` normalization;
- provider capability model;
- provider priority/fallback policy;
- request validation;
- result filtering by aspect/duration/type;
- normalized provider errors;
- cancellation and retry;
- diagnostics that do not expose secrets.

Explicit gate:

**No AI-video provider is allowed in this phase.**

Exit criteria:

- router can accept a scene request without knowing a concrete vendor in domain/UI code;
- unsupported/unconfigured providers fail cleanly;
- identical duplicate requests are protected;
- one scene can be re-resolved independently.

## Phase A5 — StockProvider + AssetCache

Goal: prove AssetRouter end-to-end with real footage before paid/generated-video integrations.

Work:

- implement one stock-video provider first;
- search and normalize candidates;
- safe download/materialization;
- local metadata validation;
- source-page/attribution provenance;
- request/result cache;
- file-integrity validation;
- missing cache file recovery;
- cancellation and network-failure behavior.

MoneyPrinterTurbo reference lessons:

- provider adapters normalize media records;
- aspect filtering happens before composition;
- provider metadata must be sanitized before durable storage;
- cached assets must still be validated before reuse.

Exit criteria:

- scene → real local stock clip works;
- project persists resolved asset provenance;
- cache reuse works;
- deleted/missing cached asset can recover;
- no signed URL/API secret enters project state.

## Phase A6 — CompositionEngine

Goal: `ScenePlan + AssetRefs → existing editable Studio timeline`.

Work:

- composition schema;
- map scene timings to visual clips;
- map narration/voice/subtitles to tracks;
- create/reuse existing timeline entities;
- preserve scene/asset provenance per clip;
- clip replacement;
- duration reconciliation;
- preview synchronization through the existing playback clock;
- project persistence and restore;
- render from the resulting editable project.

Hard rule:

The engine must not produce only a final MP4. The intermediate result must be editable in Studio.

Exit criteria:

- automation populates Studio;
- play/seek/timeline/transcript stay synchronized;
- user can replace one asset without regenerating the whole video;
- close/reopen restores composition;
- existing renderer produces an output file from the composition path.

## Phase A7 — Automation MVP End-to-End

Target real flow:

```text
Topic/Product
→ Brief
→ Script
→ Scenes
→ Stock assets
→ Existing Voice / Subtitle
→ Editable Timeline
→ Preview
→ Render
```

MVP verification must include:

- new project;
- restart recovery;
- failed provider request;
- cancel during long-running work;
- retry;
- duplicate-submit protection;
- edit script after generation;
- edit one scene;
- replace one asset;
- missing local asset;
- no network during provider step;
- render failure and retry;
- VI and EN UI;
- packaged/desktop runtime verification, not only Node tests.

At the end of A7:

1. write a Final Automation MVP Report;
2. list known limitations;
3. list regression results;
4. STOP;
5. wait for explicit approval before the next phase.

## Phase A8 — VariationEngine

Starts only after A7 approval.

Goal: create controlled variants from a stable editable base composition.

Possible dimensions:

- alternate hook/script;
- alternate stock asset selection;
- pacing;
- voice;
- subtitle style.

Rules:

- variations remain project-linked;
- no hidden full regeneration when only one dimension changes;
- preserve reproducibility/seed where practical;
- user can inspect/edit each variant before render.

## Phase A9 — AI Image / AI Video Providers

Starts only after AssetRouter + AssetCache + editable composition are proven.

Goal: add generated media as new provider adapters, not a new pipeline.

Order:

1. generated image provider;
2. optional image-to-video path;
3. text-to-video provider;
4. provider selection/fallback/cost policy;
5. generation progress/cancel/retry;
6. generated asset provenance and cache.

All generated media must become ordinary normalized `AssetRef` objects before CompositionEngine sees them.

## Phase A10 — Publishing / Batch Automation

Deferred until editing + automation generation are stable.

Potential scope:

- batch variations;
- scheduled generation;
- export presets;
- social publishing connectors;
- project templates;
- usage/cost controls.

This phase must not be used to justify bypassing editor/project/job invariants established earlier.

## Regression gates for every Automation phase

Every phase must preserve:

- app startup;
- Import page interactions;
- Studio navigation;
- play/pause/seek/volume/fullscreen;
- one playback clock;
- transcript editing;
- timeline synchronization;
- project persistence;
- source-file recovery;
- speech/translation/voice workflows;
- render/export;
- cancellation/retry;
- VI/EN localization;
- Electron security baseline.

Run targeted tests plus the relevant commercial/core regression suite. Native/runtime changes require an actual desktop run.

## Branch discipline

Recommended implementation branch sequence:

```text
feat/automation-foundation          # A0 docs + A1 domain foundation
feat/automation-script-engine       # A2
feat/automation-scene-planner       # A3
feat/automation-asset-router        # A4
feat/automation-stock-assets        # A5
feat/automation-composition         # A6
feat/automation-mvp                 # A7 integration/hardening
```

Do not stack unrelated UI polish, startup debugging, and provider integrations in the same feature commit.

## Definition of Automation Foundation success

Automation Foundation is successful when Viral AI Tool can create a video project from a topic/product while remaining a creator workstation:

- generation is automated;
- the result is not locked;
- every important intermediate artifact is inspectable/editable;
- providers can be swapped without rewriting the product;
- existing editor/playback/job/project systems remain authoritative;
- the user can recover from failure without restarting the whole workflow.
