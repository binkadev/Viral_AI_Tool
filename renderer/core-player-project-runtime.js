(function attachProjectPlaybackRuntime(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectPlaybackRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function projectPlaybackRuntime() {
  "use strict";
  // The existing player owns this controller in Project mode; its legacy media
  // clock is suspended. Adapters render one active asset and never own a clock.
  function create({ model, bind, changed = () => {}, now = () => performance.now(), raf = requestAnimationFrame, cancel = cancelAnimationFrame }) {
    let project = {}, projection = model.buildProjectPlayback(), resolved = {}, binding = null, renderer = null;
    let generation = 0, frame = null, anchor = 0, anchorTime = 0, wanted = false;
    let entryMap = new Map(), assetMap = new Map(), starting = false, playAttempt = 0;
    let state = { projectId: null, generation: 0, currentTime: 0, duration: 0, playbackState: "paused", activeSceneId: null, activeAssetId: null, reason: null };
    const snapshot = () => ({ ...state, complete: projection.complete, playRequested: wanted });
    const entry = () => entryMap.get(state.activeSceneId);
    function rebuild() { projection = model.buildProjectPlayback(project, resolved); entryMap = new Map(projection.entries.map(e => [e.sceneId, e])); }
    const valid = token => !!binding && token === binding && token.projectId === state.projectId && token.generation === generation;
    function emit() { state.generation = generation; state.duration = projection.duration; changed(snapshot(), projection); }
    function stopFrames() { if (frame != null) cancel(frame); frame = null; }
    function release() {
      ++generation; ++playAttempt; starting = false; binding = null; stopFrames();
      const previous = renderer; renderer = null; previous?.pause?.(); previous?.dispose?.();
    }
    function pause(reason = null) { wanted = false; ++playAttempt; starting = false; stopFrames(); renderer?.pause?.(); state.playbackState = "paused"; state.reason = reason; emit(); }
    function runImage(token) {
      stopFrames(); anchor = now(); anchorTime = state.currentTime;
      const tick = timestamp => {
        frame = null; if (!valid(token) || !wanted || state.playbackState !== "playing") return;
        const current = entry(), time = Math.min(current.projectEnd, anchorTime + Math.max(0, timestamp - anchor) / 1000);
        state.currentTime = time;
        if (time >= current.projectEnd) { advance(token); return; }
        emit(); frame = raf(tick);
      };
      frame = raf(tick);
    }
    async function start(token) {
      if (!valid(token) || !renderer || !wanted || starting) return;
      starting = true; const attempt = ++playAttempt;
      try {
        if (entry().kind === "video") await renderer.play();
        if (!valid(token) || attempt !== playAttempt || !wanted) { if (valid(token) && !wanted) renderer?.pause?.(); return; }
        starting = false;
        state.playbackState = "playing"; state.reason = null; emit();
        if (entry().kind === "image") runImage(token);
      } catch { if (valid(token) && attempt === playAttempt) pause("play-rejected"); }
    }
    function events(token) {
      return {
        metadata(duration) {
          if (!valid(token) || entry().kind !== "video" || !(duration > 0) || !Number.isFinite(duration)) return;
          if (!(assetMap.get(token.assetId)?.meta?.duration > 0)) {
            resolved[token.assetId] = { ...resolved[token.assetId], duration };
            rebuild();
            const current = entry();
            if (current.playableState === "ready" && state.playbackState === "blocked") state.playbackState = "paused";
            state.reason = null; emit();
          }
        },
        time(time) {
          if (!valid(token) || state.playbackState !== "playing" || entry().kind !== "video") return;
          const current = entry(); if (!current.duration) return;
          state.currentTime = current.projectStart + model.clampTime(time, current.duration);
          if (time >= current.duration) advance(token); else emit();
        },
        ended(localTime) {
          if (!valid(token) || !wanted) return;
          if (Number.isFinite(localTime) && entry().duration && localTime + 1e-6 < entry().duration) { this.error(); return; }
          advance(token);
        },
        error(reason = "unavailable") {
          if (!valid(token)) return;
          resolved[token.assetId] = { ...resolved[token.assetId], state: reason === "missing-file" ? reason : "unavailable" };
          rebuild(); wanted = false;
          state.currentTime = entry().projectStart; state.playbackState = "blocked"; state.reason = entry().playableState;
          renderer?.pause?.(); stopFrames(); emit();
        }
      };
    }
    function activate(location, continuePlaying) {
      release(); wanted = continuePlaying;
      if (!location) { state.playbackState = "blocked"; state.reason = "missing-media"; emit(); return; }
      const current = location.entry;
      state.currentTime = location.currentTime; state.activeSceneId = current.sceneId; state.activeAssetId = current.assetId;
      state.playbackState = current.playableState === "ready" ? location.ended ? "ended" : "loading" : "blocked";
      state.reason = current.playableState === "ready" ? null : current.playableState;
      const token = Object.freeze({ projectId: state.projectId, sceneId: current.sceneId, assetId: current.assetId, generation }); binding = token;
      emit();
      const asset = assetMap.get(token.assetId);
      if (current.playableState !== "ready" && !(current.playableState === "duration-unresolved" && current.kind === "video")) { wanted = false; return; }
      // A new renderer per binding makes queued DOM events carry the old token.
      Promise.resolve().then(() => valid(token) ? bind({ ...current }, asset, token, events(token)) : null).then(result => {
        if (!valid(token)) { result?.dispose?.(); return; }
        if (!result) { events(token).error(); return; }
        renderer = result; renderer.seek?.(location.localTime);
        if (entry().playableState !== "ready") { wanted = false; emit(); return; }
        state.playbackState = location.ended ? "ended" : "paused"; emit();
        if (wanted && !location.ended) start(token);
      }).catch(error => { if (valid(token)) events(token).error(error?.code); });
    }
    function advance(token) {
      if (!valid(token)) return;
      const current = entry(), index = projection.entries.indexOf(current), next = projection.entries[index + 1];
      if (!current.duration) { pause("duration-unresolved"); return; }
      if (!next) { wanted = false; stopFrames(); renderer?.pause?.(); state.currentTime = current.projectEnd; state.playbackState = "ended"; emit(); return; }
      activate({ entry: next, localTime: 0, currentTime: current.projectEnd, ended: false }, wanted);
    }
    function load(next) {
      const prior = entry(), local = prior ? state.currentTime - prior.projectStart : 0, sameProject = project.projectId === next.projectId;
      release(); wanted = false; if (!sameProject) resolved = {};
      // Runtime metadata is bound to exact asset content, not reused after replacement.
      for (const id of Object.keys(resolved)) if (JSON.stringify(project.media?.assets?.find(a => a.id === id)) !== JSON.stringify(next.media?.assets?.find(a => a.id === id))) delete resolved[id];
      project = JSON.parse(JSON.stringify(next)); assetMap = new Map((project.media?.assets || []).map(a => [a.id, a])); rebuild();
      state = { ...state, projectId: project.projectId, currentTime: 0, playbackState: "paused", activeSceneId: null, activeAssetId: null, reason: null };
      const retained = sameProject && projection.entries.find(e => e.sceneId === prior?.sceneId && e.assetId === prior?.assetId && e.projectStart != null);
      const time = retained ? model.projectTimeForScene(projection, retained.sceneId, local) : Math.min(state.currentTime, projection.duration);
      activate(model.locateProjectTime(projection, time), false);
    }
    function seek(time) {
      const playing = wanted, location = model.locateProjectTime(projection, time);
      if (location && renderer && binding && location.entry.sceneId === binding.sceneId && location.entry.assetId === binding.assetId) {
        state.currentTime = location.currentTime; renderer.seek?.(location.localTime);
        if (location.ended) { wanted = false; stopFrames(); renderer.pause?.(); state.playbackState = "ended"; }
        else if (playing && location.entry.kind === "image") runImage(binding);
        else if (state.playbackState === "ended") state.playbackState = "paused";
        emit(); return;
      }
      activate(location, playing);
    }
    function play() {
      if (state.playbackState === "loading") return;
      if (state.playbackState === "blocked") {
        const current = entry();
        if (!current || !assetMap.has(current.assetId) || !["missing-file", "unavailable"].includes(state.reason)) return;
        delete resolved[current.assetId]; rebuild();
        activate(model.locateProjectTime(projection, state.currentTime), true); return;
      }
      if (state.playbackState === "playing") return;
      wanted = true;
      if (state.playbackState === "ended") { activate(model.locateProjectTime(projection, 0), true); return; }
      if (renderer) start(binding);
    }
    return { snapshot, projection: () => projection, load, seek, play, pause, toggle: () => wanted ? pause() : play(),
      seekScene(sceneId) { const time = model.projectTimeForScene(projection, sceneId); if (time != null) seek(time); },
      dispose() { wanted = false; release(); state.playbackState = "paused"; }, valid };
  }
  return { create };
});
