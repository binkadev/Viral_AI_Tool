# Content planning foundation

The canonical Project Registry remains the only persistence owner. Accepted
authoring is stored in `scenePlan.authoring` (version, origin, contentBrief,
script). Its ordered script beats have no Scene identity or timing. Persistence
allocates IDs with its existing UUID authority and creates ordinary canonical
Scenes, including purpose and material routing annotations, in one registry write.

Only an empty AI draft is eligible. An untouched initial empty Scene may be
replaced; any existing script, meaningful Scene, media, source or enrolled output
blocks authoring. Regeneration requires an explicitly created empty project.
Manual Scene edits retain the accepted script as the original authoring record;
they do not silently rewrite it or trigger another generation.
The existing Scene lifecycle now exposes a bounded `updateProjectScene` operation
for title and narration. Create's selected Scene editor uses that same atomic
operation; selection, reorder, add and delete continue through existing controls.

## Text adapter contract

There is **no configured production text adapter** in this revision. The existing
video and translation providers are inappropriate for script authoring. Create
shows an unavailable message and disables planning. Tests inject a deterministic
adapter only in test harnesses; no template is shipped as generated AI content.

A future trusted application composition root can supply
`window.ViralTextAuthoringAdapter` before `core-ai-create.js` loads. Its single
method is:

```js
async generate({ contentBrief, suggestedSceneCount, signal })
```

It must use an appropriate text-generation provider, honor cancellation, avoid
automatic retries, and return a structured object with `hook`, `body`, `cta` and
`beats`. Readiness currently means an adapter is installed; the adapter must
validate its own provider availability, resource and quota requirements before
starting an external request. This foundation adds no credentials or paid service.

Each beat contains `purpose`, `text`, `visualIntent`, `searchQueries`,
`generationPrompt`, `targetKinds`. First purpose is `hook`, last is `cta`, all
middle beats are `body`. Hook/CTA must equal their beat text; body must equal
middle beat texts joined by two newlines. Narration is derived in that same order.
The result is rejected as a whole if inconsistent or empty. See exported
validators in `renderer/core-content-plan.js` for exact limits: 3–12 beats,
2,000 characters per beat, 12,000 narration characters, up to eight unique
180-character search queries, 1,200-character visual intents and 1,600-character
generation prompts. Only existing `image`/`video` kinds are accepted.

Queries and prompts must describe the visual scene, not provider operations,
URLs or credentials. Providers should normally propose 4–6 scenes for a typical
short video; `suggestedSceneCount` is guidance, never a forced five-scene layout.
Neutral brief defaults do not invent audience demographics, claims or offers.
Original input is retained verbatim. Selected Create duration and orientation
take precedence; API callers can explicitly supply other supported brief values.

## Execution and safety

The existing planner states are reused, without another job engine:
`idle -> validating -> queued -> planning -> completed`, with `failed` or
`cancelling -> cancelled` exits. Candidates stay in memory until fully validated.
Duplicate invocations are rejected at runtime, and persistence independently
checks Project identity, original idea, pending Scene content and the captured
snapshot signature. A changed Project cannot receive a late result.

Cancellation aborts the request and abandons even an uncooperative adapter's
late result. Closing during planning prompts through the existing confirmation
dialog, focuses Keep waiting, and cancels only after Stop and close is chosen.
Page unload also aborts pending planning. There is no on-startup,
on-navigation, on-typing or preference-driven authoring. Failures make no plan
writes, expose localized VI/EN messages, and require an explicit retry.

Timing assigns a positive minimum to each beat and distributes the remaining
duration by narration length at millisecond precision. Boundaries are contiguous,
start at zero and end at the target duration. This is not speech alignment.

The downstream proof uses the actual `buildSceneActionPlan` and
`ViralProductionModel.classify`: generated queries/prompts change `no-source`
to `needs-sourcing`. No assets, video generation, speech, subtitles, music,
publishing or external notifications are executed by planning.

Run `npm run test:content-plan` and `npm run test:content-plan-desktop`. The latter
uses real Electron processes, disk-backed storage, reload and process restart,
while blocking network requests and injecting only the test text adapter.
