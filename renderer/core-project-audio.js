(function installProjectAudio() {
  "use strict";
  const model = window.ViralCoreProjectAudioModel, persistence = window.ViralCoreProjectPersistence;
  if (!model || !persistence) return;
  let queued = false, cache = null, catalog = [], service = "checking", catalogTask = null, sample = null, previewEpoch = 0, feedback = null;
  const player = () => window.ViralCorePlayer?.projectPreview;
  const active = () => state.page === "ai-video" && !!persistence.snapshot()?.scenePlan?.scenes?.length;
  const t = (key, vars) => window.I18N.t(state.locale === "en" ? "en" : "vi", "projectAudio." + key, vars);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function projection(project) {
    const canonical = window.ViralCorePlayerModel.buildProjectPlayback(project), live = player()?.runtime.projection();
    // Runtime-only verified metadata can resolve a duration under Block 3 rules.
    return !canonical.complete && live?.projectId === project.projectId && live.entries.length === canonical.entries.length &&
      live.entries.every((e,i) => e.sceneId === canonical.entries[i].sceneId && e.assetId === canonical.entries[i].assetId) ? live : canonical;
  }
  const runtime = window.ViralCoreProjectAudioRuntime.create({ model, persistence, desktop: window.desktopAPI, playback: projection,
    id: () => "project-voice-" + window.crypto.randomUUID(), changed: queue });
  const followers = window.ViralCoreProjectAudioFollowers.create({ model, audio: () => new Audio(),
    resolveUrl: source => window.desktopAPI.getMediaPreviewUrl(source),
    authority: () => player()?.active() ? player().runtime.snapshot() : null, changed: queue });
  window.ViralCoreProjectAudio = { active, runtime, followers };
  function stopSample() { previewEpoch++; if (sample) { sample.pause(); sample.removeAttribute("src"); sample.load(); sample = null; } }
  function data() {
    const project = persistence.snapshot();
    if (!project) return null;
    const playback = projection(project), key = JSON.stringify([project.projectId, playback, project.workflow.speech, project.workflow.translation,
      project.scenePlan.scenes.map(s => [s.id,s.sourceText,s.sourceSegmentIds,s.start,s.end]), project.workflow.voice, project.workflow.renderOptions, project.media.assets]);
    if (cache?.key === key) return cache;
    const plan = model.voicePlan(project, playback);
    cache = { key, project, playback, plan, liveProjection: player()?.runtime.projection(), settings: model.normalizeSettings(project.workflow.renderOptions) }; return cache;
  }
  function loadCatalog() {
    if (catalogTask) return catalogTask;
    service = "checking";
    catalogTask = Promise.all([window.desktopAPI.getVoiceStatus(), window.desktopAPI.getVoiceCatalog()]).then(([status,response]) => {
      catalog = status?.ready && response?.ok && response.data?.ready ? (response.data.voices || []).filter(v => typeof v.id === "string" && v.id.length <= 160) : [];
      service = status?.ready && response?.ok && response.data?.ready ? "serviceReady" : "voiceUnavailable";
    }).catch(() => { service = "voiceUnavailable"; catalog = []; }).finally(queue);
    return catalogTask;
  }
  function renderTimeline(value) {
    if (!player()?.active()) return;
    const dock = document.querySelector(".core-editor-bottom-dock[data-project-preview='true']");
    if (!dock) return;
    const { project, playback, plan, settings } = value, voice = model.currentVoice(project, plan), bgm = model.resolveBgm(project);
    const key = JSON.stringify([project.projectId, playback, plan.cues, !!voice, bgm?.id, settings.burnSubtitles, state.locale]);
    const audioLane = dock.querySelector("[data-track-audio]"), subLane = dock.querySelector("[data-track-subtitle]");
    if (!audioLane || !subLane || dock.__projectAudioKey === key && (audioLane.childElementCount || subLane.childElementCount || !voice && !bgm && !plan.cues.length)) return;
    dock.__projectAudioKey = key; dock.dataset.projectAudioReady = "true";
    const label = dock.querySelector("[data-audio-label] span"); if (label) label.textContent = t("audioLane");
    const subLabel = dock.querySelector(".core-track-label:last-child span"); if (subLabel) subLabel.textContent = t("subtitles");
    audioLane.classList.remove("is-unavailable"); dock.querySelector("[data-audio-label]")?.classList.remove("is-unavailable");
    audioLane.replaceChildren(); subLane.replaceChildren();
    const clip = (lane, kind, start, end, text) => {
      if (!(playback.duration > 0) || end <= start) return;
      const button = document.createElement("button"); button.type = "button"; button.dataset.projectAudioClip = kind;
      button.dataset.projectId = project.projectId; button.dataset.start = String(start);
      button.className = "core-project-audio-clip is-" + kind; button.style.left = start / playback.duration * 100 + "%";
      button.style.width = (end - start) / playback.duration * 100 + "%"; button.textContent = text; button.title = text; button.setAttribute("aria-label", text); lane.append(button);
    };
    if (voice) for (const cue of plan.cues) clip(audioLane, "voice", cue.start, cue.end, t("voiceCue", { text: cue.text }));
    if (bgm) clip(audioLane, "bgm", 0, playback.duration, t("bgmCue", { name: bgm.name }));
    if (settings.burnSubtitles) for (const cue of plan.cues) clip(subLane, "subtitle", cue.start, cue.end, cue.text);
  }
  function subtitle(value, sync) {
    const host = document.querySelector('.preview[data-project-preview="true"]');
    if (!host) return;
    let overlay = host.querySelector("[data-project-subtitle]");
    if (!overlay) { overlay = document.createElement("div"); overlay.dataset.projectSubtitle = "true"; overlay.setAttribute("aria-live", "off"); host.append(overlay); }
    overlay.setAttribute("aria-label", t("subtitles"));
    const cue = value.settings.burnSubtitles ? model.cueAt(value.plan.cues, sync.currentTime) : null;
    const text = cue?.text || ""; if (overlay.textContent !== text) overlay.textContent = text; overlay.hidden = !text;
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(refresh); } }
  function refresh() {
    queued = false;
    if (!active()) {
      followers.dispose(); stopSample(); catalogTask = null;
      document.querySelectorAll("[data-project-subtitle], [data-project-audio], [data-project-audio-clip]").forEach(n => n.remove());
      document.querySelectorAll(".core-inspector-card-voice[hidden]").forEach(n => { n.hidden = false; });
      document.querySelectorAll("[data-project-audio-ready]").forEach(n => { delete n.dataset.projectAudioReady; });
      return;
    }
    const value = data(); if (!value) return;
    try { runtime.reconcile(value.project.projectId); } catch { feedback = "saveFailed"; }
    const current = data(), { project, plan, settings } = current;
    const pane = document.querySelector('[data-inspector-pane="voice"]');
    if (pane) {
      pane.querySelectorAll(".core-inspector-card-voice").forEach(node => { node.hidden = true; });
      let section = pane.querySelector("[data-project-audio]");
      if (!section) { section = document.createElement("section"); section.dataset.projectAudio = "true"; section.className = "core-project-audio"; section.tabIndex = -1; pane.prepend(section); }
      section.dataset.projectId = project.projectId; section.setAttribute("aria-label", t("title"));
      const view = runtime.view(project.projectId), job = project.workflow.voice.job;
      const result = model.currentVoice(project, plan), stale = !!project.workflow.voice.staleResult?.projectId;
      const status = feedback || (view.error ? errorKey(view.error) : view.busy ? view.state : result ? "voiceReady" :
        job?.projectId && ["interrupted","cancelled","failed"].includes(job.status) ? job.status : stale ? "voiceStale" : job?.projectId ? job.status : "noVoice");
      const key = JSON.stringify([current.key, view, catalog, service, status, state.locale, t("title")]);
      if (section.__audioKey !== key) {
        const focused = section.contains(document.activeElement) ? { field: document.activeElement.dataset.audioSetting, speaker: document.activeElement.dataset.audioSpeaker,
          action: document.activeElement.dataset.audioAction, previewSpeaker: document.activeElement.dataset.previewSpeaker } : null;
        section.__audioKey = key;
        const options = (items, selected) => items.map(([id,label]) => '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(label) + '</option>').join("");
        const toggle = (field,label) => '<label class="core-audio-toggle"><input type="checkbox" data-audio-setting="' + field + '"' + (settings[field] ? ' checked' : '') + '><span>' + esc(t(label)) + '</span></label>';
        const volume = field => '<label><span>' + esc(t(field)) + '</span><input type="range" min="0" max="1" step="0.05" data-audio-setting="' + field + '" value="' + settings[field] + '" aria-label="' + esc(t(field)) + '"></label>';
        const mappings = ["speaker-1", ...plan.speakers.filter(s => s !== "speaker-1")];
        const assignments = project.workflow.voice.assignments || {};
        const voiceSelect = speaker => {
          const selected = assignments[speaker] || "", voices = catalog.map(v => [v.id, v.name || v.label || v.id]);
          if (selected && !voices.some(v => v[0] === selected)) voices.unshift([selected,t("savedVoiceUnavailable")]);
          return '<label><span>' + esc(speaker === "speaker-1" ? t("narrator") : t("speaker", { number: plan.speakers.indexOf(speaker)+1 })) + '</span><select data-audio-speaker="' + esc(speaker) + '">' + options([["",t(speaker === "speaker-1" ? "chooseVoice" : "useDefault")],...voices],selected) + '</select></label>' +
            (speaker !== "speaker-1" ? '<button type="button" data-audio-action="preview" data-preview-speaker="' + esc(speaker) + '"' + (!plan.cues.length || !catalog.some(v=>v.id===(selected || assignments["speaker-1"])) ? ' disabled' : '') + '>' + esc(t("previewVoice")) + '</button>' : '');
        };
        const audioAssets = project.media.assets.filter(a => !!model.resolveBgm(project,a.id));
        section.innerHTML = '<h3>' + esc(t("title")) + '</h3><fieldset><legend>' + esc(t("subtitles")) + '</legend>' + toggle("burnSubtitles","showSubtitles") +
          '<label><span>' + esc(t("textSource")) + '</span><select data-audio-setting="textSource">' + options(["auto","source","translation"].map(k=>[k,t(k)]),settings.textSource) + '</select></label>' +
          '<p>' + esc(t(plan.available ? "activeSource" : "translationUnavailable", { source: t(plan.resolvedSource) })) + '</p></fieldset>' +
          '<fieldset><legend>' + esc(t("voice")) + '</legend><p>' + esc(t(service)) + '</p>' + mappings.map(voiceSelect).join("") +
          '<div class="core-audio-actions"><button type="button" data-audio-action="preview"' + (!plan.cues.length || !catalog.some(v=>v.id===assignments["speaker-1"]) ? ' disabled' : '') + '>' + esc(t("previewVoice")) + '</button>' +
          '<button type="button" data-audio-action="generate"' + (!plan.ready || service !== "serviceReady" || view.busy ? ' disabled' : '') + '>' + esc(t("generate")) + '</button>' +
          '<button type="button" data-audio-action="cancel"' + (!view.busy || view.state === "cancelling" ? ' disabled' : '') + '>' + esc(t("cancel")) + '</button></div>' +
          (!plan.ready ? '<p>' + esc(t(plan.reason)) + '</p>' : '') + '<p role="status" aria-live="polite" data-project-voice-status>' + esc(t(status)) +
          (view.busy && view.percent != null ? ' ' + esc(t("progress", { percent: Math.round(view.percent) })) : '') + '</p>' +
          (result?.segments.some(s=>s.timingRisk) ? '<p>' + esc(t("timingRisk")) + '</p>' : '') +
          toggle("voiceEnabled","voiceEnabled") + volume("voiceVolume") + '</fieldset>' +
          '<fieldset><legend>' + esc(t("bgm")) + '</legend><label><span>' + esc(t("bgmAsset")) + '</span><select data-audio-setting="bgmAssetId">' +
          options([["",t("noMusic")],...audioAssets.map(a=>[a.id,a.name])],settings.bgmAssetId || "") + '</select></label>' + volume("bgmVolume") + toggle("bgmLoop","loop") + '<p>' + esc(t("importGuidance")) + '</p></fieldset>' +
          '<p role="status" aria-live="polite" data-project-audio-preview-status>' + esc(followers.status().unavailable ? t("previewUnavailable") : "") + '</p>';
        if (focused) {
          const target = [...section.querySelectorAll("input,select,button")].find(n => !n.disabled && (focused.field ? n.dataset.audioSetting === focused.field : focused.speaker ? n.dataset.audioSpeaker === focused.speaker : n.dataset.audioAction === focused.action && n.dataset.previewSpeaker === focused.previewSpeaker));
          (target || section).focus();
        }
      }
      if (!catalogTask) loadCatalog();
    }
    renderTimeline(current);
    const sync = player()?.runtime.snapshot();
    if (player()?.active() && sync?.projectId === project.projectId) {
      subtitle(current,sync); followers.sync({ ...sync, authority: "project-preview", paused: sync.playbackState !== "playing", ended: sync.playbackState === "ended" },project,plan);
    }
  }
  function errorKey(value) { return ["chooseVoice","alreadyRunning","voiceUnavailable","voiceFailed","saveFailed","cancelFailed"].includes(value) ? value : "operationFailed"; }
  // New cue buttons use the existing Project seek authority before the legacy
  // stage's pointer scrub handler can interpret a button center as a seek point.
  document.addEventListener("pointerdown", event => {
    if (player()?.active() && event.target.closest?.("[data-project-audio-clip]")) event.stopPropagation();
  }, true);
  document.addEventListener("click", event => {
    const clip = event.target.closest?.("[data-project-audio-clip]");
    if (!clip || !player()?.active() || clip.dataset.projectId !== persistence.activeProjectId()) return;
    player().runtime.seek(Number(clip.dataset.start)); event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  document.addEventListener("change", event => {
    const control = event.target, section = control.closest?.("[data-project-audio]"); if (!section) return;
    const projectId = section.dataset.projectId;
    if (projectId !== persistence.activeProjectId()) return;
    try {
      feedback = null;
      if (control.dataset.audioSetting) {
        const field = control.dataset.audioSetting, value = control.type === "checkbox" ? control.checked : control.type === "range" ? Number(control.value) : field === "bgmAssetId" ? control.value || null : control.value;
        persistence.updateProjectAudioSettings(projectId,{ [field]: value });
      } else if (control.dataset.audioSpeaker) persistence.updateProjectVoice(projectId,{ action:"assign",speaker:control.dataset.audioSpeaker,voiceId:control.value });
    } catch { feedback = "saveFailed"; }
    cache = null; queue();
  });
  document.addEventListener("click", async event => {
    const button = event.target.closest?.("[data-audio-action]"); if (!button || button.disabled || event.detail > 1) return;
    const projectId = button.closest("[data-project-audio]")?.dataset.projectId;
    if (projectId !== persistence.activeProjectId()) return;
    feedback = null;
    if (button.dataset.audioAction === "generate") { stopSample(); runtime.generate(projectId); }
    else if (button.dataset.audioAction === "cancel") runtime.cancel(projectId);
    else {
      stopSample(); const token = previewEpoch, value = data();
      if (player()?.runtime.snapshot().playbackState === "playing") { feedback = "pauseForPreview"; queue(); return; }
      try {
        const speaker = button.dataset.previewSpeaker || "speaker-1";
        const response = await window.desktopAPI.previewVoice({ voiceId: value.project.workflow.voice.assignments[speaker] || value.plan.assignments.defaultVoiceId,
          language: value.plan.language, text: (value.plan.cues.find(c=>c.speaker===speaker) || value.plan.cues[0]).text.slice(0,220) });
        if (token !== previewEpoch || projectId !== persistence.activeProjectId()) return;
        if (!response?.ok) throw Error();
        const url = await window.desktopAPI.getMediaPreviewUrl({ localPath: response.data.audioPath, kind: "audio" });
        if (token !== previewEpoch || projectId !== persistence.activeProjectId()) return;
        if (!url?.ok) throw Error(); sample = new Audio(url.url); await sample.play();
      } catch { if (token === previewEpoch) feedback = "previewUnavailable"; }
    }
    queue();
  });
  window.desktopAPI?.onVoiceProgress?.(runtime.progress);
  window.addEventListener("viral-ai:player-sync", event => {
    if (!active() || event.detail?.authority !== "project-preview" || !player()?.active()) return;
    const owner = player().runtime.snapshot(), sync = event.detail;
    if (owner.projectId !== sync.projectId || owner.generation !== sync.generation || sync.projectId !== persistence.activeProjectId()) return;
    if (!sync.paused) stopSample();
    const value = cache?.project.projectId === sync.projectId && cache.liveProjection === player().runtime.projection() ? cache : data(); if (!value) return;
    subtitle(value,sync); followers.sync(sync,value.project,value.plan);
  });
  function invalidate(event) {
    const current = persistence.snapshot();
    if (event.type !== "viral-ai:core-state-changed" || event.detail?.reason !== "project-audio" ||
        cache && current && model.voicePlan(current,projection(current)).inputSignature !== cache.plan.inputSignature) { followers.dispose(); stopSample(); }
    if (event.type === "viral-ai:project-snapshot-restored") document.querySelectorAll("[data-project-subtitle]").forEach(n => { n.textContent = ""; n.hidden = true; });
    cache = null; queue();
  }
  for (const name of ["viral-ai:core-state-changed","viral-ai:project-snapshot-restored","viral-ai:project-snapshot-saved","viral-ai:project-timeline-rendered","viral-ai:editor-preview-preserved"]) window.addEventListener(name,invalidate);
  window.addEventListener("viral-ai:project-snapshot-restored", () => { feedback = null; });
  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(records => {
      if (records.some(r => [...r.addedNodes,...r.removedNodes].some(n => n.nodeType === 1 && (n.matches?.(".core-editor-inspector,.preview,.core-editor-bottom-dock") || n.querySelector?.(".core-editor-inspector,.preview,.core-editor-bottom-dock"))))) queue();
    }).observe(page,{childList:true,subtree:true});
    queue();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",start,{once:true}); else start();
})();
