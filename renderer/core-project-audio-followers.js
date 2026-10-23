(function attachProjectAudioFollowers(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreProjectAudioFollowers = api;
})(typeof window !== "undefined" ? window : globalThis, function projectAudioFollowers() {
  "use strict";
  // Two local media followers; only the existing Project runtime advances time.
  function create({ model, audio, resolveUrl, authority, changed = () => {} }) {
    let epoch = 0, projectId = null, current = null, voice = null, bgm = null;
    const errors = new Map();
    const notify = () => { try { changed(); } catch {} };
    function release(record) { if (!record) return; record.disposed = true; record.node.pause(); record.node.removeAttribute?.("src"); record.node.load?.(); }
    function dispose() { epoch++; release(voice); release(bgm); voice = bgm = null; current = null; projectId = null; errors.clear(); }
    function record(kind, key, source) {
      const node = audio(), token = epoch, result = { node, key, kind, ready: false, failed: false, playing: false, disposed: false };
      node.preload = "auto";
      const valid = () => !result.disposed && token === epoch;
      node.addEventListener?.("loadedmetadata", () => { if (valid()) { result.ready = true; align(result); } });
      node.addEventListener?.("error", () => { if (valid()) fail(result); });
      node.addEventListener?.("ended", () => { if (valid()) { result.playing = false; result.ended = true; } });
      Promise.resolve().then(() => resolveUrl(source)).then(response => {
        if (!valid()) return;
        if (!response?.ok || !response.url?.startsWith("file:")) throw Error("AUDIO_UNAVAILABLE");
        node.src = response.url; node.load?.();
      }).catch(() => { if (valid()) fail(result); });
      return result;
    }
    function fail(result) { result.failed = true; result.playing = false; result.node.pause(); errors.set(result.kind, true); notify(); }
    function align(result) {
      if (!current || !result || result.disposed || result.failed) return;
      const { sync, settings } = current, node = result.node;
      node.volume = result.kind === "voice" ? settings.voiceVolume : settings.bgmVolume;
      if (!result.ready) return;
      const duration = Number(node.duration);
      if (!Number.isFinite(duration) || duration <= 0) { node.pause(); return; }
      let time;
      if (result.kind === "voice") time = sync.currentTime - current.cue.start;
      else time = settings.bgmLoop ? sync.currentTime % duration : sync.currentTime;
      const silent = time < 0 || time >= duration || sync.ended || sync.paused || sync.playbackState !== "playing";
      if (Math.abs(node.currentTime - Math.min(duration, Math.max(0, time))) > .12) { node.currentTime = Math.min(duration, Math.max(0, time)); result.ended = false; }
      if (result.ended) { node.pause(); return; }
      if (silent) { result.playing = false; node.pause(); return; }
      if (!result.playing) {
        result.playing = true;
        Promise.resolve().then(() => {
          if (result.disposed || result.failed || !current || current.sync.paused || current.sync.playbackState !== "playing") { result.playing = false; return; }
          return node.play();
        }).catch(() => { if (!result.disposed) fail(result); });
      }
    }
    function sync(event, project, plan) {
      const owner = authority();
      if (!owner || event?.authority !== "project-preview" || event.projectId !== project?.projectId || owner.projectId !== event.projectId || owner.generation !== event.generation) return false;
      if (projectId !== project.projectId) { dispose(); projectId = project.projectId; }
      const settings = model.normalizeSettings(project.workflow.renderOptions), result = model.currentVoice(project, plan);
      const cue = result && settings.voiceEnabled ? model.cueAt(plan.cues, event.currentTime) : null;
      const segment = cue && result.segments.find(s => s.id === cue.id), asset = model.resolveBgm(project);
      current = { sync: { ...event }, settings, cue };
      const voiceKey = segment ? result.inputSignature + ":" + segment.id + ":" + segment.audioPath : null;
      if (voice?.key !== voiceKey) { release(voice); voice = null; errors.delete("voice"); if (segment) voice = record("voice", voiceKey, { localPath: segment.audioPath, kind: "audio" }); }
      const bgmKey = asset ? asset.id + ":" + asset.localPath : null;
      if (bgm?.key !== bgmKey) { release(bgm); bgm = null; errors.delete("bgm"); if (asset) bgm = record("bgm", bgmKey, { localPath: asset.localPath, kind: "audio" }); }
      align(voice); align(bgm); return true;
    }
    return { sync, dispose, status: () => ({ unavailable: errors.size > 0, voice: !!voice && !voice.failed, bgm: !!bgm && !bgm.failed }) };
  }
  return { create };
});
