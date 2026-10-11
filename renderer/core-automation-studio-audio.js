(function installAutomationStudioAudioOverlay() {
  "use strict";

  let queued = false;
  const wiredVideos = new WeakSet();

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function composition() {
    try { return window.ViralAutomationStudioProjection?.currentComposition?.() || null; }
    catch { return null; }
  }

  function currentPage() {
    return appState()?.page || null;
  }

  function removeDerivedPreviewJobs() {
    const current = appState();
    if (!current || !Array.isArray(current.jobs)) return;
    current.jobs = current.jobs.filter(job => job?.isAutomationCompositionPreview !== true);
  }

  function returnToAutomation(event) {
    const target = event?.target instanceof Element ? event.target.closest("[data-automation-back]") : null;
    if (!(target instanceof Element)) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const current = appState();
    if (!current) return false;

    removeDerivedPreviewJobs();
    const page = document.getElementById("page");
    page?.classList.remove("automation-studio-projection");
    current.page = "automation";

    try { if (typeof save === "function") save(); } catch {}
    try { if (typeof render === "function") render(); } catch {}
    try { window.ViralCoreProjectPersistence?.flush?.("automation-studio-back"); } catch {}
    try {
      window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", {
        detail: { reason: "automation-composition-returned-from-studio" }
      }));
    } catch {}

    requestAnimationFrame(() => {
      if (appState()?.page !== "automation") return;
      const staleStudio = document.querySelector("#page .automation-studio-banner");
      if (!staleStudio) return;
      try { if (typeof render === "function") render(); } catch {}
    });
    return true;
  }

  function syncActive(video, lane) {
    const current = Number(video?.currentTime || 0);
    lane.querySelectorAll(".automation-composition-audio-clip").forEach(node => {
      const start = Number(node.getAttribute("data-composition-start") || 0);
      const end = Number(node.getAttribute("data-composition-end") || start);
      const active = current >= start && current < end;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function wireVideo(video, lane) {
    if (wiredVideos.has(video)) return;
    wiredVideos.add(video);
    ["timeupdate", "seeking", "seeked", "loadedmetadata"].forEach(name => {
      video.addEventListener(name, () => syncActive(video, lane));
    });
  }

  function render() {
    queued = false;
    if (currentPage() !== "ai-video") return;
    const plan = composition();
    if (!plan) return;
    const page = document.getElementById("page");
    const dock = page?.querySelector(".core-editor-bottom-dock");
    const lane = dock?.querySelector("[data-track-audio]");
    const video = page?.querySelector("video.preview-video, video.core-player-media");
    if (!(lane instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) return;

    const total = Math.max(0.001, Number(plan.durationSec || video.duration || 0));
    const clips = Array.isArray(plan?.tracks?.audio) ? plan.tracks.audio : [];
    const signature = String(plan.outputSignature || "") + "|" + clips.map(item => `${item.id}:${item.startSec}:${item.endSec}:${item.sourcePath}`).join("|");
    if (lane.dataset.automationVoiceSignature !== signature) {
      lane.dataset.automationVoiceSignature = signature;
      lane.querySelectorAll(".automation-composition-audio-clip").forEach(node => node.remove());
      clips.forEach((clip, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "automation-composition-audio-clip";
        button.dataset.compositionStart = String(clip.startSec || 0);
        button.dataset.compositionEnd = String(clip.endSec || 0);
        button.style.left = (Number(clip.startSec || 0) / total * 100) + "%";
        button.style.width = Math.max(.5, Number(clip.durationSec || 0) / total * 100) + "%";
        button.innerHTML = `<span>${index + 1}</span><b>A1</b>`;
        button.addEventListener("click", event => {
          event.stopPropagation();
          video.currentTime = Math.max(0, Math.min(total, Number(clip.startSec || 0)));
          video.dispatchEvent(new Event("seeking"));
        });
        lane.appendChild(button);
      });
    }

    const label = dock?.querySelector("[data-audio-label]");
    if (label instanceof HTMLElement && clips.length) label.textContent = `A1 · ${clips.length}`;
    wireVideo(video, lane);
    syncActive(video, lane);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  }

  document.addEventListener("click", returnToAutomation, true);
  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:editor-preview-preserved", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationStudioAudio = {
    refresh: queue,
    returnToAutomation
  };
})();
