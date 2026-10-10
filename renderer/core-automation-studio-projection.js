(function installAutomationStudioProjection() {
  "use strict";

  let queued = false;
  let building = false;
  let operationId = null;
  let progress = 0;
  let projection = null;
  const wiredVideos = new WeakSet();

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function copy() {
    return locale() === "en"
      ? {
          open: "Open in Studio",
          preparing: "Preparing Studio preview",
          cancel: "Stop",
          failed: "Could not prepare the Studio preview.",
          ready: "Automation composition opened in Studio.",
          bannerTitle: "Automation composition",
          bannerBody: "This Studio preview is derived from the editable Composition Plan. Timeline seeking uses the same video playback clock.",
          back: "Back to Automation",
          clip: "Scene",
          preview: "Derived preview"
        }
      : {
          open: "Mở trong Studio",
          preparing: "Đang chuẩn bị preview Studio",
          cancel: "Dừng",
          failed: "Không thể chuẩn bị preview Studio.",
          ready: "Đã mở Composition trong Studio.",
          bannerTitle: "Composition từ Automation",
          bannerBody: "Preview Studio được tạo từ Composition Plan có thể chỉnh sửa. Timeline và seek dùng chung một playback clock của video preview.",
          back: "Quay lại Automation",
          clip: "Cảnh",
          preview: "Preview dẫn xuất"
        };
  }

  function automation() {
    return appState()?.automation || null;
  }

  function currentComposition() {
    const current = automation();
    if (!current?.composition || current?.stale?.composition === true) return null;
    const valid = window.ViralAutomationCompositionState?.isCurrent?.();
    return valid === false ? null : current.composition;
  }

  function previewJobId(composition) {
    return "automation-composition-preview-" + String(composition?.id || "unknown");
  }

  function removePreviewJobs() {
    const current = appState();
    if (!current || !Array.isArray(current.jobs)) return;
    current.jobs = current.jobs.filter(job => job?.isAutomationCompositionPreview !== true);
  }

  function emit(reason) {
    window.dispatchEvent(new CustomEvent("viral-ai:core-state-changed", { detail: { reason } }));
    try { window.ViralCoreProjectPersistence?.schedule?.(reason); } catch {}
  }

  function toastMessage(message) {
    try { if (typeof toast === "function") toast(message); } catch {}
  }

  function ensureAutomationAction() {
    if (appState()?.page !== "automation") return;
    const composition = currentComposition();
    const head = document.querySelector(".automation-composition-head");
    if (!(head instanceof HTMLElement) || !composition) return;
    let button = head.querySelector("[data-composition-open-studio]");
    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "button primary automation-open-studio";
      button.setAttribute("data-composition-open-studio", "true");
      head.appendChild(button);
    }
    const c = copy();
    button.disabled = false;
    button.textContent = building ? `${c.preparing} ${Math.round(progress)}% · ${c.cancel}` : c.open;
  }

  function compositionForStudio() {
    if (appState()?.page !== "ai-video" || !projection) return null;
    const composition = currentComposition();
    if (!composition || String(composition.id) !== String(projection.compositionId)) return null;
    return composition;
  }

  async function openStudio() {
    const composition = currentComposition();
    if (!composition || !window.desktopAPI?.buildAutomationCompositionPreview) return;
    if (building) {
      if (operationId) await window.desktopAPI?.cancelAutomationCompositionPreview?.(operationId).catch?.(() => {});
      building = false;
      operationId = null;
      progress = 0;
      ensureAutomationAction();
      return;
    }

    building = true;
    progress = 1;
    operationId = "composition-preview-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    ensureAutomationAction();

    let response;
    try {
      response = await window.desktopAPI.buildAutomationCompositionPreview({ operationId, composition });
    } catch {
      response = null;
    }

    const completedOperation = operationId;
    building = false;
    operationId = null;
    progress = 0;

    if (!response?.ok || !response?.data?.outputPath) {
      ensureAutomationAction();
      toastMessage(copy().failed);
      return;
    }

    let previewUrl = "";
    try { previewUrl = await window.desktopAPI?.getVideoUrl?.(response.data.outputPath); } catch {}
    if (!previewUrl) {
      ensureAutomationAction();
      toastMessage(copy().failed);
      return;
    }

    const current = appState();
    if (!current) return;
    removePreviewJobs();
    const topic = String(current.automation?.brief?.topic || current.automation?.brief?.product || "Automation").trim() || "Automation";
    const job = {
      id: previewJobId(composition),
      name: topic + " · Studio Preview.mp4",
      sourcePath: response.data.outputPath,
      previewUrl,
      fileState: "available",
      status: "completed",
      progress: 100,
      isAutomationCompositionPreview: true,
      automationCompositionId: composition.id,
      meta: {
        duration: Number(response.data.duration || composition.durationSec || 0),
        width: Number(response.data.width || 0),
        height: Number(response.data.height || 0),
        sizeBytes: Number(response.data.sizeBytes || 0)
      }
    };
    current.jobs.unshift(job);
    projection = {
      compositionId: composition.id,
      outputSignature: composition.outputSignature,
      operationId: completedOperation,
      previewPath: response.data.outputPath,
      previewUrl,
      cacheHit: response.data.cacheHit === true
    };
    current.page = "ai-video";
    try { if (typeof render === "function") render(); } catch {}
    emit("automation-composition-opened-in-studio");
    toastMessage(copy().ready);
    queue();
  }

  function backToAutomation() {
    const current = appState();
    if (!current) return;
    removePreviewJobs();
    projection = null;
    current.page = "automation";
    try { if (typeof render === "function") render(); } catch {}
    emit("automation-composition-returned-from-studio");
  }

  function ensureStudioBanner(page, composition) {
    let banner = page.querySelector(":scope > .automation-studio-banner");
    if (!(banner instanceof HTMLElement)) {
      banner = document.createElement("section");
      banner.className = "automation-studio-banner";
      const anchor = page.querySelector(":scope > .core-editor-focus-section") || page.firstElementChild;
      if (anchor instanceof Element) anchor.insertAdjacentElement("beforebegin", banner);
      else page.prepend(banner);
    }
    const c = copy();
    const clips = Array.isArray(composition?.tracks?.video) ? composition.tracks.video.length : 0;
    const next = `<div><span>${c.preview}</span><strong>${c.bannerTitle}</strong><p>${c.bannerBody}</p></div><div class="automation-studio-banner-meta"><b>${clips} ${c.clip.toLowerCase()}</b><b>${Number(composition.durationSec || 0).toFixed(1)}s</b><button type="button" class="button ghost" data-automation-back>${c.back}</button></div>`;
    if (banner.innerHTML !== next) banner.innerHTML = next;
  }

  function renderCompositionTimeline(page, video, composition) {
    const dock = page.querySelector(".core-editor-bottom-dock");
    if (!(dock instanceof HTMLElement)) return;
    const total = Math.max(0.001, Number(composition?.durationSec || video.duration || 0));
    const videoLane = dock.querySelector("[data-track-video]");
    const subtitleLane = dock.querySelector("[data-track-subtitle]");
    const empty = dock.querySelector("[data-bottom-timeline-empty]");
    if (!(videoLane instanceof HTMLElement) || !(subtitleLane instanceof HTMLElement)) return;

    let sentinel = videoLane.querySelector(".automation-composition-source-sentinel");
    if (!(sentinel instanceof HTMLElement)) {
      videoLane.querySelectorAll(".core-source-clip").forEach(node => node.remove());
      sentinel = document.createElement("span");
      sentinel.className = "core-source-clip automation-composition-source-sentinel";
      sentinel.hidden = true;
      videoLane.prepend(sentinel);
    }

    const videoClips = Array.isArray(composition?.tracks?.video) ? composition.tracks.video : [];
    const videoSignature = composition.outputSignature + "|" + videoClips.map(item => `${item.id}:${item.startSec}:${item.endSec}`).join("|");
    if (videoLane.dataset.automationCompositionSignature !== videoSignature) {
      videoLane.dataset.automationCompositionSignature = videoSignature;
      videoLane.querySelectorAll(".automation-composition-timeline-clip").forEach(node => node.remove());
      videoClips.forEach((clip, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "automation-composition-timeline-clip";
        button.dataset.compositionStart = String(clip.startSec || 0);
        button.dataset.compositionEnd = String(clip.endSec || 0);
        button.style.left = (Number(clip.startSec || 0) / total * 100) + "%";
        button.style.width = Math.max(.5, Number(clip.durationSec || 0) / total * 100) + "%";
        button.innerHTML = `<span>${index + 1}</span><b>${copy().clip} ${index + 1}</b>`;
        button.addEventListener("click", event => {
          event.stopPropagation();
          video.currentTime = Math.max(0, Math.min(total, Number(clip.startSec || 0)));
          video.dispatchEvent(new Event("seeking"));
        });
        videoLane.appendChild(button);
      });
    }

    const subtitles = Array.isArray(composition?.tracks?.subtitle) ? composition.tracks.subtitle : [];
    const subtitleSignature = composition.outputSignature + "|" + subtitles.map(item => `${item.id}:${item.startSec}:${item.endSec}:${item.text}`).join("|");
    if (subtitleLane.dataset.automationCompositionSignature !== subtitleSignature) {
      subtitleLane.dataset.automationCompositionSignature = subtitleSignature;
      subtitleLane.querySelectorAll(".automation-composition-subtitle-clip").forEach(node => node.remove());
      subtitles.forEach(item => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "automation-composition-subtitle-clip";
        button.dataset.compositionStart = String(item.startSec || 0);
        button.dataset.compositionEnd = String(item.endSec || 0);
        button.style.left = (Number(item.startSec || 0) / total * 100) + "%";
        button.style.width = Math.max(.5, Number(item.durationSec || 0) / total * 100) + "%";
        button.innerHTML = `<span>${String(item.text || "")}</span>`;
        button.addEventListener("click", event => {
          event.stopPropagation();
          video.currentTime = Math.max(0, Math.min(total, Number(item.startSec || 0)));
          video.dispatchEvent(new Event("seeking"));
        });
        subtitleLane.appendChild(button);
      });
    }
    if (empty instanceof HTMLElement) empty.hidden = true;
    syncActive(video, dock);
  }

  function syncActive(video, dock) {
    const current = Number(video?.currentTime || 0);
    dock.querySelectorAll("[data-composition-start][data-composition-end]").forEach(node => {
      const start = Number(node.getAttribute("data-composition-start") || 0);
      const end = Number(node.getAttribute("data-composition-end") || start);
      const active = current >= start && current < end;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function wireVideo(video, page) {
    if (wiredVideos.has(video)) return;
    wiredVideos.add(video);
    ["timeupdate", "seeking", "seeked", "loadedmetadata", "durationchange"].forEach(name => {
      video.addEventListener(name, () => {
        const dock = page.querySelector(".core-editor-bottom-dock");
        if (dock instanceof HTMLElement) syncActive(video, dock);
      });
    });
  }

  function enhanceStudio() {
    const composition = compositionForStudio();
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !composition) return;
    page.classList.add("automation-studio-projection");
    ensureStudioBanner(page, composition);
    const video = page.querySelector("video.preview-video, video.core-player-media");
    if (!(video instanceof HTMLVideoElement)) return;
    video.dataset.automationCompositionPreview = "true";
    video.dataset.coreDurationHint = String(Number(composition.durationSec || 0));
    wireVideo(video, page);
    renderCompositionTimeline(page, video, composition);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureAutomationAction();
      enhanceStudio();
    });
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-composition-open-studio]")) {
      event.preventDefault();
      openStudio();
      return;
    }
    if (target.closest("[data-automation-back]")) {
      event.preventDefault();
      backToAutomation();
      return;
    }
    const nav = target.closest("[data-page]");
    if (projection && nav && nav.getAttribute("data-page") !== "ai-video") {
      removePreviewJobs();
      projection = null;
    }
  }, true);

  window.desktopAPI?.onAutomationCompositionPreviewProgress?.(payload => {
    if (!building || !operationId || String(payload?.operationId || "") !== operationId) return;
    progress = Math.max(progress, Number(payload?.percent || 0));
    ensureAutomationAction();
  });

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);
  window.addEventListener("viral-ai:editor-preview-preserved", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationStudioProjection = {
    openStudio,
    backToAutomation,
    currentComposition: compositionForStudio,
    isActive: () => Boolean(compositionForStudio())
  };
})();
