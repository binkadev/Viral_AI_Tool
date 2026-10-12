# Viral AI Tool — Project Continuity

This file is the durable source of truth for continuing the product across chats, agents, and implementation sessions.

## Product identity

Viral AI Tool is a Windows-first commercial creator workstation for turning ideas or source media into localized, publishable short-form video. It must feel like a professional desktop product, not a collection of disconnected AI utilities.

Core product principles:
- business/domain logic is defined before UI;
- UI is a projection of explicit state, not the owner of business state;
- original user media is non-destructive by default;
- commercial copy never exposes internal engines/providers unless the user is explicitly configuring a provider;
- every production feature follows `docs/PRODUCT_GUARDRAILS.md`;
- all user-facing copy is bilingual VI/EN;
- Premium Dark remains the approved default visual direction;
- product workflows must survive restart, missing files, cancellation, duplicate actions, provider/network failures, and partial completion.

## Architecture boundaries

Keep these layers distinct:

1. Product/domain contracts — entities, state machines, invariants.
2. Desktop/native services — local files, media processing, secure OS integration.
3. Cloud/backend services — secrets, provider APIs, publishing, account-bound operations, quotas.
4. Renderer — user interaction and state projection only.
5. Integrations — Telegram/Discord/Slack/email are external control/notification layers and must call shared services instead of owning business logic.

## Completed foundation

- Commercial shell / creator home
- Player and timeline synchronization
- Speech/transcript workstation
- Translation and AI voice foundation
- Export/render pipeline and recovery states
- Authentication, billing, cloud config, updater/installer foundations
- Project persistence and restart-safe snapshots
- Media library schema v1
- Local media classification/import foundation

## Current roadmap

### Block 5 — Media Engine (CURRENT)
Goal: turn the current source-only asset panel into a real project media library.

Required capabilities:
- local video/image/audio import;
- stock search through server-side provider adapters;
- provider-neutral normalized search results;
- safe preview metadata and attribution/license metadata;
- download-to-project with explicit lifecycle and cancellation;
- duplicate protection;
- local cache ownership and project ownership;
- favorites;
- missing-file recovery;
- restart-safe interrupted jobs;
- friendly VI/EN errors;
- no provider secrets in renderer or packaged desktop app.

Approved stock-provider rollout:
1. Pexels first.
2. Pixabay second.
3. Coverr only after commercial/API terms are reviewed and encoded in attribution rules.

Media asset lifecycle:
`ready | validating | queued | downloading | generating | verifying | cancelling | cancelled | failed | interrupted`

Remote stock download flow:
`idle -> validating -> queued -> downloading -> verifying -> ready`
with branches to `cancelling -> cancelled`, `failed`, or restart recovery to `interrupted`.

### Block 6 — AI Scene Planner
Script/transcript -> semantic scenes -> shot intent -> search/generation intent.

### Block 7 — Automated Media Matching
Rank stock/local/generated assets by semantic fit, orientation, duration, quality, duplicate score and visual diversity.

### Block 8 — Script to Full Video
Script -> scenes -> voice -> media -> captions -> timeline -> export.

### Block 9 — Publish Hub
Provider-neutral publication model and per-destination state.

### Block 10 — Social connections
TikTok, Instagram Reels, YouTube Shorts.

### Block 11 — Scheduling / publishing queue
Reliable queued publishing, retry, cancellation, account expiry recovery and audit trail.

### Block 12 — Analytics / growth loop
Published content performance -> channel insights -> future content recommendations.

Later: trends, viral score, A/B testing, revenue intelligence, Telegram, agency mode, autonomous agent workflows.

## UI/UX contract

The app must use one design language across every new feature:
- Premium Dark creator workstation;
- restrained motion/HUD accents;
- system typography from `AGENTS.md`;
- minimum readability floors from `AGENTS.md`;
- explicit states for empty/loading/working/success/error/recovery;
- no generic AI dashboard card spam;
- user-facing actions use familiar product language such as `Tìm tư liệu`, `Thêm vào dự án`, `Xuất video`, `Thử lại`, `Kết nối lại`;
- provider names may appear as source attribution or explicit provider configuration, but normal workflow copy stays task-oriented.

The Media area should converge toward:
- Project
- Media: Video / Images / Audio
- Discover: Search media / Generate with AI
- Generated: AI Video / AI Images / AI Voice
- Favorites

## Agent / Codex operating procedure

Before implementing a block:
1. read `AGENTS.md`;
2. read `docs/PRODUCT_GUARDRAILS.md`;
3. read this file;
4. inspect current master/branch rather than assuming previous chat state;
5. define or confirm state machine and ownership boundaries;
6. implement service/domain first when the feature has real business state;
7. add regression tests before considering the feature complete;
8. run the relevant test set and commercial regression gate;
9. review UI for VI/EN, accessibility, recovery, text expansion, and consistency;
10. update this file when roadmap/status/architecture changes.

Avoid multiple agents editing `main.js`, `preload.js`, `renderer/app.js`, or `renderer/i18n.js` concurrently unless worktrees and ownership are explicitly separated.

## New-chat handoff

When a chat/context ends, the next conversation should start with:

`Continue Viral AI Tool from the repository. Read AGENTS.md, docs/PRODUCT_GUARDRAILS.md, and docs/PROJECT_CONTINUITY.md first. Inspect the current branch/PR and latest commits before changing code. Continue from the CURRENT block and preserve all domain/state/UI contracts.`

If an active PR exists, include its number or branch name. The repository is authoritative; do not rely only on chat memory.
