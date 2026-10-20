# AI-first project lifecycle

Project snapshot schema **4** supports `projectKind: "ai"` with a durable
`projectId`, `projectName`, `source: null`, and the existing media, workflow,
editor, and scene-plan structures. A blank workspace alone creates no project.

Source-backed snapshots from schemas 0–3 explicitly migrate to schema 4 as
`projectKind: "imported"`. Their identity, name, source, media, and scene plan
are retained. Old source-less snapshots are not reinterpreted as AI projects.
Unknown future schemas remain protected from writes.

`ViralCoreProjectPersistence.ensureProject({ projectName })` reuses the current
project or creates an AI draft. It ensures one selected scene, writes the
canonical snapshot through the existing localStorage persistence mechanism,
and confirms the stored value before publishing the identity to the caller.
Creation failure leaves submission uncalled and reports a localized error.

Create AI enables Generate when the provider is ready, the prompt is nonempty,
the persistence API exists, and no submission is pending. The click locks
concurrent actions, ensures the durable project, validates its project/scene
IDs, and only then calls the existing GenerationService preload API. Prompt
editing, navigation, and rendering do not create projects. The existing
submission idempotency key remains in use.

The snapshot is authoritative on restart. An AI project's identity survives
the first source attachment through the normal verified-output Studio flow.
Subsequent snapshots retain that identity and the selected scene. A failed
autosave retains the last durable project rather than deleting its identity.

## Registry and normal project entry

`viral-ai-core-project-registry-v1` stores one version-1 record containing
`projects` (canonical schema-4 snapshots keyed by their `projectId`) and
`activeProjectId`. There is one active editor, playback clock, and existing job
system. Project count has no added cap; storage quota failures fail the write
without removing retained projects. The single localStorage write atomically
commits all snapshots and active selection.

On first use, the existing snapshot or valid source-backed legacy state is
imported with its existing identity. Registry migration is idempotent. On later
starts the registry is authoritative, even if the active snapshot mirror is stale.
The registry is inspected before any compatibility snapshot: even a future-schema
mirror cannot block a valid registry. Corrupt/unsupported registries and future
canonical snapshots inside them block mutation; an
invalid old source-less snapshot never becomes an AI project through migration.

The original snapshot key, legacy application projection, editor preference
keys, and generation brief key are compatibility mirrors. Failed mirror writes
do not undo a successful registry commit. The renderer keeps the selected
project's projection in memory and restart reconstructs it from the registry.

`ViralCoreProjectPersistence` exposes `listProjects()`, `activeProjectId()`,
`createProject({kind: "ai", projectName})`, `openProject(projectId)`, and `flush()`.
Create and switch first flush the active project. A failed registry write leaves
the current runtime and selection intact. Reopening the active project is a no-op.
Target validation and runtime/mirror preparation complete before the durable
commit. After commit, snapshot and runtime identity converge to the selected
project before best-effort presentation. Pause, DOM, render, and notification
failures emit presentation diagnostics rather than reporting that the old project
was retained; no storage-dependent rollback is attempted.
Concurrent create requests share a pending promise; the UI also rejects the second
event of a double click and blocks project actions while submission is pending.

Create AI has a separate **New AI Project / Dự án AI mới** button. It creates and
activates a clean AI snapshot with no source, empty media/workflow, reset playback
and selection, and one selected draft scene. The prompt is stored per project.
The Recent Projects list opens retained snapshots; Import Video remains separate.
Generate reuses the active project's persisted identity and selected scene.

Switching pauses/detaches the old player, replaces only project-owned runtime
fields, restores editor preferences, and routes source-backed projects to Studio
and source-less AI projects to Create AI. Locale, appearance, Cloud account,
billing, and provider catalogs remain global. Unscoped speech/translation/voice,
render, and scene-planning work must finish or be stopped before switching.
Existing generation/media jobs retain their existing project scoping. Preview
restoration tracks source objects rather than permanently caching file paths,
so reopening a retained project can restore its local preview again.

Tests exercise the real renderer persistence and Create AI functions in a VM
with simulated storage and submission responses. They cover creation,
concurrent clicks, storage failures, migration, restart, and source/media
attachment. They do not invoke a provider or prove live generation/playback.
Registry tests additionally exercise UI entry/switch events, state isolation,
failed flush/selection writes, mirror recovery, future-schema protection, and
reopening previews. The commercial suite includes these regressions.
Receipt V2 ownership, native verification, AssetRef publication, and the
existing Generation job system are unchanged.
