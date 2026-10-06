(function installCoreEditorWorkbench() {
  "use strict";

  const TAB_KEY = "viral-ai-core-editor-inspector-tab";
  const VALID_TABS = new Set(["speech", "translate", "voice", "output"]);
  let queued = false;

  function copy() {
    let locale = "vi";
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      locale = saved?.locale === "en" ? "en" : "vi";
    } catch {}
    return locale === "en"
      ? { speech: "Speech", translate: "Translate", voice: "Voice", output: "Output", inspector: "AI & properties" }
      : { speech: "Lời nói", translate: "Dịch", voice: "Giọng", output: "Đầu ra", inspector: "AI & thuộc tính" };
  }

  function selectedTab() {
    const value = localStorage.getItem(TAB_KEY) || "speech";
    return VALID_TABS.has(value) ? value : "speech";
  }

  function setSelectedTab(value, { resetScroll = false } = {}) {
    if (!VALID_TABS.has(value)) return;
    localStorage.setItem(TAB_KEY, value);
    document.querySelectorAll(".core-inspector-tab").forEach(button => {
      const active = button.dataset.inspectorTab === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".core-inspector-pane").forEach(pane => {
      const active = pane.dataset.inspectorPane === value;
      pane.classList.toggle("is-active", active);
      pane.hidden = !active;
    });
    if (resetScroll) {
      document.querySelectorAll(".core-inspector-panes").forEach(scroller => {
        scroller.scrollTop = 0;
      });
    }
  }

  function ensureInspector(side) {
    let inspector = side.querySelector(":scope > .core-editor-inspector");
    if (inspector instanceof HTMLElement) {
      if (side.firstElementChild !== inspector) side.prepend(inspector);
      return inspector;
    }

    const c = copy();
    inspector = document.createElement("section");
    inspector.className = "core-editor-inspector";
    inspector.setAttribute("aria-label", c.inspector);
    inspector.innerHTML =
      '<div class="core-inspector-tabs" role="tablist" aria-label="' + c.inspector + '">' +
        '<button type="button" class="core-inspector-tab" data-inspector-tab="speech" role="tab">' + c.speech + '</button>' +
        '<button type="button" class="core-inspector-tab" data-inspector-tab="translate" role="tab">' + c.translate + '</button>' +
        '<button type="button" class="core-inspector-tab" data-inspector-tab="voice" role="tab">' + c.voice + '</button>' +
        '<button type="button" class="core-inspector-tab" data-inspector-tab="output" role="tab">' + c.output + '</button>' +
      '</div>' +
      '<div class="core-inspector-panes">' +
        '<div class="core-inspector-pane" data-inspector-pane="speech" role="tabpanel"></div>' +
        '<div class="core-inspector-pane" data-inspector-pane="translate" role="tabpanel"></div>' +
        '<div class="core-inspector-pane" data-inspector-pane="voice" role="tabpanel"></div>' +
        '<div class="core-inspector-pane" data-inspector-pane="output" role="tabpanel"><div class="core-output-actions"></div></div>' +
      '</div>';
    side.prepend(inspector);
    side.scrollTop = 0;

    inspector.querySelectorAll(".core-inspector-tab").forEach(button => {
      button.addEventListener("click", () => setSelectedTab(button.dataset.inspectorTab, { resetScroll: true }));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const order = ["speech", "translate", "voice", "output"];
        const current = order.indexOf(button.dataset.inspectorTab);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = order[(current + delta + order.length) % order.length];
        setSelectedTab(next, { resetScroll: true });
        inspector.querySelector('[data-inspector-tab="' + next + '"]')?.focus();
      });
    });
    setSelectedTab(selectedTab());
    return inspector;
  }

  function moveStaticSideContent(side, inspector) {
    const outputPane = inspector.querySelector('[data-inspector-pane="output"]');
    const actions = inspector.querySelector(".core-output-actions");
    if (!(outputPane instanceof HTMLElement)) return;

    Array.from(side.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child === inspector) return;
      child.classList.add("core-inspector-static");
      if (actions instanceof HTMLElement) outputPane.insertBefore(child, actions);
      else outputPane.appendChild(child);
    });
  }

  function closestCard(control) {
    return control instanceof HTMLElement ? control.closest(".card") : null;
  }

  function moveCard(page, inspector, controlSelector, paneName) {
    const control = page.querySelector(controlSelector);
    const card = closestCard(control);
    const pane = inspector.querySelector('[data-inspector-pane="' + paneName + '"]');
    if (!(card instanceof HTMLElement) || !(pane instanceof HTMLElement)) return;
    if (card.parentElement !== pane) pane.appendChild(card);
    card.classList.add("core-inspector-card", "core-inspector-card-" + paneName);
  }

  function moveRender(page, inspector) {
    const render = page.querySelector("#render");
    const legacyHead = render instanceof HTMLElement ? render.closest(".section-head") : null;
    const legacyWorkflow = legacyHead?.nextElementSibling instanceof HTMLElement && legacyHead.nextElementSibling.classList.contains("workflow")
      ? legacyHead.nextElementSibling
      : page.querySelector(":scope > .workflow");
    const target = inspector.querySelector(".core-output-actions");

    if (legacyHead instanceof HTMLElement) legacyHead.classList.add("core-editor-legacy-workflow");
    if (legacyWorkflow instanceof HTMLElement) legacyWorkflow.classList.add("core-editor-legacy-workflow");

    if (render instanceof HTMLButtonElement && target instanceof HTMLElement && render.parentElement !== target) {
      target.appendChild(render);
      render.classList.add("core-inspector-render");
    }
  }

  function markCurrentStage(page) {
    const state = [
      ["#speechStart, #speechStop", "speech"],
      ["#translationStart, #translationStop", "translate"],
      ["#voiceStart, #voiceStop", "voice"],
      ["#render", "output"]
    ];
    for (const [selector, tab] of state) {
      const button = page.querySelector(selector);
      if (!(button instanceof HTMLButtonElement)) continue;
      const tabButton = page.querySelector('.core-inspector-tab[data-inspector-tab="' + tab + '"]');
      if (!(tabButton instanceof HTMLButtonElement)) continue;
      const busy = /Stop|Dừng|Hủy|Cancel/i.test(button.textContent || "") || button.dataset.coreJobState === "processing";
      tabButton.classList.toggle("has-active-job", busy);
      tabButton.classList.toggle("is-blocked", button.disabled);
    }
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-focused-page")) return;

    const focus = page.querySelector(":scope > .core-editor-focus-section");
    const grid = focus?.querySelector(".editor-grid");
    const side = grid?.querySelector(":scope > .stack");
    if (!(focus instanceof HTMLElement) || !(grid instanceof HTMLElement) || !(side instanceof HTMLElement)) return;

    const inspector = ensureInspector(side);
    moveStaticSideContent(side, inspector);
    moveCard(page, inspector, "#speechMode", "speech");
    moveCard(page, inspector, "#translationMode", "translate");
    moveCard(page, inspector, "#voiceMode", "voice");
    moveRender(page, inspector);
    markCurrentStage(page);

    page.classList.add("core-editor-workbench-page");
    grid.classList.add("core-editor-workbench-grid");
    document.documentElement.dataset.coreEditorWorkbench = "enabled";
    setSelectedTab(selectedTab());
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    window.addEventListener("viral-ai:editor-preview-preserved", queue);
    window.addEventListener("viral-ai:core-state-changed", queue);
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
