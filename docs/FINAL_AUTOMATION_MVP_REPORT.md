# Final Automation MVP Report

Status: **Implementation complete on `feat/automation-mvp`; final desktop acceptance pending.**

This report closes the implementation portion of Phase A7. Per the roadmap, A8 must not start until the remaining desktop/runtime acceptance items are explicitly approved.

## 1. Delivered end-to-end flow

The Automation MVP now follows the real editable project path:

```text
Topic / Product
→ ContentBrief
→ editable ScriptDocument
→ editable ScenePlan
→ provider-neutral AssetRequest / AssetRouter
→ local stock AssetRef files
→ per-scene narration VoiceResult
→ editable CompositionPlan
→ existing Studio timeline / playback clock
→ preview
→ real MP4 export
```

The intermediate project remains editable. Automation does not replace Studio with a second editor and does not reduce the workflow to an opaque final MP4.

## 2. Implemented recovery / retry behavior

The MVP now preserves accepted work and resumes from the first invalid checkpoint instead of restarting the full project.

Implemented cases:

- interrupted Script job is recovered as retryable instead of remaining permanently `processing`;
- cancelled Script, asset resolution, voice generation, preview and export do not erase accepted upstream state;
- stale Script / Scene / Asset / Voice changes invalidate only dependent downstream work;
- missing persisted local stock files are detected and return the workflow to media recovery;
- missing persisted voice files make the old VoiceResult non-current and invalidate Composition;
- missing older export files are marked missing without corrupting project source state;
- provider failures surface as retryable checkpoint failures;
- output render cancellation cleans partial output;
- app-close while Composition export is active requires an explicit stop/continue decision;
- rerender creates a unique output path instead of silently overwriting an existing export.

## 3. Regression coverage added through A7

Automation-specific gates:

- `test:core-automation-foundation`
- `test:core-automation-script-engine`
- `test:core-automation-script-provider`
- `test:core-automation-creator`
- `test:core-automation-scene-planner`
- `test:core-automation-workspace`
- `test:core-automation-motion`
- `test:core-automation-mvp-controller`
- `test:core-automation-recovery`
- `test:core-automation-asset-router`
- `test:core-automation-stock-assets`
- `test:core-automation-composition`
- `test:core-automation-voice-track`
- `test:core-automation-studio-projection`
- `test:core-automation-composition-export`
- `test:core-automation-mvp-acceptance`

The commercial regression suite also retains project persistence, editor/playback, render-output integrity, media health, output recovery, motion policy and other shared-core gates.

## 4. Desktop runtime evidence already observed during implementation

The following behaviors have already been manually observed in the Electron development runtime during A5–A7 checkpoint testing:

- stock assets resolved for every scene and persisted locally;
- deleted local stock asset was detected and recoverable;
- CompositionPlan populated V1 and subtitle tracks;
- Automation Composition opened in the existing Studio;
- Studio used the shared video playback clock for projected timeline clips;
- `Quay lại Automation` returned from Studio to the Automation project after the navigation fix;
- Composition export created a playable MP4;
- export cancellation stopped the job without replacing the project source;
- closing the app during export displayed the stop/continue confirmation;
- A1 voice clips projected into the Studio timeline when the offline development voice provider was enabled.

These observations are useful evidence, but they do not replace the final packaged-runtime checklist below.

## 5. Final desktop acceptance checklist — still required

Before A7 is formally approved, run these on the Windows desktop app from the current branch. A packaged build smoke test is required in addition to `npm start`.

### Core end-to-end

- [ ] New Automation project: Brief → Script → Scenes → Assets → Voice → Composition → Studio → MP4.
- [ ] Result remains editable after opening Studio.
- [ ] VI UI flow is usable end-to-end.
- [ ] EN UI flow is usable end-to-end.

### Restart / resume

- [ ] Close/reopen after Script completion: Script and accepted edits remain.
- [ ] Force-close/reopen during Script generation: old job becomes retryable, not stuck.
- [ ] Close/reopen after Assets complete: local assets and provenance restore.
- [ ] Close/reopen after Voice complete: A1 restores if WAV files still exist.
- [ ] Close/reopen after Composition: timeline state restores and remains current.

### Failure / recovery

- [ ] Disable/unconfigure the text provider: friendly retry state; accepted work stays intact.
- [ ] Disable network for a real provider request: normalized failure; retry succeeds after network returns.
- [ ] Cancel long-running Script generation and continue from the same checkpoint.
- [ ] Cancel batch asset resolution and continue without losing already-resolved scenes.
- [ ] Cancel Voice generation and retry.
- [ ] Delete one local stock file, reopen project, recover only the missing scene asset.
- [ ] Delete one persisted voice WAV, reopen project, regenerate Voice/A1 without losing Script/Scenes/Assets.
- [ ] Trigger export failure or use an unavailable output folder, then retry successfully.
- [ ] Delete an older exported MP4: Library/history marks it missing without changing the project source.

### Editing / stale propagation

- [ ] Edit generated Script: Scenes/downstream are marked stale while the edited Script is preserved.
- [ ] Edit one Scene: dependent media/voice/composition recovery is clear and bounded.
- [ ] Replace one resolved asset: existing Composition becomes stale and rebuilds with the new asset only.
- [ ] Regenerate Voice after narration changes: old voice result is rejected as non-current.

### Studio / renderer invariants

- [ ] Play/pause/seek remains synchronized after Automation projection.
- [ ] Timeline clip click seeks the existing player; no second playback clock appears.
- [ ] `Quay lại Automation` works repeatedly after reopen/reprojection.
- [ ] Final MP4 contains expected video, subtitle and A1 audio tracks.
- [ ] Export cancellation leaves no partial MP4 behind.
- [ ] Starting a second identical export does not create a duplicate active render.
- [ ] Closing during export asks whether to continue or stop.

### Packaged Windows runtime

- [ ] `npm run pack` build launches successfully.
- [ ] Packaged app startup does not regress to the historical black-screen issue.
- [ ] Automation dev-provider checkpoint can run in packaged runtime when the required environment flags are present.
- [ ] ffmpeg-backed preview/export works from packaged `app.asar` / unpacked binary layout.
- [ ] Project persists across packaged app restart.

## 6. Known limitations at A7

1. The offline `dev-tone` voice provider is a workflow verification provider, not commercial Vietnamese TTS quality. A real voice provider remains a provider-integration task; the VoiceResult/A1/Composition contracts are already provider-neutral.
2. The development stock provider is synthetic and offline. Pexels can provide real stock when configured. Generated image/video providers remain intentionally deferred to A9.
3. A8 VariationEngine has not started. There is no automated multi-variant generation yet.
4. A10 publishing/batch scheduling has not started.
5. Persisted asset recovery checks file presence; AssetCache validates checksum when reused. The app does not decode/probe every persisted media file on every project reopen.
6. Final packaged Windows acceptance is still required before this report can be marked PASS.

## 7. A7 decision gate

Current decision:

```text
A7 implementation: COMPLETE
Automated regression contract: READY FOR LOCAL RUN
Electron development runtime: PARTIALLY VERIFIED
Packaged Windows runtime: PENDING
A7 final approval: PENDING USER ACCEPTANCE
A8: BLOCKED UNTIL EXPLICIT APPROVAL
```

Do not begin VariationEngine or AI image/video provider work until the final desktop acceptance checklist is confirmed and A7 is explicitly approved.
