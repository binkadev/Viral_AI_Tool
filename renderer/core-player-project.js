(function attachProjectPlayerMode() {
  "use strict";
  window.ViralCoreInstallProjectPlayer = function installProjectPlayer({ makeControls, releaseLegacy }) {
    const model = window.ViralCorePlayerModel;
    let host = null, signature = "", project = null, pendingVisual = null, pendingGeneration = null;
    let timelineProjection = null, timelineDock = null, timelineSelection = null, timelineLocale = null;
    let entryProjection = null, entriesById = new Map(), indicatorScene = null;
    let active = false, queued = false;
    let volume = 1, muted = false;
    const text = (key, vars) => window.I18N.t(state.locale === "en" ? "en" : "vi", "projectPreview." + key, vars);
    const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
    function setControlAvailability(control, disabled) {
      // Loading is temporary. Keep accessibility/capability state in step with
      // the owning clock so a loading classification cannot strand Play.
      control.disabled = disabled;
      control.dataset.coreCapability = disabled ? "disabled" : "functional";
      if (disabled) control.setAttribute("aria-disabled", "true");
      else { control.removeAttribute("aria-disabled"); delete control.dataset.coreDisabledReason; }
    }
    const owns = video => video?.dataset?.coreProjectPreview === "true";
    const hasProject = () => !!window.ViralCoreProjectPersistence?.snapshot?.()?.scenePlan?.scenes?.length;
    function status(s) {
      if (!s.reason) return text(s.playbackState === "playing" ? "playing" : s.playbackState === "loading" ? "loading" : s.playbackState === "ended" ? "ended" : "paused");
      return text(s.reason);
    }
    async function bind(entry, asset, token, events) {
      if (!host || !active || !runtime.valid(token)) return null;
      const result = await window.desktopAPI.getMediaPreviewUrl({ localPath: asset.localPath, kind: asset.kind });
      if (!runtime.valid(token) || !host?.isConnected) return null;
      if (!result?.ok) { events.error(result?.code); return null; }
      const node = document.createElement(asset.kind === "video" ? "video" : "img");
      node.dataset.coreProjectPreview = "true"; node.dataset.sceneId = token.sceneId; node.dataset.assetId = token.assetId;
      node.className = asset.kind === "video" ? "preview-video core-player-media" : "core-project-image";
      if (asset.kind === "video") { node.preload = "auto"; node.playsInline = true; node.volume = volume; node.muted = muted; }
      else node.alt = asset.name || text("scene", { number: entry.order + 1 });
      host.prepend(node);
      let disposed = false, finish, loadTimeout;
      const dispose = () => { if (disposed) return; disposed = true; clearTimeout(loadTimeout); if (asset.kind === "video") { node.pause(); node.removeAttribute("src"); node.load(); } node.remove(); finish?.(null); };
      pendingVisual = dispose; pendingGeneration = token.generation;
      node.addEventListener("timeupdate", () => events.time(node.currentTime));
      node.addEventListener("volumechange", () => { if (runtime.valid(token)) { volume = node.volume; muted = node.muted; } });
      node.addEventListener("ended", () => events.ended(node.currentTime));
      node.addEventListener("error", () => events.error());
      node.addEventListener("dblclick", event => { if (runtime.valid(token)) { event.preventDefault(); host.querySelector("[data-core-fullscreen]")?.click(); } });
      return new Promise(resolve => {
        finish = resolve;
        const ready = () => {
          if (!runtime.valid(token)) { dispose(); resolve(null); return; }
          clearTimeout(loadTimeout);
          if (asset.kind === "video") events.metadata(node.duration);
          resolve({ play: () => node.play(), pause: () => asset.kind === "video" && node.pause(),
            seek: time => { if (asset.kind === "video") node.currentTime = time; }, dispose });
        };
        node.addEventListener(asset.kind === "video" ? "loadedmetadata" : "load", ready, { once: true });
        node.addEventListener("error", () => { dispose(); resolve(null); }, { once: true });
        loadTimeout = setTimeout(() => { events.error(); dispose(); }, 15000);
        node.src = result.url;
      });
    }
    function renderTimeline(s, projection) {
      const dock = document.querySelector("#page .core-editor-bottom-dock");
      if (!dock) return;
      dock.dataset.projectPreview = "true";
      setText(dock.querySelector(".core-track-labels>.core-track-label:nth-child(2) span"), text("projectTimeline"));
      if (timelineProjection === projection && timelineSelection === project.scenePlan.selectedSceneId && timelineLocale === state.locale && timelineDock === dock) return;
      timelineProjection = projection; timelineSelection = project.scenePlan.selectedSceneId; timelineLocale = state.locale; timelineDock = dock; indicatorScene = null;
      const lane = dock.querySelector("[data-track-video]"), ruler = dock.querySelector("[data-time-ruler]");
      if (!lane || !ruler) return;
      lane.replaceChildren(); ruler.replaceChildren();
      dock.querySelector("[data-track-audio]")?.replaceChildren(); dock.querySelector("[data-track-subtitle]")?.replaceChildren();
      let unresolved = dock.querySelector("[data-project-unresolved]");
      if (!unresolved) { unresolved = document.createElement("div"); unresolved.dataset.projectUnresolved = "true"; dock.querySelector('[data-bottom-pane="timeline"]').append(unresolved); }
      unresolved.replaceChildren();
      for (let i = 0; i <= 6; i++) { const tick = document.createElement("span"); tick.className = "core-ruler-tick"; tick.style.left = i / 6 * 100 + "%"; tick.textContent = model.formatClock(s.duration * i / 6); ruler.append(tick); }
      for (const e of projection.entries) {
        const button = document.createElement("button"); button.type = "button"; button.dataset.projectSceneClip = e.sceneId;
        button.dataset.projectId = s.projectId; button.textContent = e.title || text("scene", { number: e.order + 1 });
        button.setAttribute("aria-label", text("clipLabel", { scene: button.textContent, status: text(e.playableState) }));
        button.title = button.getAttribute("aria-label"); button.className = "core-project-scene-clip";
        button.classList.toggle("is-edit-selected", e.sceneId === project.scenePlan.selectedSceneId);
        if (e.projectEnd != null && e.projectStart != null && s.duration > 0) {
          button.style.left = e.projectStart / s.duration * 100 + "%"; button.style.width = e.duration / s.duration * 100 + "%"; lane.append(button);
        } else { button.classList.add("is-unresolved"); button.textContent += " · " + text("timingPending"); button.disabled = e.projectStart == null; unresolved.append(button); }
      }
      dock.querySelector("[data-bottom-timeline-empty]").hidden = true;
      window.dispatchEvent(new CustomEvent("viral-ai:project-timeline-rendered", { detail: { projectId: s.projectId, generation: s.generation } }));
    }
    function changed(s, projection) {
      if (!active || !host?.isConnected) return;
      if (pendingGeneration !== s.generation) { pendingVisual?.(); pendingVisual = null; }
      if (entryProjection !== projection) { entryProjection = projection; entriesById = new Map(projection.entries.map(e => [e.sceneId, e])); }
      const ratio = model.seekRatio(s.currentTime, s.duration), clock = model.formatClock(s.currentTime) + " / " + (s.complete ? model.formatClock(s.duration) : "--:--");
      setText(host.querySelector("[data-core-time]"), clock);
      const seek = host.querySelector("[data-core-seek]"); if (seek) { seek.value = String(Math.round(ratio * 1000)); seek.disabled = !s.duration; seek.setAttribute("aria-label", text("position")); seek.setAttribute("aria-valuetext", clock); }
      const play = host.querySelector("[data-core-play]");
      if (play) { setText(play, s.playRequested ? "❚❚" : "▶"); setControlAvailability(play, s.playbackState === "loading" && !s.playRequested); play.title = text(s.playRequested ? "pause" : "play"); play.setAttribute("aria-label", play.title); play.setAttribute("aria-pressed", String(s.playRequested)); }
      let notice = host.querySelector("[data-project-preview-status]");
      if (!notice) { notice = document.createElement("p"); notice.dataset.projectPreviewStatus = "true"; notice.setAttribute("role", "status"); host.append(notice); }
      const e = entriesById.get(s.activeSceneId);
      host.querySelectorAll("[data-core-volume], [data-core-mute]").forEach(control => { setControlAvailability(control, e?.kind !== "video"); });
      const fullscreen = host.querySelector("[data-core-fullscreen]"); if (fullscreen) { fullscreen.title = text("fullscreen"); fullscreen.setAttribute("aria-label", fullscreen.title); }
      setText(notice, (e ? e.title || text("scene", { number: e.order + 1 }) : "") + " · " + status(s));
      host.dataset.corePlaybackState = s.playbackState; host.dataset.activePlaybackSceneId = s.activeSceneId || "";
      renderTimeline(s, projection);
      const dock = document.querySelector("#page .core-editor-bottom-dock");
      setText(dock?.querySelector("[data-bottom-time]"), clock);
      const playhead = dock?.querySelector("[data-bottom-playhead]"); if (playhead) playhead.style.left = ratio * 100 + "%";
      if (indicatorScene !== s.activeSceneId) document.querySelectorAll("[data-project-scene-clip], [data-project-scene-row]").forEach(node => {
        const current = (node.dataset.projectSceneClip || node.dataset.projectSceneRow) === s.activeSceneId;
        node.classList.toggle("is-playback-active", current); node.setAttribute("aria-current", String(current));
        if (node.dataset.projectSceneRow) {
          let label = node.querySelector("[data-playback-indicator]");
          if (current && !label) { label = document.createElement("span"); label.dataset.playbackIndicator = "true"; node.append(label); }
          if (current) setText(label, text("active")); else label?.remove();
        }
      });
      indicatorScene = s.activeSceneId;
      // Observational sync only. It must never feed player-seek or persistence.
      window.dispatchEvent(new CustomEvent("viral-ai:player-sync", { detail: { ...s, authority: "project-preview", ratio, paused: s.playbackState !== "playing", ended: s.playbackState === "ended" } }));
    }
    const runtime = window.ViralCoreProjectPlaybackRuntime.create({ model, bind, changed });
    function scan() {
      queued = false;
      const next = document.querySelector('#page .editor-grid .preview'), snapshot = window.ViralCoreProjectPersistence?.snapshot?.();
      if (state.page !== "ai-video" || !next || !snapshot?.scenePlan?.scenes?.length) {
        if (active) { active = false; runtime.dispose(); pendingVisual?.(); pendingVisual = null; host?.querySelectorAll("[data-core-project-preview]").forEach(node => node.remove()); host = null; signature = ""; }
        return;
      }
      const content = JSON.stringify([snapshot.projectId, snapshot.scenePlan.scenes, snapshot.mediaAssembly, snapshot.media.assets]);
      if (host !== next) {
        releaseLegacy?.();
        active = true; runtime.dispose(); pendingVisual?.(); pendingVisual = null; host = next; signature = ""; timelineDock = null;
        host.dataset.projectPreview = "true"; host.classList.add("core-player-host", "preview-real"); host.tabIndex = 0;
        host.querySelectorAll("video").forEach(video => { video.dataset.coreProjectPreview = "true"; });
        makeControls(null, host);
        host.querySelectorAll("video, img, .preview-center, .core-media-state").forEach(node => { if (node.tagName === "VIDEO") node.pause(); node.remove(); });
      }
      project = snapshot; indicatorScene = null;
      if (signature !== content) { signature = content; timelineDock = null; runtime.load(snapshot); }
      else changed(runtime.snapshot(), runtime.projection());
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(scan); } }
    function projectChanged() {
      // Invalidate synchronously at the durable mutation/switch event, before
      // a queued old DOM callback can run and before the next layout frame.
      const next = window.ViralCoreProjectPersistence?.snapshot?.();
      if (active && next && JSON.stringify([next.projectId, next.scenePlan.scenes, next.mediaAssembly, next.media.assets]) !== signature) {
        runtime.dispose(); pendingVisual?.(); pendingVisual = null;
      }
      queue();
    }
    document.addEventListener("click", event => {
      if (!active) return;
      const target = event.target.closest?.("[data-core-play], [data-project-scene-clip]");
      if (!target) return;
      if (target.dataset.projectSceneClip) { if (target.dataset.projectId !== project.projectId) return; runtime.seekScene(target.dataset.projectSceneClip); }
      else if (!host.contains(target)) return;
      else runtime.toggle();
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    document.addEventListener("input", event => {
      if (!active || !host.contains(event.target) || !event.target.matches("[data-core-seek]")) return;
      runtime.seek(Number(event.target.value) / 1000 * runtime.snapshot().duration); event.stopImmediatePropagation();
    }, true);
    document.addEventListener("keydown", event => {
      if (!active || !event.target.closest?.("#page") || event.target.closest("input,textarea,select,button,[contenteditable]") || event.altKey || event.ctrlKey || event.metaKey) return;
      const s = runtime.snapshot();
      if ([" ", "k", "K"].includes(event.key)) runtime.toggle();
      else if (event.key === "Home") runtime.seek(0);
      else if (event.key === "End") runtime.seek(s.duration);
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") runtime.seek(s.currentTime + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 5));
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    new MutationObserver(records => { if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !n.closest?.("[data-project-preview-status], [data-project-scene-clip], [data-time-ruler], [data-project-audio], [data-project-audio-clip], [data-project-subtitle]")))) queue(); }).observe(document.getElementById("page"), { childList: true, subtree: true });
    window.addEventListener("viral-ai:core-state-changed", projectChanged);
    window.addEventListener("viral-ai:project-snapshot-restored", projectChanged);
    window.addEventListener("viral-ai:project-snapshot-saved", projectChanged);
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:player-seek", event => { if (active && event.detail?.authority === "project-preview" && event.detail.projectId === project.projectId && event.detail.generation === runtime.snapshot().generation) runtime.seek(event.detail.currentTime); });
    queue();
    return { active: () => active, owns, hasProject, runtime, refresh: queue, sync: () => changed(runtime.snapshot(), runtime.projection()) };
  };
})();
