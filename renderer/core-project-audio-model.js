(function attachProjectAudioModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectAudioModel = api;
})(typeof window !== "undefined" ? window : globalThis, function projectAudioModel() {
  "use strict";
  const ACTIVE = ["validating", "queued", "generating", "downloading", "cancelling"];
  const bounded = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  const text = value => typeof value === "string" ? value.trim() : "";
  const timed = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  function normalizeSettings(input = {}) {
    input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    return { burnSubtitles: input.burnSubtitles !== false, textSource: ["auto", "source", "translation"].includes(input.textSource) ? input.textSource : "auto",
      voiceEnabled: input.voiceEnabled !== false, voiceVolume: bounded(input.voiceVolume, 1),
      bgmAssetId: typeof input.bgmAssetId === "string" && input.bgmAssetId.length <= 512 ? input.bgmAssetId : null,
      bgmVolume: bounded(input.bgmVolume, 1), bgmLoop: input.bgmLoop === true };
  }
  function resolveBgm(project, assetId = normalizeSettings(project?.workflow?.renderOptions).bgmAssetId) {
    const asset = project?.media?.assets?.find(a => a.id === assetId);
    return asset?.kind === "audio" && asset.status === "ready" && asset.fileState === "available" && asset.localPath ? asset : null;
  }
  // Synchronous SHA-256 of semantic inputs. No clock, provider or UI identity.
  function signature(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)), size = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
    const view = new DataView(data.buffer); view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(size - 4, bytes.length * 8 >>> 0);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
    const r = (x, n) => x >>> n | x << 32 - n;
    for (let offset = 0; offset < size; offset += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (r(a, 7) ^ r(a, 18) ^ a >>> 3) + w[i - 16] + (r(b, 17) ^ r(b, 19) ^ b >>> 10) + w[i - 7]; }
      let [a,b,c,d,e,f,g,j] = h;
      for (let i = 0; i < 64; i++) { const t = (j + (r(e,6)^r(e,11)^r(e,25)) + (e&f ^ ~e&g) + k[i] + w[i]) | 0, u = ((r(a,2)^r(a,13)^r(a,22)) + (a&b ^ a&c ^ b&c)) | 0; j=g;g=f;f=e;e=d+t|0;d=c;c=b;b=a;a=t+u|0; }
      [a,b,c,d,e,f,g,j].forEach((v,i) => { h[i] = h[i] + v | 0; });
    }
    return "project-voice-v1:" + h.map(v => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }
  function textTrack(project, playback) {
    const workflow = project?.workflow || {}, settings = normalizeSettings(workflow.renderOptions);
    const source = workflow.speech?.result, translation = workflow.translation?.result;
    const sourceCompatible = !project?.source?.path || !source?.sourcePath || project.source.path === source.sourcePath;
    const originals = sourceCompatible && Array.isArray(source?.segments) ? source.segments : [];
    const byId = new Map(originals.map((s, i) => { const sourceId = String(s.id ?? ("segment-" + i)); return [sourceId, { segment: s, index: i, sourceId }]; }));
    const entries = new Map((playback?.entries || []).map(e => [e.sceneId, e])), units = [], issues = [];
    const scenes = [...(project?.scenePlan?.scenes || [])].sort((a,b) => a.order - b.order);
    for (const scene of scenes) {
      const namespace = "scene:" + signature(scene.id).slice(17);
      const entry = entries.get(scene.id), resolved = timed(entry?.projectStart) && timed(entry?.projectEnd) && entry.projectEnd > entry.projectStart;
      if (!resolved) issues.push({ sceneId: scene.id, reason: "timing" });
      const ids = scene.sourceSegmentIds || [], found = ids.map(id => byId.get(String(id)));
      if (ids.length && found.some(Boolean)) {
        if (found.some(s => !s) || !timed(scene.start) || !timed(scene.end) || scene.end <= scene.start) { issues.push({ sceneId: scene.id, reason: "sourceTiming" }); continue; }
        for (const { segment: s, index, sourceId } of [...found].sort((a,b) => a.index-b.index)) {
          if (!timed(s.start) || !timed(s.end) || s.end <= s.start) { issues.push({ sceneId: scene.id, reason: "sourceTiming" }); continue; }
          const start = Math.max(scene.start, s.start), end = Math.min(scene.end, s.end);
          if (end <= start || !text(s.sourceText ?? s.text)) continue;
          units.push({ id: namespace + ":segment:" + sourceId, sceneId: scene.id, sourceId, sourceIndex: index,
            sourceStart: s.start, sourceEnd: s.end, sourceText: text(s.sourceText ?? s.text), speaker: text(s.speaker) || "speaker-1",
            start: resolved ? entry.projectStart + (start - scene.start) / (scene.end - scene.start) * entry.duration : null,
            end: resolved ? entry.projectStart + (end - scene.start) / (scene.end - scene.start) * entry.duration : null });
        }
      } else if (text(scene.sourceText)) units.push({ id: namespace + ":text", sceneId: scene.id, sourceId: scene.id, sourceIndex: null,
        sourceStart: scene.start, sourceEnd: scene.end, sourceText: text(scene.sourceText), speaker: "speaker-1",
        start: resolved ? entry.projectStart : null, end: resolved ? entry.projectEnd : null });
    }
    const translated = Array.isArray(translation?.segments) ? translation.segments : [];
    const compatible = !!translation && translation.status !== "stale" && (!translation.sourcePath || !source?.sourcePath || translation.sourcePath === source.sourcePath) &&
      (!project?.source?.path || !translation.sourcePath || translation.sourcePath === project.source.path) &&
      (!translation.targetLanguage || !workflow.translation?.targetLanguage || translation.targetLanguage === workflow.translation.targetLanguage);
    const translations = units.map(unit => {
      if (!compatible) return null;
      const exact = translated.filter(s => String(s.id) === unit.sourceId || String(s.id) === unit.id);
      let match = exact.length === 1 ? exact[0] : null;
      if (!exact.length && unit.sourceIndex != null && timed(unit.sourceStart)) {
        const timedMatches = translated.filter(s => timed(s.start) && Math.abs(s.start - unit.sourceStart) <= .001 && timed(s.end) && Math.abs(s.end - unit.sourceEnd) <= .001);
        if (timedMatches.length === 1) match = timedMatches[0];
        else if (timedMatches.length > 1 && unit.sourceIndex != null && originals.length === translated.length && timedMatches.includes(translated[unit.sourceIndex])) match = translated[unit.sourceIndex];
      }
      if (match?.sourceText != null && text(match.sourceText) !== unit.sourceText) return null;
      return match && text(match.translatedText ?? match.text) ? { text: text(match.translatedText ?? match.text), speaker: text(match.speaker) || unit.speaker } : null;
    });
    const completeTranslation = units.length > 0 && translations.every(Boolean);
    const resolvedSource = settings.textSource === "translation" || settings.textSource === "auto" && completeTranslation ? "translation" : "source";
    const available = resolvedSource !== "translation" || completeTranslation;
    const language = text(resolvedSource === "translation" ? translation?.targetLanguage || workflow.translation?.targetLanguage :
      (sourceCompatible ? source?.language : null) || workflow.speech?.language) || "auto";
    const cues = available ? units.map((unit, i) => ({ id: unit.id, sceneId: unit.sceneId, start: unit.start, end: unit.end,
      text: resolvedSource === "translation" ? translations[i].text : unit.sourceText, speaker: resolvedSource === "translation" ? translations[i].speaker : unit.speaker })).filter(c => timed(c.start) && timed(c.end) && c.end > c.start) : [];
    return { projectId: project?.projectId, requestedSource: settings.textSource, resolvedSource, available, language, cues, issues,
      sourceInputs: units.map(u => [u.id,u.sourceText,u.speaker]),
      complete: !!playback?.complete && issues.length === 0, duration: playback?.duration || 0 };
  }
  function voicePlan(project, playback) {
    const track = textTrack(project, playback), map = project?.workflow?.voice?.assignments || {};
    const speakers = [...new Set(track.cues.map(c => c.speaker))];
    const defaultVoiceId = text(map["speaker-1"]), bySpeaker = Object.fromEntries(speakers.map(s => [s, text(map[s]) || defaultVoiceId]));
    const assignments = { defaultVoiceId, bySpeaker };
    const reason = !track.available ? "translationUnavailable" : !track.complete ? "timingUnresolved" : !track.cues.length ? "noText" :
      track.cues.length > 300 ? "tooMany" : track.cues.some(c => c.text.length > 4096) ? "tooLong" :
      !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(track.language) ? "languageUnavailable" : !defaultVoiceId || speakers.some(s => !bySpeaker[s]) ? "chooseVoice" : null;
    const semantic = { projectId: project?.projectId, scenes: (playback?.entries || []).map(e => [e.sceneId,e.projectStart,e.projectEnd]),
      textSource: track.requestedSource, resolvedSource: track.resolvedSource, language: track.language, sourceInputs: track.sourceInputs, cues: track.cues, assignments };
    return { ...track, speakers, assignments, ready: !reason, reason, inputSignature: signature(semantic), segments: track.cues.map(({id,start,end,text,speaker}) => ({id,start,end,text,speaker})) };
  }
  function currentVoice(project, plan) {
    const result = project?.workflow?.voice?.result;
    return result?.projectId === project?.projectId && result.inputSignature === plan.inputSignature && plan.ready ? result : null;
  }
  function validateResult(result, context) {
    if (!Array.isArray(result?.segments) || result.segments.length !== context.segments.length || result.segments.length > 300) throw Error("PROJECT_VOICE_RESULT_INVALID");
    const ids = new Map(result.segments.map(s => [s.id, s]));
    if (ids.size !== context.segments.length) throw Error("PROJECT_VOICE_RESULT_INVALID");
    const segments = context.segments.map(cue => {
      const s = ids.get(cue.id);
      if (!s || typeof cue.id !== "string" || !cue.id || cue.id.length > 2048 || typeof cue.text !== "string" || !cue.text || cue.text.length > 4096 ||
          typeof cue.speaker !== "string" || cue.speaker.length > 512 || !timed(s.start) || !timed(s.end) || s.end <= s.start || Math.abs(s.start-cue.start)>1e-6 || Math.abs(s.end-cue.end)>1e-6 ||
          typeof s.audioPath !== "string" || !s.audioPath || s.audioPath.length > 32767 || /^(https?:|file:)/i.test(s.audioPath) || typeof s.audioUrl !== "string" || s.audioUrl.length > 100000 || !s.audioUrl.startsWith("file:") ||
          !Number.isFinite(s.audioDuration) || s.audioDuration <= 0 || s.speaker && s.speaker !== cue.speaker) throw Error("PROJECT_VOICE_RESULT_INVALID");
      return { id: cue.id, start: cue.start, end: cue.end, text: cue.text, speaker: cue.speaker,
        audioPath: s.audioPath, audioUrl: s.audioUrl, audioDuration: s.audioDuration, timingRisk: s.timingRisk === true };
    });
    return { projectId: context.projectId, inputSignature: context.inputSignature, textSource: context.textSource, language: context.language, segments };
  }
  const cueAt = (cues, time) => cues.find(c => time >= c.start && time < c.end) || null;
  return { ACTIVE, normalizeSettings, resolveBgm, signature, textTrack, voicePlan, currentVoice, validateResult, cueAt };
});
