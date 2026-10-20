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
autosave retains the last durable AI snapshot rather than deleting its identity.

Tests exercise the real renderer persistence and Create AI functions in a VM
with simulated storage and submission responses. They cover creation,
concurrent clicks, storage failures, migration, restart, and source/media
attachment. They do not invoke a provider or prove live generation/playback.
Receipt V2 ownership, native verification, AssetRef publication, and the
existing Generation job system are unchanged.
