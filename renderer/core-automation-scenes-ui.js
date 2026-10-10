(function installAutomationScenesUi() {
  "use strict";

  let queued = false;
  let selectedSceneId = null;

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
          eyebrow: "03 · Scenes",
          title: "Scene Planner",
          intro: "Review one scene at a time. Each scene keeps narration, visual intent, timing and media-search terms together.",
          generate: "Create scenes",
          regenerate: "Rebuild scenes",
          required: "Generate or save a script before creating scenes.",
          stale: "The script changed. Rebuild scenes before continuing.",
          scene: "Scene",
          scenes: "Scenes",
          narration: "Narration",
          visual: "Visual direction",
          search: "Media search terms",
          timing: "Timing",
          save: "Save scene",
          saved: "Scene saved.",
          generated: "Scene plan created.",
          strategy: "Stock first",
          total: "Total",
          selected: "Editing",
          previous: "Previous scene",
          next: "Next scene",
          emptyTitle: "No scenes yet",
          emptyBody: "Create the scene plan from the accepted script, then review each scene before moving to assets."
        }
      : {
          eyebrow: "03 · Phân cảnh",
          title: "Scene Planner",
          intro: "Chỉnh từng cảnh một. Mỗi cảnh gom lời đọc, ý đồ hình ảnh, thời lượng và từ khóa tìm tư liệu vào cùng một chỗ.",
          generate: "Tạo phân cảnh",
          regenerate: "Tạo lại phân cảnh",
          required: "Hãy tạo hoặc lưu kịch bản trước khi tạo phân cảnh.",
          stale: "Kịch bản đã thay đổi. Hãy tạo lại phân cảnh trước khi đi tiếp.",
          scene: "Cảnh",
          scenes: "Phân cảnh",
          narration: "Lời đọc",
          visual: "Ý đồ hình ảnh",
          search: "Từ khóa tìm tư liệu",
          timing: "Thời lượng",
          save: "Lưu cảnh",
          saved: "Đã lưu cảnh.",
          generated: "Đã tạo phân cảnh.",
          strategy: "Ưu tiên stock",
          total: "Tổng",
          selected: "Đang chỉnh",
          previous: "Cảnh trước",
          next: "Cảnh sau",
          emptyTitle: "Chưa có phân cảnh",
          emptyBody: "Tạo phân cảnh từ kịch bản đã chốt, sau đó kiểm tra từng cảnh trước khi chuyển sang tư liệu."
        };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function automation() {
    return appState()?.automation || null;
  }

  function scenes() {
    const list = automation()?.scenePlan?.scenes;
    return Array.isArray(list) ? list : [];
  }

  function formatSec(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "—";
    return number.toFixed(number % 1 ? 1 : 0) + "s";
  }

  function sceneEnd(scene) {
    return Number(scene?.startHintSec || 0) + Number(scene?.durationHintSec || 0);
  }

  function sceneLabel(scene, index) {
    return copy().scene + " " + (index + 1);
  }

  function sceneSnippet(scene) {
    const text = String(scene?.narration || "").trim().replace(/\s+/g, " ");
    return text.length > 72 ? text.slice(0, 69) + "…" : text;
  }

  function ensureSelection(list = scenes()) {
    if (!list.length) {
      selectedSceneId = null;
      return null;
    }
    if (!selectedSceneId || !list.some(scene => scene.id === selectedSceneId)) {
      selectedSceneId = list[0].id;
    }
    return list.find(scene => scene.id === selectedSceneId) || list[0];
  }

  function signature() {
    const current = automation();
    return JSON.stringify({
      locale: locale(),
      script: current?.script?.outputSignature || null,
      plan: current?.scenePlan?.outputSignature || null,
      stale: current?.stale?.scenes === true,
      selectedSceneId,
      scenes: scenes().map(scene => ({
        id: scene.id,
        narration: scene.narration,
        visualIntent: scene.visualIntent,
        searchTerms: scene.searchTerms,
        startHintSec: scene.startHintSec,
        durationHintSec: scene.durationHintSec
      }))
    });
  }

  function navItem(scene, index, selected) {
    return '<button class="automation-scene-nav-item' + (selected ? ' is-selected' : '') + '" type="button" data-scene-select="' + esc(scene.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="automation-scene-nav-index">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<span class="automation-scene-nav-copy"><b>' + esc(sceneLabel(scene, index)) + '</b><small>' + esc(formatSec(scene.startHintSec)) + ' – ' + esc(formatSec(sceneEnd(scene))) + '</small><em>' + esc(sceneSnippet(scene)) + '</em></span>' +
      '<span class="automation-scene-nav-arrow" aria-hidden="true">›</span>' +
    '</button>';
  }

  function editorMarkup(scene, index, list) {
    const c = copy();
    const terms = Array.isArray(scene.searchTerms) ? scene.searchTerms.join(", ") : "";
    const previousDisabled = index <= 0;
    const nextDisabled = index >= list.length - 1;

    return '<section class="automation-scene-inspector" data-scene-id="' + esc(scene.id) + '">' +
      '<header class="automation-scene-inspector-head">' +
        '<div><div class="eyebrow">' + esc(c.selected) + '</div><h4>' + esc(sceneLabel(scene, index)) + '</h4><p>' + esc(formatSec(scene.startHintSec)) + ' → ' + esc(formatSec(sceneEnd(scene))) + '</p></div>' +
        '<div class="automation-scene-inspector-chips"><span>' + esc(formatSec(scene.durationHintSec)) + '</span><span>' + esc(c.strategy) + '</span></div>' +
      '</header>' +
      '<div class="automation-scene-editor-grid">' +
        '<div class="automation-scene-primary">' +
          '<label class="automation-scene-field"><span>' + esc(c.narration) + '</span><textarea class="textarea" data-scene-field="narration" rows="8">' + esc(scene.narration) + '</textarea></label>' +
        '</div>' +
        '<div class="automation-scene-secondary">' +
          '<label class="automation-scene-field"><span>' + esc(c.visual) + '</span><textarea class="textarea" data-scene-field="visualIntent" rows="5">' + esc(scene.visualIntent) + '</textarea></label>' +
          '<label class="automation-scene-field"><span>' + esc(c.search) + '</span><input class="input" data-scene-field="searchTerms" value="' + esc(terms) + '"></label>' +
        '</div>' +
      '</div>' +
      '<footer class="automation-scene-inspector-foot">' +
        '<div class="automation-scene-nav-actions">' +
          '<button class="button ghost" type="button" data-scene-step="-1"' + (previousDisabled ? ' disabled aria-disabled="true"' : '') + '>← ' + esc(c.previous) + '</button>' +
          '<button class="button ghost" type="button" data-scene-step="1"' + (nextDisabled ? ' disabled aria-disabled="true"' : '') + '>' + esc(c.next) + ' →</button>' +
        '</div>' +
        '<button class="button primary" type="button" data-scene-save="' + esc(scene.id) + '">' + esc(c.save) + '</button>' +
      '</footer>' +
    '</section>';
  }

  function panelMarkup() {
    const c = copy();
    const current = automation();
    const script = current?.script;
    const plan = current?.scenePlan;
    const stale = current?.stale?.scenes === true;

    if (!script) {
      return '<section class="automation-scenes-panel is-locked"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.required) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(c.generate) + '</button></section>';
    }

    const list = scenes();
    const selected = ensureSelection(list);
    const selectedIndex = selected ? list.findIndex(scene => scene.id === selected.id) : -1;
    const action = plan ? c.regenerate : c.generate;

    return '<section class="automation-scenes-panel">' +
      '<header class="automation-scenes-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationGenerateScenes" class="button primary" type="button">✦ ' + esc(action) + '</button></header>' +
      (stale ? '<div class="automation-inline-warning">! ' + esc(c.stale) + '</div>' : '') +
      (list.length
        ? '<div class="automation-scenes-summary"><b>' + list.length + ' ' + esc(c.scenes) + '</b><span>' + esc(c.total) + ': ' + esc(formatSec(plan?.targetDurationSec)) + '</span><span>' + esc(c.strategy) + '</span></div>' +
          '<div class="automation-scenes-workbench">' +
            '<aside class="automation-scenes-nav" aria-label="' + esc(c.scenes) + '">' + list.map((scene, index) => navItem(scene, index, scene.id === selected?.id)).join("") + '</aside>' +
            (selected ? editorMarkup(selected, selectedIndex, list) : '') +
          '</div>'
        : '<div class="automation-scenes-empty"><div class="automation-scenes-empty-icon">03</div><div><h4>' + esc(c.emptyTitle) + '</h4><p>' + esc(c.emptyBody) + '</p><button id="automationGenerateScenesEmpty" class="button primary" type="button">✦ ' + esc(c.generate) + '</button></div></div>') +
    '</section>';
  }

  function updateLegacyStage() {
    const creator = document.querySelector(".automation-creator");
    if (creator?.classList.contains("automation-workspace-v2")) return;
    const rail = document.querySelector(".automation-stage-rail");
    if (!rail) return;
    const stage = rail.querySelectorAll(".automation-stage")[2];
    if (!(stage instanceof HTMLElement)) return;
    const hasScript = Boolean(automation()?.script);
    const hasPlan = Boolean(automation()?.scenePlan) && automation()?.stale?.scenes !== true;
    stage.classList.toggle("locked", !hasScript);
    stage.classList.toggle("active", hasScript && !hasPlan);
    stage.classList.toggle("ready", hasPlan);
  }

  function ensureHost() {
    const creator = document.querySelector(".automation-creator");
    if (!(creator instanceof HTMLElement)) return null;

    let host = creator.querySelector(":scope > .automation-scenes-host");
    if (host instanceof HTMLElement) return host;

    const legacyNext = creator.querySelector(":scope > .automation-next-card");
    host = document.createElement("div");
    host.className = "automation-scenes-host";
    host.dataset.scenePlannerMount = "true";

    if (legacyNext instanceof HTMLElement) legacyNext.replaceWith(host);
    else creator.appendChild(host);
    return host;
  }

  function removeLegacyQuickAction() {
    document.getElementById("automationSceneQuickAction")?.remove();
  }

  function scrollToScenes() {
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    try { host.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch { host.scrollIntoView(); }
  }

  function renderHost({ force = false } = {}) {
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    ensureSelection();
    const nextSignature = signature();
    if (!force && host.dataset.sceneUiSignature === nextSignature) return;
    host.dataset.sceneUiSignature = nextSignature;
    const markup = panelMarkup();
    if (host.innerHTML !== markup) host.innerHTML = markup;
  }

  function scan() {
    queued = false;
    if (appState()?.page !== "automation") return;
    renderHost();
    updateLegacyStage();
    removeLegacyQuickAction();
  }

  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function generateScenes() {
    const result = window.ViralAutomationSceneState?.generatePlan?.();
    if (!result?.ok) {
      try { if (typeof toast === "function") toast(copy().required); } catch {}
      return;
    }
    selectedSceneId = result.value?.scenes?.[0]?.id || automation()?.scenePlan?.scenes?.[0]?.id || null;
    try { if (typeof toast === "function") toast(copy().generated); } catch {}
    renderHost({ force: true });
  }

  function saveScene(sceneId, inspector) {
    const value = field => inspector.querySelector('[data-scene-field="' + field + '"]')?.value || "";
    const result = window.ViralAutomationSceneState?.editScene?.(sceneId, {
      narration: value("narration"),
      visualIntent: value("visualIntent"),
      searchTerms: value("searchTerms")
    });
    if (result?.ok) {
      try { if (typeof toast === "function") toast(copy().saved); } catch {}
      renderHost({ force: true });
    }
  }

  function selectScene(sceneId) {
    if (!sceneId || sceneId === selectedSceneId) return;
    if (!scenes().some(scene => scene.id === sceneId)) return;
    selectedSceneId = sceneId;
    renderHost({ force: true });
  }

  function stepScene(delta) {
    const list = scenes();
    const currentIndex = Math.max(0, list.findIndex(scene => scene.id === selectedSceneId));
    const nextIndex = Math.max(0, Math.min(list.length - 1, currentIndex + Number(delta || 0)));
    if (list[nextIndex]) selectScene(list[nextIndex].id);
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const select = target.closest("[data-scene-select]");
    if (select) {
      event.preventDefault();
      selectScene(select.getAttribute("data-scene-select"));
      return;
    }

    const step = target.closest("[data-scene-step]");
    if (step instanceof HTMLButtonElement && !step.disabled) {
      event.preventDefault();
      stepScene(Number(step.getAttribute("data-scene-step") || 0));
      return;
    }

    const button = target.closest("button");
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.id === "automationGenerateScenes" || button.id === "automationGenerateScenesEmpty") {
      event.preventDefault();
      generateScenes();
      return;
    }

    const sceneId = button.dataset.sceneSave;
    if (sceneId) {
      event.preventDefault();
      const inspector = button.closest(".automation-scene-inspector");
      if (inspector) saveScene(sceneId, inspector);
    }
  }, true);

  window.addEventListener("viral-ai:core-state-changed", queueScan);
  window.addEventListener("viral-ai:automation-page-rendered", queueScan);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queueScan).observe(page, { childList: true, subtree: true });
    queueScan();
    document.documentElement.dataset.automationScenePlanner = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationScenesUi = {
    renderPanel: panelMarkup,
    refresh: queueScan,
    scrollToScenes,
    selectScene
  };
})();
