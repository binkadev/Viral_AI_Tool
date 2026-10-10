(function installAutomationScenesUi() {
  "use strict";

  let queued = false;

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
          intro: "Split the accepted script into editable scene beats with timing, visual intent and stock-search terms.",
          generate: "Create scenes",
          regenerate: "Rebuild scenes",
          open: "Open scenes",
          required: "Generate or save a script before creating scenes.",
          stale: "The script changed. Rebuild scenes before continuing.",
          scene: "Scene",
          narration: "Narration",
          visual: "Visual intent",
          search: "Search terms",
          timing: "Timing hint",
          save: "Save scene",
          saved: "Scene saved.",
          generated: "Scene plan created.",
          count: "scenes",
          strategy: "Stock first",
          ready: "Ready"
        }
      : {
          eyebrow: "03 · Phân cảnh",
          title: "Scene Planner",
          intro: "Tách kịch bản đã chốt thành các nhịp cảnh có thể chỉnh sửa, gồm timing, visual intent và từ khóa tìm stock.",
          generate: "Tạo phân cảnh",
          regenerate: "Tạo lại phân cảnh",
          open: "Xem phân cảnh",
          required: "Hãy tạo hoặc lưu kịch bản trước khi tạo phân cảnh.",
          stale: "Kịch bản đã thay đổi. Hãy tạo lại phân cảnh trước khi đi tiếp.",
          scene: "Cảnh",
          narration: "Lời đọc",
          visual: "Ý đồ hình ảnh",
          search: "Từ khóa tìm tư liệu",
          timing: "Gợi ý thời gian",
          save: "Lưu cảnh",
          saved: "Đã lưu cảnh.",
          generated: "Đã tạo phân cảnh.",
          count: "cảnh",
          strategy: "Ưu tiên stock",
          ready: "Sẵn sàng"
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

  function formatSec(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toFixed(number % 1 ? 1 : 0) + "s" : "—";
  }

  function signature() {
    const current = automation();
    return JSON.stringify({
      locale: locale(),
      script: current?.script?.outputSignature || null,
      plan: current?.scenePlan?.outputSignature || null,
      stale: current?.stale?.scenes === true,
      scenes: current?.scenePlan?.scenes?.map(scene => ({
        id: scene.id,
        narration: scene.narration,
        visualIntent: scene.visualIntent,
        searchTerms: scene.searchTerms,
        startHintSec: scene.startHintSec,
        durationHintSec: scene.durationHintSec
      })) || []
    });
  }

  function sceneCard(scene, index) {
    const c = copy();
    const terms = Array.isArray(scene.searchTerms) ? scene.searchTerms.join(", ") : "";
    return '<article class="automation-scene-card" data-scene-id="' + esc(scene.id) + '">' +
      '<div class="automation-scene-card-head"><div><span>' + esc(c.scene) + ' ' + (index + 1) + '</span><b>' + esc(formatSec(scene.startHintSec)) + ' → ' + esc(formatSec(Number(scene.startHintSec || 0) + Number(scene.durationHintSec || 0))) + '</b></div><small>' + esc(c.strategy) + '</small></div>' +
      '<label class="label">' + esc(c.narration) + '</label>' +
      '<textarea class="textarea" data-scene-field="narration" rows="4">' + esc(scene.narration) + '</textarea>' +
      '<label class="label">' + esc(c.visual) + '</label>' +
      '<textarea class="textarea" data-scene-field="visualIntent" rows="3">' + esc(scene.visualIntent) + '</textarea>' +
      '<label class="label">' + esc(c.search) + '</label>' +
      '<input class="input" data-scene-field="searchTerms" value="' + esc(terms) + '">' +
      '<div class="automation-scene-card-foot"><span>' + esc(c.timing) + ': ' + esc(formatSec(scene.durationHintSec)) + '</span><button class="button ghost automation-save-scene" type="button" data-scene-save="' + esc(scene.id) + '">' + esc(c.save) + '</button></div>' +
    '</article>';
  }

  function panelMarkup() {
    const c = copy();
    const current = automation();
    const script = current?.script;
    const plan = current?.scenePlan;
    const stale = current?.stale?.scenes === true;

    if (!script) {
      return '<div class="automation-scenes-panel locked"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.required) + '</p></div><button class="button ghost" type="button" disabled aria-disabled="true">' + esc(c.generate) + '</button></div>';
    }

    const action = plan ? c.regenerate : c.generate;
    const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
    return '<div class="automation-scenes-panel">' +
      '<div class="automation-scenes-head"><div><div class="eyebrow">' + esc(c.eyebrow) + '</div><h3>' + esc(c.title) + '</h3><p>' + esc(c.intro) + '</p></div><button id="automationGenerateScenes" class="button primary" type="button">✦ ' + esc(action) + '</button></div>' +
      (stale ? '<div class="automation-inline-warning">! ' + esc(c.stale) + '</div>' : '') +
      (scenes.length
        ? '<div class="automation-scenes-summary"><b>' + scenes.length + ' ' + esc(c.count) + '</b><span>' + esc(formatSec(plan.targetDurationSec)) + '</span><span>' + esc(c.strategy) + '</span></div><div class="automation-scenes-list">' + scenes.map(sceneCard).join("") + '</div>'
        : '<div class="automation-scenes-empty"><span>03</span><div><b>' + esc(c.title) + '</b><p>' + esc(c.intro) + '</p></div></div>') +
    '</div>';
  }

  function updateStage() {
    const rail = document.querySelector(".automation-stage-rail");
    if (!rail) return;
    const stages = rail.querySelectorAll(".automation-stage");
    const sceneStage = stages[2];
    if (!(sceneStage instanceof HTMLElement)) return;
    const current = automation();
    const hasScript = Boolean(current?.script);
    const hasPlan = Boolean(current?.scenePlan) && current?.stale?.scenes !== true;
    sceneStage.classList.toggle("locked", !hasScript);
    sceneStage.classList.toggle("active", hasScript && !hasPlan);
    sceneStage.classList.toggle("ready", hasPlan);
    const small = sceneStage.querySelector("small");
    const label = hasPlan ? copy().ready : hasScript ? copy().generate : (locale() === "en" ? "Next phase" : "Phase tiếp theo");
    if (small && small.textContent !== label) small.textContent = label;
  }

  function ensureHost() {
    const creator = document.querySelector(".automation-creator");
    if (!(creator instanceof HTMLElement)) return null;

    let host = creator.querySelector(":scope > .automation-scenes-host");
    if (host instanceof HTMLElement) return host;

    const legacyNext = creator.querySelector(":scope > .automation-next-card");
    host = document.createElement("div");
    host.className = "card automation-next-card automation-scenes-host";
    host.dataset.scenePlannerMount = "true";

    if (legacyNext instanceof HTMLElement) legacyNext.replaceWith(host);
    else creator.appendChild(host);
    return host;
  }

  function ensureQuickAction() {
    const rail = document.querySelector(".automation-stage-rail");
    if (!(rail instanceof HTMLElement)) return null;
    const current = automation();
    const script = current?.script;
    let quick = document.getElementById("automationSceneQuickAction");

    if (!script) {
      quick?.remove();
      return null;
    }

    if (!(quick instanceof HTMLElement)) {
      quick = document.createElement("div");
      quick.id = "automationSceneQuickAction";
      quick.className = "automation-scene-quick";
      rail.insertAdjacentElement("afterend", quick);
    }

    const hasPlan = Boolean(current?.scenePlan) && current?.stale?.scenes !== true;
    const c = copy();
    const quickSignature = [locale(), current?.script?.outputSignature || "", current?.scenePlan?.outputSignature || "", current?.stale?.scenes === true].join("|");
    if (quick.dataset.signature !== quickSignature) {
      quick.dataset.signature = quickSignature;
      quick.innerHTML = '<div><span>' + esc(c.eyebrow) + '</span><b>' + esc(c.title) + '</b><small>' + esc(hasPlan ? c.ready : c.intro) + '</small></div>' +
        '<button id="automationSceneQuickButton" class="button primary" type="button">' + (hasPlan ? esc(c.open) : '✦ ' + esc(c.generate)) + '</button>';
    }
    return quick;
  }

  function scrollToScenes() {
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;
    try { host.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch { host.scrollIntoView(); }
  }

  function scan() {
    queued = false;
    if (appState()?.page !== "automation") return;
    const host = ensureHost();
    if (!(host instanceof HTMLElement)) return;

    const nextSignature = signature();
    if (host.dataset.sceneUiSignature !== nextSignature) {
      host.dataset.sceneUiSignature = nextSignature;
      const markup = panelMarkup();
      if (host.innerHTML !== markup) host.innerHTML = markup;
    }
    updateStage();
    ensureQuickAction();
  }

  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  function generateScenes({ scroll = false } = {}) {
    const result = window.ViralAutomationSceneState?.generatePlan?.();
    if (!result?.ok) {
      try { if (typeof toast === "function") toast(copy().required); } catch {}
      return;
    }
    try { if (typeof toast === "function") toast(copy().generated); } catch {}
    queueScan();
    if (scroll) requestAnimationFrame(() => requestAnimationFrame(scrollToScenes));
  }

  function saveScene(sceneId, card) {
    const value = field => card.querySelector('[data-scene-field="' + field + '"]')?.value || "";
    const result = window.ViralAutomationSceneState?.editScene?.(sceneId, {
      narration: value("narration"),
      visualIntent: value("visualIntent"),
      searchTerms: value("searchTerms")
    });
    if (result?.ok) {
      try { if (typeof toast === "function") toast(copy().saved); } catch {}
      queueScan();
    }
  }

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.id === "automationGenerateScenes") {
      event.preventDefault();
      generateScenes();
      return;
    }
    if (button.id === "automationSceneQuickButton") {
      event.preventDefault();
      const current = automation();
      const hasPlan = Boolean(current?.scenePlan) && current?.stale?.scenes !== true;
      if (hasPlan) scrollToScenes();
      else generateScenes({ scroll: true });
      return;
    }
    const sceneId = button.dataset.sceneSave;
    if (sceneId) {
      event.preventDefault();
      const card = button.closest(".automation-scene-card");
      if (card) saveScene(sceneId, card);
    }
  }, true);

  window.addEventListener("viral-ai:core-state-changed", queueScan);
  window.addEventListener("viral-ai:automation-page-rendered", queueScan);

  const start = () => {
    const page = document.getElementById("page");
    if (page) {
      new MutationObserver(queueScan).observe(page, { childList: true, subtree: true });
    }
    queueScan();
    document.documentElement.dataset.automationScenePlanner = "enabled";
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationScenesUi = {
    renderPanel: panelMarkup,
    refresh: queueScan,
    scrollToScenes
  };
})();
