# Viral AI Tool — Block 6 AI Scene Planner Specification

Status: foundation in progress.

Read this together with `AGENTS.md`, `docs/PRODUCT_GUARDRAILS.md`, and `docs/PROJECT_EXECUTION_HANDOFF.md`.

## Product outcome

Scene Planner turns the current script/transcript into a durable, editable visual plan before stock matching, AI media generation, or automatic timeline assembly.

The user must be able to understand and review *why* the project is split into scenes, what source text each scene owns, what visual direction is proposed, and which fields they have manually protected from future replanning.

Scene Planner is not an opaque one-click video generator.

## Ownership boundary

The project snapshot owns the accepted scene plan. A provider request/job is transient workflow state and must not become the durable scene-plan source of truth.

```text
Transcript / Script
      ↓
Scene Plan domain document     ← project-owned, durable
      ↓
AI suggestions / manual edits  ← normalized into the document
      ↓
Block 7 Media Matching
```

Provider/model names may be retained in provenance/diagnostics, but normal UI is task-oriented.

## Scene-plan schema

Top level:

```text
schemaVersion
sourceType: transcript | script
sourceIdentity
sourceSignature
status
plannerJob
scenes[]
selectedSceneId
createdAt
updatedAt
```

A scene contains:

```text
id
order
start
end
duration
sourceSegmentIds[]
sourceText
title
visualIntent
searchQueries[]
generationPrompt
targetKinds[]
orientation
shotType
motion
mood
confidence
sceneState: draft | suggested | edited | locked
lockedFields[]
provenance
createdAt
updatedAt
```

`sourceSignature` is a semantic change detector, not a security hash. If transcript/script content or timing changes, the planner can mark the existing plan stale instead of silently pretending it still matches.

## Manual edit contract

AI replanning must not silently overwrite manual decisions.

`lockedFields` can protect individual scene fields such as:

```text
timing
visualIntent
searchQueries
generationPrompt
targetKinds
orientation
shotType
motion
mood
```

A later replan/merge step must preserve locked fields. A full destructive replacement requires an explicit user action.

## Planner lifecycle

Long-running AI planning uses:

```text
idle
 -> validating
 -> queued
 -> planning
 -> completed

planning -> cancelling -> cancelled
planning -> failed
active state after restart -> interrupted
```

An existing accepted plan remains available if a new planner job fails or is cancelled.

## Deterministic segmentation foundation

Before any AI provider is introduced, transcript segmentation must work deterministically and be testable offline.

Initial rules:

- consume normalized transcript segments in time order;
- never invent source text or timestamps;
- create stable scene IDs from owned source segment IDs where possible;
- split on meaningful source gaps;
- target short-form visual beats while respecting minimum/maximum duration bounds;
- preserve all source segments exactly once;
- do not truncate long transcripts to demo-sized subsets;
- leave creative fields empty/default rather than fabricating AI suggestions.

This deterministic layer is the fallback and the input to the AI planner, not a competitor to it.

## Source staleness

A plan is stale when its `sourceSignature` differs from the current normalized transcript/script signature.

Staleness must be visible and recoverable:

- keep the old plan;
- explain that source content changed;
- offer re-plan/reconcile;
- never silently delete manual edits.

## Provider boundary

The later AI provider adapter receives a sanitized planning request and returns provider-neutral scene suggestions. API credentials stay backend-only for managed cloud providers.

Provider output is untrusted input:

- clamp timestamps/confidence;
- cap scene/query/prompt lengths;
- reject duplicate/invalid scene IDs;
- validate source ownership/ranges;
- do not accept URLs/filesystem paths as part of planner output;
- do not expose raw provider errors to renderer.

## Persistence and migration

Scene Plan requires a project snapshot schema evolution after the pure model is stable.

Migration requirements:

- existing projects open with an empty scene plan without inventing scenes;
- accepted scene plans survive restart;
- active planner jobs become `interrupted` unless a real resumable protocol exists;
- source signature is checked after transcript edits;
- semantic autosave includes plan changes but not transient provider response pages/logs.

## UI direction

The planner workbench should remain part of the creator workstation, not become a separate generic AI dashboard.

Recommended structure:

```text
Scenes
  01  00:00–00:05  source excerpt
  02  00:05–00:11  source excerpt
  ...

Selected scene
- Source
- Visual direction
- Search ideas
- Generate prompt
- Shot / motion / mood
- Confidence / source status
- Lock controls for manual decisions
```

Required states: empty, creating, ready, stale-source, cancelled, failed/retry, interrupted, and manually edited.

## Block 6 implementation slices

### 6A — Domain foundation
- pure scene-plan model;
- deterministic transcript segmentation;
- normalization, limits, source signature;
- field locks and manual edit semantics;
- restart-safe planner state;
- unit tests.

### 6B — Project persistence
- snapshot schema migration;
- scene-plan hydration/autosave;
- transcript-edit staleness propagation;
- reopen regression tests.

### 6C — AI planner provider contract
- backend-only managed provider boundary;
- provider-neutral request/response;
- validation, timeout, cancellation, public errors;
- tests without production secrets.

### 6D — Planner workbench
- premium workstation UI;
- VI/EN centralized copy;
- scene selection and editing;
- lock controls;
- loading/error/recovery states;
- accessibility and reduced motion.

### 6E — Replan/reconcile
- preserve locked/manual fields;
- show source changes;
- explicit replace/reconcile choice;
- prepare clean handoff to Block 7 Media Matching.
