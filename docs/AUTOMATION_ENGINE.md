# Viral AI Tool — Automation Engine

Status: **Foundation specification**  
This file defines domain contracts, orchestration, state transitions, and provider boundaries before implementation.

## 1. Purpose

Automation turns a high-level creative request into an editable Viral AI Tool project:

```text
topic / product / brief
→ script
→ scenes
→ asset requests
→ resolved assets
→ voice + subtitle inputs
→ editable timeline composition
→ preview
→ render
```

The engine does not bypass Studio. Its primary output is an editable project state.

## 2. Engine invariants

- One project owns all Automation artifacts.
- A generated artifact always records the input identity/signature that created it.
- User edits are never silently overwritten by a retry.
- Every paid or remote action performs validation before provider invocation.
- Every long-running step uses the existing job lifecycle semantics.
- Cancellation must leave the project in a recoverable state.
- Provider-specific payloads do not leak into domain objects.
- Automation must be resumable after app restart.
- Rendering is downstream of editable composition, not the Automation source of truth.

## 3. Foundation pipeline

### Stage A — `ContentBrief`

Input may begin with a topic, product, campaign idea, or structured brief.

Validation minimum:

- at least one meaningful topic/product input;
- supported output language;
- valid aspect ratio;
- positive target duration;
- bounded freeform constraints;
- normalized platform intent.

Output: persisted `ContentBrief`.

No provider call is required in this stage.

### Stage B — `ScriptEngine`

Input: `ContentBrief`.

Output: `ScriptDocument`.

Responsibilities:

1. calculate a stable input signature;
2. reject duplicate active requests with the same signature;
3. construct an LLM-provider-neutral request;
4. invoke one configured text provider;
5. normalize output;
6. validate non-empty narration and length constraints;
7. persist result + provider provenance;
8. mark previous downstream plan/assets/composition stale only after a valid new script is accepted.

Suggested contract:

```ts
interface ScriptEngine {
  generate(input: {
    brief: ContentBrief;
    signal?: AbortSignal;
  }): Promise<ScriptDocument>;
}
```

Provider contract:

```ts
interface TextGenerationProvider {
  id: string;
  isConfigured(): Promise<boolean> | boolean;
  generateScript(input: ProviderScriptRequest, ctx: ProviderContext): Promise<ProviderScriptResult>;
}
```

The provider result is normalized before entering project state.

### Stage C — `ScenePlanner`

Input: editable `ScriptDocument`.

Output: `ScenePlan`.

MVP planner responsibilities:

- break narration into coherent scene units;
- estimate duration from total target duration and narration distribution;
- generate visual intent per scene;
- generate search terms per scene;
- preserve narration text linkage;
- assign stable scene IDs;
- produce subtitle seed text;
- choose an asset strategy without selecting a provider.

A scene plan should remain human-editable before assets are fetched.

Suggested contract:

```ts
interface ScenePlanner {
  plan(input: {
    brief: ContentBrief;
    script: ScriptDocument;
    signal?: AbortSignal;
  }): Promise<ScenePlan>;
}
```

The first implementation may use deterministic rules plus a text provider. The persisted output must not depend on raw provider JSON.

### Stage D — `AssetRequestBuilder`

Input: `ScenePlan`.

Output: `AssetRequest[]`.

Each scene can yield one primary request and optional fallbacks.

Example:

```js
{
  id: "asset-request:scene-03:primary",
  sceneId: "scene-03",
  mediaType: "video",
  query: "night street food market vietnam handheld",
  aspectRatio: "9:16",
  minDurationSec: 3,
  desiredDurationSec: 5,
  strategy: "stock",
  style: ["realistic", "energetic"],
  negativeConstraints: ["watermark", "wrong orientation"]
}
```

### Stage E — `AssetRouter`

Input: one `AssetRequest`.

Output: one or more normalized `AssetRef` candidates, then a selected `AssetRef`.

Router responsibilities:

- evaluate provider capability;
- check provider configuration;
- use configured provider priority;
- optionally consult cache before network;
- search/generate candidates;
- reject unusable candidates;
- rank candidates;
- download/resolve the selected asset locally;
- validate local file existence and media metadata;
- persist sanitized provenance;
- fallback to another provider when policy allows.

Suggested contracts:

```ts
interface AssetRouter {
  resolve(request: AssetRequest, ctx: AssetResolveContext): Promise<ResolvedAsset>;
}

interface AssetProvider {
  id: string;
  capabilities: AssetProviderCapabilities;
  isConfigured(): Promise<boolean> | boolean;
  search?(request: AssetRequest, ctx: ProviderContext): Promise<AssetCandidate[]>;
  generate?(request: AssetRequest, ctx: ProviderContext): Promise<AssetCandidate[]>;
  materialize(candidate: AssetCandidate, ctx: ProviderContext): Promise<AssetRef>;
}
```

`search` is for stock/library providers. `generate` is reserved for later image/video providers.

### Stage F — `AssetCache`

The cache is a performance/cost layer, not project truth.

Cache lookup key should be derived from normalized request/provider parameters, not from transient signed URLs.

Minimum record:

```js
{
  cacheKey,
  provider,
  providerAssetId,
  localPath,
  checksum,
  width,
  height,
  durationSec,
  createdAt,
  lastUsedAt
}
```

Cache hit validation:

1. record exists;
2. file still exists;
3. integrity marker matches where practical;
4. media metadata remains acceptable for request.

If validation fails, treat as cache miss and recover without corrupting project state.

### Stage G — `CompositionEngine`

Input:

- `ContentBrief`;
- `ScriptDocument`;
- `ScenePlan`;
- resolved assets;
- optional voice result;
- subtitle/timed text result.

Output: `CompositionPlan` projected into the existing Studio timeline.

Composition responsibilities:

- assign one or more visual clips to each scene;
- resolve clip in/out points;
- fit source aspect to project canvas;
- create subtitle track items;
- attach narration/voice clips when available;
- preserve source attribution and scene linkage;
- create deterministic ordering;
- avoid overlapping clips unless the editor supports the intended overlap explicitly;
- stay editable after projection.

No `CompositionEngine` method should invoke final rendering itself.

### Stage H — `VariationEngine`

Input: stable base automation artifacts.

Output: controlled variations.

MVP variation dimensions may include:

- alternate hook;
- alternate stock selection;
- pacing;
- subtitle style;
- voice assignment.

Variation is deferred until base composition is stable.

## 4. Project state proposal

```js
automation: {
  version: 1,
  brief: ContentBrief | null,
  script: ScriptDocument | null,
  scenePlan: ScenePlan | null,
  assetRequests: AssetRequest[],
  resolvedAssets: AssetRef[],
  composition: CompositionPlan | null,
  variations: VariationSpec[],
  jobs: {
    script: Job | null,
    scenes: Job | null,
    assets: Job[],
    composition: Job | null,
    variation: Job | null
  },
  stale: {
    script: boolean,
    scenes: boolean,
    assets: string[],
    composition: boolean
  }
}
```

The exact persisted representation can evolve, but the dependency semantics are required.

## 5. Job semantics

Automation adopts existing canonical states.

Recommended stage phases may be more specific internally while mapping to canonical state:

| Automation phase | Canonical state |
| --- | --- |
| validating | preparing |
| planning | processing |
| requesting | processing |
| searching | processing |
| downloading | processing |
| composing | processing |
| cancelling | processing |
| completed | completed |
| failed | failed |
| stale | failed/stale according to current model |
| cancelled | cancelled |

UI may show a friendly phase label while business logic depends on canonical state.

## 6. Identity and deduplication

Every generated artifact needs a stable identity and input signature.

Example signature inputs:

```text
ScriptDocument signature
= normalized(ContentBrief fields that affect script)

ScenePlan signature
= script semantic content + target duration + aspect/platform constraints

AssetRequest signature
= scene visual intent + query + media type + aspect + duration + strategy

Composition signature
= ordered scene IDs + selected asset IDs + timings + voice/subtitle versions
```

Rules:

- identical active request → do not submit twice;
- identical completed request → allow reuse where user has not invalidated it;
- provider/model may be part of signature when it materially affects reproducibility;
- secrets are never part of persisted signatures.

## 7. Stale-result handling

Use the existing philosophy already present for translation/voice stale results.

When an upstream artifact changes:

- keep previous downstream artifact available as stale where useful;
- clearly mark it stale;
- do not silently render stale assets/composition as current;
- let user retry/regenerate only the affected layer.

Examples:

- changing one scene's search terms should not invalidate unrelated downloaded assets;
- replacing one asset should invalidate affected composition mapping, not the whole script;
- changing subtitle style should not trigger a new script or stock search.

## 8. Provider-neutral error model

Normalize provider failures before state/UI.

Suggested error codes:

```text
INVALID_INPUT
PROVIDER_NOT_CONFIGURED
AUTH_REQUIRED
QUOTA_EXCEEDED
RATE_LIMITED
NETWORK_ERROR
PROVIDER_TIMEOUT
PROVIDER_REJECTED
NO_RESULTS
UNSUPPORTED_REQUEST
DOWNLOAD_FAILED
FILE_INVALID
CANCELLED
STALE_INPUT
UNKNOWN
```

Provider raw messages may be retained in diagnostics, but customer-facing UI follows project guardrails.

## 9. MoneyPrinterTurbo reference mapping

MoneyPrinterTurbo demonstrates several useful concepts:

- script generation separated from term/material generation;
- a central task orchestrator;
- explicit `VideoParams` request configuration;
- `MaterialInfo` normalization;
- stock search through providers such as Pexels/Pixabay;
- generated media and stock media living under one material layer;
- material caching;
- final composition after script/material/voice/subtitle stages.

Automation Foundation adapts those concepts into Viral AI Tool's existing project/editor architecture instead of importing its implementation.

Mapping:

| MoneyPrinterTurbo concept | Viral AI Tool adaptation |
| --- | --- |
| `VideoParams.video_subject` | `ContentBrief.topic/product` |
| script generation | `ScriptEngine` |
| video terms | `ScenePlanner.searchTerms` + `AssetRequestBuilder` |
| `MaterialInfo` | normalized `AssetCandidate` / `AssetRef` |
| material search/download | `AssetRouter` + `StockProvider` |
| material cache | `AssetCache` |
| task orchestration | existing Job System + Automation orchestrator |
| final video composition | `CompositionEngine` → editable Studio timeline |
| video-source provider switch | provider capability router |

## 10. AI-video gate

Text-to-video / image-to-video providers are intentionally deferred.

They may be added only when all of these are true:

- `AssetRequest` schema is stable;
- `AssetRouter` supports at least one stock provider end-to-end;
- cache/materialization/recovery work;
- provider errors are normalized;
- scene-to-asset replacement works without rebuilding the project;
- composition accepts provider-neutral `AssetRef`.

Then an AI-video provider is just another `AssetProvider` implementation rather than a new architecture.

## 11. Foundation implementation order

```text
ContentBrief domain
→ ScriptEngine
→ ScenePlanner
→ AssetRequestBuilder
→ AssetRouter
→ StockProvider
→ AssetCache
→ CompositionEngine
→ VariationEngine
```

No reordering that starts with a model API, image generator, or AI-video provider.

## 12. MVP success flow

The Automation MVP is complete when a real desktop run can perform:

```text
Topic/Product
→ ContentBrief saved
→ Script generated and editable
→ Scenes generated and editable
→ Stock assets resolved/downloaded
→ Existing voice/subtitle paths applied as needed
→ Editable Studio timeline populated
→ Preview works on one playback clock
→ User can change a scene/asset
→ Project can close/reopen without losing automation state
→ Render produces a file
```

At MVP completion: produce a report, stop implementation, and wait for explicit approval before AI-video providers or broad variation/publishing expansion.
