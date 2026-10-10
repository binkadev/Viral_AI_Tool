# Viral AI Tool — Architecture V2

Status: **Automation Foundation architecture gate**  
Scope: architecture and contracts only. **No Automation business logic is implemented by this document.**

## 1. Why V2 exists

Viral AI Tool already has a working creator workstation: project persistence, import, playback, transcript, localization, voice, timeline/editor state, jobs, rendering, recovery, and a narrow Electron bridge.

The next phase adds automated video creation inspired by the workflow ideas in MoneyPrinterTurbo, while preserving the existing product as the source of truth.

MoneyPrinterTurbo is a **reference implementation only**. We do not fork it, embed it, vendor it, or rewrite Viral AI Tool around it.

## 2. Non-negotiable architecture rules

1. **One Project Model**  
   Automation data belongs to the same project snapshot as editor/workflow data. Do not introduce a second independent project format.

2. **One Editor**  
   Automation output must open in the existing Studio editor. Do not build a separate automation-only editor.

3. **One Playback Clock**  
   `video.currentTime` remains the authoritative playback position. Automation must not introduce another timer/clock for preview or timeline sync.

4. **One Job System**  
   Automation jobs use the same canonical lifecycle semantics already represented by `core-job-model.js`: preparing/uploading/processing/completed/failed/cancelled.

5. **Provider Neutral**  
   Domain and orchestration code must not depend on a specific LLM, stock library, image model, or video model. Provider-specific code stays behind adapters.

6. **Editable Output**  
   Automation produces an editable project/timeline plan first. Rendered MP4 is an output, not the primary source of truth.

## 3. Existing core that must be reused

### 3.1 Project persistence — REUSE + EXTEND

Current project snapshots already centralize source identity, workflow state and editor state. Automation extends this schema rather than creating a parallel store.

Existing responsibilities to preserve:

- schema-versioned project snapshot;
- source identity and file state;
- workflow results and jobs;
- editor playback position;
- timeline/panel persistence;
- migration from legacy state.

V2 adds an optional `automation` subtree to the project snapshot.

### 3.2 Job lifecycle — REUSE

Use the existing canonical job model for every long-running Automation stage.

Automation jobs must expose, where applicable:

- `id`;
- `type`;
- `status` / `state`;
- `progress` or indeterminate state;
- `error` / structured error code;
- `createdAt`, `updatedAt`;
- cancellation capability;
- retryability;
- input identity/signature.

Do not create a separate task-state vocabulary copied from MoneyPrinterTurbo.

### 3.3 Editor + timeline — REUSE + EXTEND

The existing Studio remains the only editing surface. Automation must project generated scenes/assets/subtitles/voice into editable editor state.

The existing player/timeline rules remain authoritative:

- one media clock;
- seek/playhead/transcript synchronization;
- persisted timeline selection/zoom/scroll;
- local file recovery;
- render/export only after required inputs are valid.

### 3.4 Provider bridges — REUSE + EXTEND

Speech, translation and voice already use provider-selection layers. Automation providers follow the same pattern.

New provider families are adapters behind stable contracts:

- LLM text generation;
- stock media search;
- image generation;
- AI video generation;
- optional music generation later.

### 3.5 Electron security boundary — REUSE

Keep the current security baseline:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- narrow preload APIs;
- validated IPC payloads;
- no generic shell-command bridge.

Automation must not expose arbitrary filesystem, process, network, or shell capabilities to the renderer.

## 4. Automation domain model

The Automation Foundation introduces explicit domain objects. These objects are provider-neutral and serializable.

### 4.1 `ContentBrief`

Represents user intent before script generation.

```js
{
  id,
  topic,
  product,
  objective,
  audience,
  platform,
  aspectRatio,
  targetDurationSec,
  language,
  tone,
  callToAction,
  constraints,
  createdAt,
  updatedAt
}
```

`topic` and `product` may both exist, but at least one meaningful creative input is required.

### 4.2 `ScriptDocument`

Provider-neutral script result.

```js
{
  id,
  briefId,
  version,
  title,
  hook,
  body,
  callToAction,
  narrationText,
  sourceProvider,
  model,
  inputSignature,
  createdAt
}
```

The user can edit the script. Downstream scene plans become stale when semantic script content changes.

### 4.3 `ScenePlan`

A deterministic, editable decomposition of the script.

```js
{
  id,
  scriptId,
  version,
  scenes: [
    {
      id,
      order,
      narration,
      startHintSec,
      durationHintSec,
      visualIntent,
      searchTerms,
      assetStrategy,
      transitionHint,
      subtitleText
    }
  ],
  createdAt
}
```

A scene is a creative unit, not a provider request.

### 4.4 `AssetRequest`

Describes what a scene needs without choosing a vendor.

```js
{
  id,
  sceneId,
  mediaType,
  query,
  aspectRatio,
  minDurationSec,
  desiredDurationSec,
  style,
  motion,
  negativeConstraints,
  strategy
}
```

`strategy` can begin with `stock` and later support `generated-image` / `generated-video` after AssetRouter is stable.

### 4.5 `AssetRef`

Normalized resolved media.

```js
{
  id,
  requestId,
  provider,
  providerAssetId,
  type,
  localPath,
  previewPath,
  sourcePage,
  width,
  height,
  durationSec,
  license,
  attribution,
  checksum,
  cacheKey,
  createdAt
}
```

Never persist provider secrets or signed URLs as durable project data.

### 4.6 `CompositionPlan`

The bridge from automation to the existing editor.

```js
{
  id,
  scenePlanId,
  durationSec,
  tracks: {
    video: [],
    audio: [],
    subtitle: []
  },
  sourceAssets: [],
  voiceResultId,
  subtitleResultId,
  version,
  createdAt
}
```

The composition plan must be convertible into the existing editable timeline representation. It must not be a hidden render-only recipe.

### 4.7 `VariationSpec`

Optional controlled mutation of a finished plan.

```js
{
  id,
  baseCompositionId,
  seed,
  dimensions: {
    hook,
    script,
    assetSelection,
    pacing,
    voice,
    subtitleStyle
  }
}
```

Variations always derive from a stable base project and never create an unrelated second project format.

## 5. Service boundaries

```text
User input
   ↓
ContentBrief
   ↓
ScriptEngine
   ↓
ScriptDocument
   ↓
ScenePlanner
   ↓
ScenePlan
   ↓
AssetRequestBuilder
   ↓
AssetRouter ──→ Provider adapters ──→ AssetCache
   ↓
Resolved Scene Assets
   ↓
CompositionEngine
   ↓
Editable CompositionPlan
   ↓
Existing Studio Editor / Timeline
   ↓
Existing Voice + Subtitle + Render paths
```

### `ScriptEngine` — NEW

Responsibilities:

- validate brief;
- build provider-neutral request;
- invoke LLM adapter;
- normalize raw text into `ScriptDocument`;
- persist provenance and input signature;
- support retry/cancel;
- never write directly to timeline DOM.

### `ScenePlanner` — NEW

Responsibilities:

- split edited script into scene units;
- assign timing hints;
- produce visual intent and search terms;
- preserve stable scene IDs across non-structural edits where possible;
- mark downstream asset/composition results stale after structural edits.

### `AssetRequestBuilder` — NEW

Creates one or more normalized media requests per scene.

### `AssetRouter` — NEW

Responsibilities:

- choose a provider from capability + policy, not UI conditionals;
- support fallback order;
- normalize provider results;
- reject invalid aspect/duration/media;
- keep provider credentials out of persisted project state;
- return explicit failure reasons.

**AI Video providers are not allowed before this router contract is stable.**

### `StockProvider` — NEW adapter family

MVP provider class for stock footage. Start with one provider implementation, but keep the interface multi-provider.

### `AssetCache` — NEW

Responsibilities:

- content/request-key based reuse;
- local file existence validation;
- checksum or equivalent integrity marker;
- eviction policy later;
- never make cache presence the only source of project truth.

### `CompositionEngine` — NEW

Responsibilities:

- map scenes + assets + narration/subtitles/voice into tracks;
- resolve durations and clip boundaries;
- create editable timeline entities;
- keep source-to-scene provenance;
- no final-render-only black box.

### `VariationEngine` — NEW, after composition is stable

Produces controlled variants from stable domain objects. It is not a recursive "generate everything again" button.

## 6. What is learned from MoneyPrinterTurbo

Useful reference patterns observed in MoneyPrinterTurbo:

- a task orchestrator coordinates script, material, voice/subtitle and final composition;
- script generation and material-term generation are separate concerns;
- material providers are normalized behind shared material structures;
- stock sources and generated sources can coexist behind one material layer;
- downloaded material is cached and provider metadata is sanitized before persistence;
- task progress/failure is explicit;
- video aspect, clip duration, concat mode and source strategy are modeled as request data rather than scattered UI flags.

What we intentionally **do not copy**:

- its Python service topology;
- its `VideoParams` object as our project model;
- its render-first workflow;
- its task state constants;
- its WebUI/API architecture;
- provider names embedded into our domain;
- direct coupling of script generation to final video generation.

Viral AI Tool keeps its Electron creator workstation and editable project architecture.

## 7. REUSE / EXTEND / NEW map

| Area | Decision | V2 direction |
| --- | --- | --- |
| Project snapshot | EXTEND | Add `automation` subtree with schema migration |
| Editor / Studio | REUSE | Automation output opens here |
| Playback clock | REUSE | `video.currentTime` remains authoritative |
| Job lifecycle | REUSE | Existing canonical state model |
| Import / file health | REUSE | Generated/downloaded assets use same recoverability principles |
| Speech | REUSE | Existing local/cloud path |
| Translation | REUSE | Existing provider path |
| Voice | REUSE | Existing provider path |
| Render | REUSE + EXTEND | Render consumes editable composition/timeline |
| Provider pattern | EXTEND | Add text/stock/image/video adapter families |
| ContentBrief | NEW | Automation input domain |
| ScriptEngine | NEW | Brief → editable script |
| ScenePlanner | NEW | Script → scene plan |
| AssetRequestBuilder | NEW | Scene visual intent → normalized requests |
| AssetRouter | NEW | Capability/policy-based provider routing |
| StockProvider | NEW | First Automation media provider family |
| AssetCache | NEW | Durable local asset reuse/integrity |
| CompositionEngine | NEW | Scenes/assets → editable timeline |
| VariationEngine | NEW | Controlled variants after stable composition |
| AI Video provider | DEFER | Only after AssetRouter gate passes |

## 8. Persistence shape

Proposed additive snapshot shape:

```js
project = {
  schemaVersion,
  source,
  workflow,
  editor,
  automation: {
    brief,
    script,
    scenePlan,
    assetRequests,
    assets,
    composition,
    variations,
    jobs
  }
}
```

Rules:

- `automation` is optional for existing projects;
- old projects migrate without losing current workflow/editor state;
- provider tokens, API keys and signed download URLs are never persisted here;
- generated results include provenance and input signatures;
- downstream artifacts can be marked stale instead of silently overwritten;
- user-edited script/scene/composition data is authoritative over previous generated output.

## 9. Staleness / dependency rules

```text
ContentBrief edit
  → Script may be stale
  → ScenePlan stale
  → Assets stale
  → Composition stale

Script semantic edit
  → ScenePlan stale
  → Assets stale
  → Composition stale

Scene visual-intent edit
  → affected AssetRequests stale
  → affected Composition clips stale

Asset replacement
  → Composition stale for affected scene only

Subtitle text edit
  → subtitle/render stale
  → visual assets remain valid
```

Never silently discard completed user work. Preserve prior generated output as stale/recoverable where practical, following the existing translation/voice stale-result pattern.

## 10. Failure and recovery policy

Every Automation stage must define:

- validation errors before a paid/provider request;
- duplicate-submit protection;
- cancellation behavior;
- retry behavior;
- network/provider timeout behavior;
- partial result behavior;
- stale input detection;
- local file missing/relink behavior;
- user-facing safe errors;
- internal diagnostic detail;
- persistence after restart.

A later phase is not allowed to depend on an implicit successful happy path.

## 11. V2 architecture gate

This document is accepted only together with:

- `docs/AUTOMATION_ENGINE.md`
- `docs/PHASE_ROADMAP.md`

After these documents exist, implementation starts with `ContentBrief`, not with a provider API or AI-video model.
