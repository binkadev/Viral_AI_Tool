# Generated media handoff: isolated desktop validation

Run from the repository in PowerShell:

```powershell
npm run dev:generated-handoff
```

The launcher supplies `VIRAL_AI_DEV_HANDOFF_FIXTURE=completed` and a fresh UUID
session. Unpackaged Electron, a non-production NODE_ENV, an exact allowed mode,
and a valid session are all required. An absent/invalid flag or packaged build
cannot load the harness. `dev/` is excluded from release files.

Each invocation creates a fresh `viral-ai-handoff-<session>` directory in the
Windows temporary directory. It sets both userData and sessionData **before**
the ordinary single-instance lock/session initialization. No real user profile,
lock, historical job, or previous generated output is read or changed. The
temporary profile and reports are retained for review.

The normal renderer, project registry, generated-media controller, native
GenerationService, IPC, media restoration, editor, and Studio remain in use.
No provider is registered and no Muse bridge starts. The isolated service also
rejects submit/retry/recover/cancel/history calls and native job reads for any
identity except the one explicitly enrolled by this run.

## What runs

1. Wait for the normal bootstrap's first-paint/Home route to settle, then create
   fresh AI project A and its single selected scene using createProject.
2. Enroll one new queued fixture job through registerGenerationJob/controller.
3. Create/select empty project B before completing the job.
4. Produce a one-second, 160×90, 12 fps H.264 MP4 directly in the job's native
   output directory using the **existing pinned ffmpeg-static dependency**.
   No video fixture exists in this repository; no new binary is installed.
   The test pattern, single-thread encoding, bitexact flags, and stripped
   metadata produce repeatable bytes on the installed runtime. Bytes are not
   claimed identical across different encoder versions/platforms.
5. Use GenerationService.finish to pin size/SHA-256 in outputVerification,
   and real getGenerationJob/getGenerationOutput IPC plus real probeVideo.
6. Let the existing generated-media controller attach to inactive A. Assert
   B remains empty and active. Open A; verify one canonical generated asset,
   one source, one enrollment/reference, and the original scene association.
7. Repeat native changed events, observe, render, and focus; assert no duplicate.
8. Click ordinary Studio navigation. Require the existing preview video element
   to decode the actual file, report native dimensions/duration, and have a
   visible computed layout with positive dimensions.
9. Flush the actual registry/session, exit this DEV instance, and launch a new
   Electron process using the same isolated profile. Require both projects,
   active A, the same identities/bytes, and decoded Studio preview again.

The second desktop remains open with a DEV status badge for human visual
inspection. Closing it finishes the command. There is no special handoff
button, parallel player, injected media asset, or injected attached snapshot.
Attachment reuses the single physical MP4 in native storage.

Reports: `first-pass.json`, `restart-pass.json`, `identity.json`, and native
`generation/jobs.json` in the printed temporary profile. The sibling `.log`
contains startup diagnostics. Reports include persisted outputVerification and
separate per-launch checks. Failed checks exit with a nonzero launcher status.

## Automated regressions and negative cases

```powershell
npm run test:generated-handoff
```

This runs guards/native tests and real Electron launches for successful
attachment/restart, persistence-failure, same-size byte tamper, noncompleted,
and legacy-unverified scenarios. `--verify` closes the second DEV window after
the assertions so automation can finish. Additional single scenarios:

```powershell
node dev/run-generated-handoff.js --verify --mode=persistence-failure
node dev/run-generated-handoff.js --verify --mode=tampered
node dev/run-generated-handoff.js --verify --mode=noncompleted
node dev/run-generated-handoff.js --verify --mode=legacy
```

Persistence-failure uses a static preload fault installed in the main world
**only** after main attests the exact isolated persistence-failure DEV mode.
It throws QuotaExceededError on the registry key while explicitly armed. The
ordinary persistence/controller catch path must leave A unchanged, report an
attachment error, and keep the native generation completed. This is fault
injection, not a claim to reproduce actual disk/quota exhaustion.

Tamper flips one byte without changing file size/identity after real native
verification. getGenerationOutput must reject it; attachment must fail. Original
bytes are restored only during DEV process shutdown, after the window closes.
Legacy removes the pin from this fresh DEV job only and must return
verified=false. Noncompleted leaves the job queued and cannot read an output.

The existing core-generated-media suite additionally covers the ordinary
import/enrichment path, missing files/metadata, source selection preservation,
and the actual localized progress error presentation without a retry loop.
Neither suite enrolls or backfills historical operations. These are local
handoff validations, not Muse generation/acquisition/ownership E2Es.
