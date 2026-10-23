(function attach(root, factory) {
  const node = typeof module !== "undefined" && module.exports;
  const api = factory(node ? require("./core-player-model") : root.ViralCorePlayerModel,
    node ? require("./core-project-audio-model") : root.ViralCoreProjectAudioModel);
  if (node) module.exports = api;
  if (root) root.ViralCoreProjectRenderModel = api;
})(typeof window !== "undefined" ? window : globalThis, function(player, audio) {
  "use strict";
  const ACTIVE = ["validating", "queued", "preparing", "processing", "rendering", "cancelling"];
  const scoped = j => j?.isRenderOutput === true && j.renderKind === "project" && !!j.projectId && /^project-render-v1:[a-f0-9]{64}$/.test(j.renderInputSignature);
  function build(project, projection = player.buildProjectPlayback(project || {})) {
    const issues = [], fail = code => { if (!issues.includes(code)) issues.push(code); };
    const assets = new Map((project?.media?.assets || []).map(a => [a.id, a]));
    const ordered = [...(project?.scenePlan?.scenes || [])].sort((a,b) => a.order-b.order);
    if (!project?.projectId || !ordered.length || ordered.length > 2000 || !projection.complete || projection.projectId !== project.projectId || projection.entries.length !== ordered.length) fail("PROJECT_RENDER_INCOMPLETE");
    const identity = a => ({ assetId: a?.id, kind: a?.kind, localPath: a?.localPath, updatedAt: a?.updatedAt ?? null,
      meta: { duration: a?.meta?.duration ?? null, width: a?.meta?.width ?? null, height: a?.meta?.height ?? null, sizeBytes: a?.meta?.sizeBytes ?? null } });
    const canonical = player.buildProjectPlayback(project || {}); let cursor=0;
    const scenes = projection.entries.map((e,i) => {
      const s = ordered[i], slot = project?.mediaAssembly?.slots?.find(v => v.sceneId === s?.id && v.role === "primary"), a = assets.get(slot?.selectedAssetId);
      if (!a || !slot.candidateAssetIds?.includes(a.id) || e.sceneId !== s?.id || e.assetId !== a.id || e.playableState !== "ready" || a.status !== "ready" || a.fileState !== "available" || !a.localPath || !["video","image"].includes(a.kind)) fail("PROJECT_RENDER_MEDIA_MISSING");
      if (!(e.duration > 0) || !Number.isFinite(e.projectStart) || !Number.isFinite(e.projectEnd) || Math.abs(e.projectStart-cursor)>1e-6 || Math.abs(e.projectEnd-e.projectStart-e.duration)>1e-6 || canonical.entries[i]?.duration && Math.abs(canonical.entries[i].duration-e.duration)>1e-6) fail("PROJECT_RENDER_TIMING_INVALID");
      cursor=e.projectEnd;
      return { sceneId: s?.id, order: s?.order, ...identity(a), projectStart: e.projectStart, projectEnd: e.projectEnd, duration: e.duration, fit: "contain-pad", transition: "cut" };
    });
    if (!Number.isFinite(projection.duration) || Math.abs(cursor-projection.duration)>1e-6) fail("PROJECT_RENDER_TIMING_INVALID");
    const first = ordered[0], asset = assets.get(scenes[0]?.assetId);
    let orientation = first?.orientation;
    if (orientation === "any" && asset?.meta?.width > 0 && asset?.meta?.height > 0) orientation = asset.meta.height > asset.meta.width ? "portrait" : asset.meta.width > asset.meta.height ? "landscape" : "square";
    const dimensions = { portrait: [1080,1920], landscape: [1920,1080], square: [1080,1080] }[orientation];
    if (!dimensions) fail("PROJECT_RENDER_PROFILE_UNRESOLVED");
    const profile = { width: dimensions?.[0] || 0, height: dimensions?.[1] || 0, fps: 30 };
    const raw = project?.workflow?.renderOptions || {}, settings = { ...audio.normalizeSettings(raw), mixOriginalAudio: raw.mixOriginalAudio !== false, originalAudioVolume: raw.originalAudioVolume ?? .12 };
    for (const k of ["originalAudioVolume","voiceVolume","bgmVolume"]) if (!Number.isFinite(settings[k]) || settings[k] < 0 || settings[k] > 1) fail("PROJECT_RENDER_INCOMPLETE");
    const voicePlan = audio.voicePlan(project, projection), track = audio.textTrack(project, projection);
    let voice = null;
    if (settings.voiceEnabled) {
      const value = audio.currentVoice(project, voicePlan);
      if (!value) fail(project?.workflow?.voice?.staleResult ? "PROJECT_RENDER_VOICE_STALE" : "PROJECT_RENDER_VOICE_REQUIRED");
      else try { voice = audio.validateResult(value, { ...voicePlan, textSource: voicePlan.requestedSource }); }
      catch { fail("PROJECT_RENDER_VOICE_REQUIRED"); }
      if ([project?.workflow?.voice?.job,project?.workflow?.voice?.staleJob].some(j => j?.projectId === project?.projectId && (ACTIVE.includes(j.status) || ["failed","interrupted"].includes(j.status)))) fail("PROJECT_RENDER_VOICE_REQUIRED");
    }
    const timed = cues => cues.every((c,i) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.start >= 0 && c.end > c.start && c.end <= projection.duration + 1e-6 && (!i || c.start >= cues[i-1].end - 1e-6));
    if (voice && !timed(voice.segments)) fail("PROJECT_RENDER_TIMING_INVALID");
    const subtitles = settings.burnSubtitles ? track.cues.map(({id,start,end,text}) => ({id,start,end,text})) : [];
    if (settings.burnSubtitles && (!track.complete || !track.available || !timed(subtitles))) fail("PROJECT_RENDER_TIMING_INVALID");
    const bgmAsset = settings.bgmAssetId ? audio.resolveBgm(project) : null;
    if (settings.bgmAssetId && !bgmAsset) fail("PROJECT_RENDER_BGM_UNAVAILABLE");
    const bgm = bgmAsset ? identity(bgmAsset) : null;
    const semantic = { projectId: project?.projectId, profile, scenes, settings, voice: voice && { projectId:voice.projectId, textSource:voice.textSource, language:voice.language, inputSignature: voice.inputSignature,
      segments: voice.segments.map(({id,start,end,text,speaker,audioPath,audioDuration,timingRisk}) => ({id,start,end,text,speaker,audioPath,audioDuration,timingRisk})) },
      subtitleSource: track.resolvedSource, subtitles, bgm };
    const renderInputSignature = audio.signature({ ...semantic, subtitleProjection:track.cues.map(({id,start,end,text})=>({id,start,end,text})) }).replace("project-voice-v1:", "project-render-v1:");
    return { ...semantic, playback:projection, projectName: project?.projectName || "Project", duration: projection.duration, ready: !issues.length, reason: issues[0] || null, issues, renderInputSignature };
  }
  function outputs(project, plan) {
    return (project?.workflow?.jobs || []).filter(j => scoped(j) && j.projectId === project.projectId).map(job => ({ job,
      current: job.status === "completed" && !!job.outputPath && job.fileState === "available" && plan.ready && job.renderInputSignature === plan.renderInputSignature }));
  }
  function payload(plan) {
    const { projectId,projectName,renderInputSignature,profile,scenes,settings,voice,subtitles,bgm,duration,subtitleSource } = plan;
    return JSON.parse(JSON.stringify({ projectId,projectName,renderInputSignature,profile,scenes,settings,voice,subtitles,bgm,duration,subtitleSource }));
  }
  return { ACTIVE, scoped, build, outputs, payload };
});
