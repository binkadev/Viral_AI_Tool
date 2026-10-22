(function installCoreEditorAssetsPanel() {
  "use strict";

  const COLLAPSED_KEY = "viral-ai-core-editor-assets-collapsed";
  const STRUCTURE_SELECTOR = [
    ".core-editor-focus-section",
    ".editor-grid",
    "video.preview-video",
    "video.core-player-media",
    ".speech-result",
    ".transcript-list",
    ".transcript-row"
  ].join(",");
  let queued = false;
  let materialFeedback = null;

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved?.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function t(key, vars = {}) {
    return window.I18N?.t?.(locale(), "mediaWorkbench." + key, vars) || key;
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function currentSource() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function mediaAssets() {
    const current = appState();
    return Array.isArray(current?.media?.assets) ? current.media.assets : [];
  }

  function basename(value) {
    const raw = String(value || "");
    if (!raw) return "—";
    try {
      const url = new URL(raw);
      const path = decodeURIComponent(url.pathname || "");
      return path.split(/[\\/]/).filter(Boolean).pop() || raw;
    } catch {
      return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    }
  }

  function durationFor(video, source) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    if (Number.isFinite(hint) && hint > 0) return hint;
    const stored = Number(source?.meta?.duration || 0);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  }

  function setText(node, value) {
    if (!node) return;
    const next = String(value ?? "");
    if (node.textContent !== next) node.textContent = next;
  }

  function collapsed() {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  }

  function countAssets({ kind, origin, favorite } = {}) {
    return mediaAssets().filter(asset => {
      if (kind && asset?.kind !== kind) return false;
      if (origin && asset?.origin !== origin) return false;
      if (favorite === true && asset?.favorite !== true) return false;
      return true;
    }).length;
  }

  function applyCollapsed(panel, value) {
    panel.classList.toggle("is-collapsed", value);
    const button = panel.querySelector("[data-assets-collapse]");
    if (button instanceof HTMLButtonElement) {
      setText(button, value ? "›" : "‹");
      button.title = value ? t("expand") : t("collapse");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", value ? "false" : "true");
    }
    localStorage.setItem(COLLAPSED_KEY, value ? "true" : "false");
  }

  function sectionLabel(key) {
    return '<div class="core-assets-section-label">' + t(key) + '</div>';
  }

  function statRow(icon, labelKey, dataKey) {
    return '<div class="core-asset-item core-asset-stat" data-media-count="' + dataKey + '">' +
      '<span class="core-asset-icon">' + icon + '</span>' +
      '<span class="core-asset-copy"><b>' + t(labelKey) + '</b><small data-count-value>0</small></span>' +
    '</div>';
  }

  function materialText(key, vars = {}) {
    return window.I18N?.t?.(locale(), "sceneMaterials." + key, vars) || key;
  }
  function escapeMaterial(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function materialsMarkup() {
    const current = appState(), persistence = window.ViralCoreProjectPersistence;
    const projectId = persistence?.activeProjectId?.(), scenes = current?.scenePlan?.scenes || [];
    const scene = scenes.find(item => item.id === current?.scenePlan?.selectedSceneId);
    const label = key => escapeMaterial(materialText(key));
    let body = '<h3>' + label("title") + '</h3>';
    if (!projectId || !scene) return body + '<p>' + label("selectScene") + '</p>';
    const model = window.ViralCoreMediaAssemblyModel, assets = mediaAssets();
    const assembly = model?.normalizeAssembly(current.mediaAssembly, { scenes, assets });
    const slot = model?.sceneSlot(assembly, scene.id), ids = slot?.candidateAssetIds || [];
    const available = assets.filter(asset => ["video", "image"].includes(asset.kind) && !ids.includes(asset.id));
    const attrs = ' data-project-id="' + escapeMaterial(projectId) + '" data-scene-id="' + escapeMaterial(scene.id) + '"';
    const action = (name, text, assetId = "", disabled = false) => '<button type="button" data-scene-material-action="' + name + '"' + attrs +
      ' data-asset-id="' + escapeMaterial(assetId) + '"' + (disabled ? ' disabled' : '') + '>' + label(text) + '</button>';
    body += '<p class="core-material-scene">' + escapeMaterial(scene.title || materialText("scene", { number: scenes.indexOf(scene) + 1 })) + '</p>' +
      '<p>' + escapeMaterial(materialText("candidateCount", { count: ids.length })) + '</p>';
    if (!slot?.selectedAssetId) body += '<p>' + label("noSelection") + '</p>';
    if (!ids.length) body += '<p>' + label("empty") + '</p>';
    body += '<ul class="core-material-candidates">' + ids.map(id => {
      const asset = assets.find(item => item.id === id), selected = id === slot.selectedAssetId;
      const origin = ["local", "stock", "generated"].includes(asset.origin) ? asset.origin : "other";
      return '<li><b>' + escapeMaterial(asset.name) + '</b><small>' + escapeMaterial(materialText("kind." + asset.kind)) + ' · ' +
        escapeMaterial(materialText("origin." + origin)) + '</small><div class="core-material-actions">' +
        (selected ? '<span class="core-material-selected">' + label("inUse") + '</span>' : action("use", "use", id)) +
        action("remove", "remove", id) + '</div></li>';
    }).join("") + '</ul>';
    if (slot?.selectedAssetId) body += action("clear", "clear");
    const full = ids.length >= (model?.MAX_CANDIDATES_PER_SLOT || 64);
    body += '<label class="core-material-picker"><span>' + label("projectMedia") + '</span><select data-scene-material-picker' + attrs +
      ' aria-label="' + label("projectMedia") + '"' + (full || !available.length ? ' disabled' : '') + '><option value="">' + label("chooseAsset") + '</option>' +
      available.map(asset => '<option value="' + escapeMaterial(asset.id) + '">' + escapeMaterial(asset.name) + '</option>').join("") + '</select></label>' +
      action("add", "add", "", full || !available.length) + (full ? '<p>' + label("capacity") + '</p>' : '');
    const feedback = materialFeedback?.projectId === projectId && materialFeedback.sceneId === scene.id ? materialFeedback.key : null;
    return body + '<p role="status" aria-live="polite" data-scene-material-feedback>' + (feedback ? label(feedback) : '') + '</p>';
  }
  function updateMaterials(panel) {
    const section = panel.querySelector("[data-scene-materials]");
    if (!section) return;
    const markup = materialsMarkup();
    if (section.__materialMarkup === markup) return;
    const focused = document.activeElement;
    const focus = section.contains(focused) ? { action: focused.dataset?.sceneMaterialAction, assetId: focused.dataset?.assetId,
      picker: focused.hasAttribute?.("data-scene-material-picker") } : null;
    section.innerHTML = markup; section.__materialMarkup = markup;
    if (focus) {
      const target = focus.picker ? section.querySelector("select") : [...section.querySelectorAll("button")].find(button =>
        button.dataset.sceneMaterialAction === focus.action && button.dataset.assetId === focus.assetId);
      (target || section).focus();
    }
  }
  function materialAction(event, panel) {
    const button = event.target.closest?.("[data-scene-material-action]");
    if (!button || button.disabled || !panel.contains(button)) return;
    const { sceneId, projectId, assetId, sceneMaterialAction: action } = button.dataset;
    const persistence = window.ViralCoreProjectPersistence, current = appState();
    try {
      if (projectId !== persistence?.activeProjectId?.() || sceneId !== current?.scenePlan?.selectedSceneId) throw Error("STALE_SCENE");
      const options = { projectId };
      if (action === "use") persistence.selectSceneMaterial(sceneId, assetId, options);
      else if (action === "remove") persistence.removeSceneMaterialCandidate(sceneId, assetId, options);
      else if (action === "clear") persistence.clearSceneMaterialSelection(sceneId, options);
      else if (action === "add") {
        const id = panel.querySelector("[data-scene-material-picker]")?.value;
        if (!id) { materialFeedback = { projectId, sceneId, key: "chooseAsset" }; updateMaterials(panel); return; }
        persistence.addSceneMaterialCandidate(sceneId, id, options);
      } else return;
      materialFeedback = null;
    } catch { materialFeedback = { projectId, sceneId, key: "saveFailed" }; }
    updateMaterials(panel);
  }

  function ensurePanel(grid) {
    let panel = grid.querySelector(":scope > .core-editor-assets-panel");
    if (panel instanceof HTMLElement) return panel;

    panel = document.createElement("aside");
    panel.className = "core-editor-assets-panel";
    panel.setAttribute("aria-label", t("assets"));
    panel.innerHTML =
      '<div class="core-assets-head"><strong>' + t("assets") + '</strong><button type="button" data-assets-collapse>‹</button></div>' +
      '<div class="core-assets-body">' +
        (window.ViralCoreProjectScenes?.surface?.() || '') +
        '<section class="core-scene-materials" data-scene-materials tabindex="-1" aria-label="' + escapeMaterial(materialText("title")) + '"></section>' +
        sectionLabel("project") +
        '<button type="button" class="core-asset-item core-source-asset" data-source-asset>' +
          '<span class="core-asset-icon">▶</span>' +
          '<span class="core-asset-copy"><b>' + t("source") + '</b><small data-source-name>—</small><em data-source-meta>—</em></span>' +
        '</button>' +
        '<button type="button" class="core-asset-item core-transcript-asset" data-transcript-asset>' +
          '<span class="core-asset-icon">TXT</span>' +
          '<span class="core-asset-copy"><b>' + t("transcript") + '</b><small data-transcript-status>' + t("noTranscript") + '</small></span>' +
        '</button>' +
        sectionLabel("media") +
        statRow("VID", "video", "video") +
        statRow("IMG", "images", "image") +
        statRow("AUD", "audio", "audio") +
        sectionLabel("discover") +
        '<button type="button" class="core-asset-item core-discover-action" data-find-media aria-label="' + t("findMedia") + '" title="' + t("findMedia") + '">' +
          '<span class="core-asset-icon" aria-hidden="true">⌕</span>' +
          '<span class="core-asset-copy"><b>' + t("findMedia") + '</b><small>' + t("findMediaHint") + '</small></span>' +
        '</button>' +
        '<div class="core-asset-item core-asset-stat is-upcoming" aria-disabled="true">' +
          '<span class="core-asset-icon">AI</span>' +
          '<span class="core-asset-copy"><b>' + t("generateAi") + '</b><small>' + t("generateAiHint") + '</small></span>' +
        '</div>' +
        sectionLabel("generated") +
        statRow("V", "aiVideo", "generated-video") +
        statRow("I", "aiImages", "generated-image") +
        statRow("A", "aiAudio", "generated-audio") +
        sectionLabel("favorites") +
        statRow("★", "saved", "favorites") +
      '</div>';

    grid.prepend(panel);
    panel.addEventListener("click", event => materialAction(event, panel));
    panel.querySelector("[data-assets-collapse]")?.addEventListener("click", () => {
      applyCollapsed(panel, !panel.classList.contains("is-collapsed"));
    });
    panel.querySelector("[data-source-asset]")?.addEventListener("click", () => {
      grid.querySelector("video.preview-video, video.core-player-media")?.focus?.();
      grid.querySelector(".preview")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
    panel.querySelector("[data-transcript-asset]")?.addEventListener("click", event => {
      const button = event.currentTarget;
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      window.dispatchEvent(new CustomEvent("viral-ai:bottom-dock-tab", { detail: { tab: "transcript" } }));
    });
    panel.querySelector("[data-find-media]")?.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("viral-ai:media-discovery-open", { detail: { kind: "video" } }));
    });
    applyCollapsed(panel, collapsed());
    return panel;
  }

  function updateCount(panel, key, value) {
    const row = panel.querySelector('[data-media-count="' + key + '"]');
    const target = row?.querySelector("[data-count-value]");
    setText(target, t("items", { count: value }));
    row?.classList.toggle("has-items", value > 0);
  }

  function updatePanel(panel, grid) {
    updateMaterials(panel);
    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    const name = panel.querySelector("[data-source-name]");
    const meta = panel.querySelector("[data-source-meta]");
    const transcript = panel.querySelector("[data-transcript-asset]");
    const transcriptStatus = panel.querySelector("[data-transcript-status]");

    const sourceName = source?.name || source?.sourcePath || video?.currentSrc || video?.src;
    setText(name, basename(sourceName));

    if (meta) {
      const nativeWidth = Number(video?.videoWidth || 0);
      const nativeHeight = Number(video?.videoHeight || 0);
      const storedWidth = Number(source?.meta?.width || 0);
      const storedHeight = Number(source?.meta?.height || 0);
      const width = nativeWidth > 0 ? nativeWidth : storedWidth;
      const height = nativeHeight > 0 ? nativeHeight : storedHeight;
      const duration = durationFor(video, source);
      const dimensions = width > 0 && height > 0 ? width + "×" + height : "—";
      setText(meta, dimensions + " · " + formatDuration(duration));
    }

    const transcriptCount = document.querySelectorAll(".transcript-list .transcript-row").length;
    if (transcript instanceof HTMLButtonElement) {
      transcript.disabled = transcriptCount === 0;
      transcript.classList.toggle("is-disabled", transcriptCount === 0);
      transcript.title = transcriptCount === 0 ? t("noTranscript") : t("segments", { count: transcriptCount });
    }
    setText(transcriptStatus, transcriptCount === 0 ? t("noTranscript") : t("segments", { count: transcriptCount }));

    updateCount(panel, "video", countAssets({ kind: "video" }));
    updateCount(panel, "image", countAssets({ kind: "image" }));
    updateCount(panel, "audio", countAssets({ kind: "audio" }));
    updateCount(panel, "generated-video", countAssets({ kind: "video", origin: "generated" }));
    updateCount(panel, "generated-image", countAssets({ kind: "image", origin: "generated" }));
    updateCount(panel, "generated-audio", countAssets({ kind: "audio", origin: "generated" }));
    updateCount(panel, "favorites", countAssets({ favorite: true }));
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-workbench-page")) return;
    const focus = page.querySelector(":scope > .core-editor-focus-section");
    const grid = focus?.querySelector(".editor-grid");
    if (!(grid instanceof HTMLElement)) return;

    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    if (!video && !source) return;

    const panel = ensurePanel(grid);
    updatePanel(panel, grid);
    grid.classList.add("core-editor-assets-grid");
    page.classList.add("core-editor-assets-page");
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  function structuralNode(node) {
    if (!(node instanceof Element)) return false;
    if (node.closest?.(".core-editor-assets-panel")) return false;
    return node.matches(STRUCTURE_SELECTOR) || Boolean(node.querySelector?.(STRUCTURE_SELECTOR));
  }

  function mutationNeedsRefresh(records) {
    return records.some(record => {
      if (record.type !== "childList") return false;
      return [...record.addedNodes, ...record.removedNodes].some(structuralNode);
    });
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(records => {
        if (mutationNeedsRefresh(records)) queue();
      }).observe(page, { childList: true, subtree: true });
    }
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("viral-ai:scene-plan-changed", queue);
    window.addEventListener("viral-ai:transcript-edit", queue);
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
