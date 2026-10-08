(function installCoreEditorOutputStateV2() {
  "use strict";

  const model = window.ViralCoreWorkflowModel;
  const verification = { path: "", state: "idle" }; // idle | checking | ready | missing | unverified
  let queued = false;
  let unsubscribe = null;

  function appState() {
    try { if (typeof state !== "undefined") return state; } catch {}
    try { return JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}"); } catch { return {}; }
  }
  function locale() { return appState()?.locale === "en" ? "en" : "vi"; }
  function tr(key, vars) {
    try {
      const value = window.I18N?.t?.(locale(), key, vars);
      return typeof value === "string" ? value : key;
    } catch {
      return key;
    }
  }
  function labels(fileName) {
    return {
      eyebrow: tr("common.export"),
      ready: tr("media.renderDone"),
      readyBody: tr("media.exportDone"),
      show: tr("media.showFile"),
      checking: tr("settings.updateChecking"),
      missing: tr("file.missingTitle"),
      missingBody: tr("file.missingBody", { name: fileName || tr("common.video") }),
      rerender: tr("export.retry"),
      unverified: tr("file.unknownDetails"),
      unverifiedBody: "",
      recheck: tr("translation.retry"),
      waiting: tr("common.export")
    };
  }
  function output() {
    try { return model?.derive?.(appState())?.renderOutput || null; } catch { return null; }
  }
  function basename(value) {
    const raw = String(value || "");
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw || "—";
  }
  function reset(path = "") {
    verification.path = String(path || "");
    verification.state = "idle";
  }

  async function verify(path, force = false) {
    const value = String(path || "");
    if (!value) return "idle";
    if (verification.path !== value) reset(value);
    if (!force && verification.state !== "idle") return verification.state;
    if (!window.desktopAPI?.fileStatus) {
      verification.state = "unverified";
      queue();
      return verification.state;
    }
    verification.state = "checking";
    queue();
    try {
      const result = await window.desktopAPI.fileStatus(value);
      if (verification.path === value) verification.state = result?.exists === true ? "ready" : "missing";
    } catch {
      if (verification.path === value) verification.state = "unverified";
    }
    queue();
    return verification.state;
  }

  function ensure(pane) {
    let card = pane.querySelector(":scope > .core-output-state-card");
    if (!(card instanceof HTMLElement)) {
      card = document.createElement("section");
      card.className = "core-output-state-card";
      card.setAttribute("role", "status");
      card.setAttribute("aria-live", "polite");
      card.innerHTML = '<div class="core-output-state-icon" aria-hidden="true"></div><div class="core-output-state-copy"><small data-output-eyebrow></small><b data-output-title></b><span data-output-body></span><code data-output-file></code></div><button type="button" class="core-output-state-action" data-output-show></button>';
      pane.prepend(card);
    }
    let hint = pane.querySelector(":scope > .core-output-state-hint");
    if (!(hint instanceof HTMLElement)) {
      hint = document.createElement("p");
      hint.className = "core-output-state-hint";
      pane.prepend(hint);
    }
    return { card, hint };
  }
  function setAction(button, text, disabled, handler) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.textContent = text;
    button.disabled = Boolean(disabled);
    button.onclick = disabled ? null : handler;
  }

  function renderCard(card, out, stateName, c) {
    card.hidden = false;
    card.dataset.outputState = stateName;
    card.dataset.outputReady = stateName === "ready" ? "true" : "false";
    card.setAttribute("aria-busy", stateName === "checking" || stateName === "idle" ? "true" : "false");
    const icon = card.querySelector(".core-output-state-icon");
    const eyebrow = card.querySelector("[data-output-eyebrow]");
    const title = card.querySelector("[data-output-title]");
    const body = card.querySelector("[data-output-body]");
    const file = card.querySelector("[data-output-file]");
    const button = card.querySelector("[data-output-show]");
    if (eyebrow) eyebrow.textContent = c.eyebrow;
    if (file) { file.textContent = basename(out.outputPath); file.title = String(out.outputPath); }

    if (stateName === "missing") {
      if (icon) icon.textContent = "!";
      if (title) title.textContent = c.missing;
      if (body) body.textContent = c.missingBody;
      const render = document.getElementById("render");
      setAction(button, c.rerender, !(render instanceof HTMLButtonElement) || render.disabled, () => render?.click());
      return;
    }
    if (stateName === "unverified") {
      if (icon) icon.textContent = "?";
      if (title) title.textContent = c.unverified;
      if (body) body.textContent = c.unverifiedBody;
      setAction(button, c.recheck, false, () => verify(out.outputPath, true));
      return;
    }
    if (stateName === "checking" || stateName === "idle") {
      if (icon) icon.textContent = "…";
      if (title) title.textContent = c.checking;
      if (body) body.textContent = c.readyBody;
      setAction(button, c.checking, true, null);
      return;
    }
    if (icon) icon.textContent = "✓";
    if (title) title.textContent = c.ready;
    if (body) body.textContent = c.readyBody;
    setAction(button, c.show, !window.desktopAPI?.showFile, async () => {
      const status = await verify(out.outputPath, true);
      if (status !== "ready") return;
      try { await window.desktopAPI.showFile(out.outputPath); }
      catch { verification.state = "unverified"; queue(); }
    });
  }

  function sync() {
    queued = false;
    const pane = document.querySelector('#page .core-inspector-pane[data-inspector-pane="output"]');
    if (!(pane instanceof HTMLElement)) return;
    const out = output();
    const c = labels(basename(out?.outputPath));
    const { card, hint } = ensure(pane);
    if (!out?.outputPath) {
      card.hidden = true;
      card.setAttribute("aria-busy", "false");
      hint.hidden = false;
      hint.textContent = c.waiting;
      reset();
      return;
    }
    hint.hidden = true;
    if (out.fileState === "missing" || out.fileState === "trashed") {
      if (verification.path !== out.outputPath) reset(out.outputPath);
      verification.state = "missing";
    } else if (verification.path !== out.outputPath) {
      reset(out.outputPath);
    }
    if (verification.state === "idle") verify(out.outputPath).catch(() => {});
    renderCard(card, out, verification.state, c);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }
  function recheck() {
    const out = output();
    if (!out?.outputPath) return queue();
    reset(out.outputPath);
    verify(out.outputPath, true).catch(() => {});
  }
  function start() {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList:true, subtree:false });
    window.addEventListener("viral-ai:core-state-changed", queue);
    window.addEventListener("focus", recheck);
    if (typeof window.desktopAPI?.onRenderProgress === "function") {
      try { unsubscribe = window.desktopAPI.onRenderProgress(queue); } catch {}
    }
    window.addEventListener("beforeunload", () => { try { unsubscribe?.(); } catch {} }, { once:true });
    queue();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
  else start();
})();
