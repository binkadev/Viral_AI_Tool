# AI Create — Production Workspace

## Purpose

`Tạo bằng AI / Create with AI` is the production entry point for turning a brief into a video project. It must reuse the same project, Scene Planner, Media Engine, Studio, job lifecycle and export pipeline that already exist in Viral AI Tool.

It is not a second demo editor and it must never simulate a successful provider call.

## Current restored foundation

The generation foundation originally prototyped before v0.14.0 is restored as reusable services:

- `services/generation/model-catalog.js`
- `services/generation/cost-estimator.js`
- `services/generation/model-router.js`

The router is provider-neutral and supports three goals:

- `economy`
- `balanced`
- `quality`

The catalog is a routing snapshot, not proof that a provider is currently executable. Runtime provider availability must be confirmed by the backend/native boundary.

## Production flow

```text
Brief
  -> Script
  -> Scene Planner
  -> per-scene asset request
       -> existing project/library
       -> stock Media Engine
       -> AI generation provider when needed
  -> Voice / captions
  -> Studio composition
  -> Render
  -> Library
  -> Publishing
```

## Security boundary

Provider secrets must not be stored in the renderer.

```text
Renderer
  -> preload/native or Viral AI backend
  -> provider adapter
  -> provider API
```

The renderer may display provider/model status, plan limits, route previews and job progress, but it must not receive third-party secret keys.

## Current UI contract

The sidebar exposes:

```text
Tạo video
├─ Tạo bằng AI
├─ Nhập video
└─ Studio video
```

The AI Create page currently exposes the real project context and restored generation architecture while keeping the final Generate action disabled. This is intentional until execution is wired.

## Next block

1. Generation provider status contract.
2. Durable generation job schema and idempotency.
3. Provider adapter boundary.
4. Route preview from backend using the restored model router.
5. Credit reserve/settle policy.
6. Scene Planner -> asset request bridge.
7. Media Engine fallback order: project/library -> stock -> AI generation.
8. Persist generated assets into the same project and Studio timeline.
9. Cancel/retry/restart recovery regression tests.

No provider execution should be enabled before the job and billing lifecycle is durable.
