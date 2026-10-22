(function() {
  "use strict";
  const model = window.ViralPrivateBetaModel;
  let info, update, contextualImport = false, notice;
  const shouldNotify = model.notificationSession();
  const tr = key => window.I18N.t(state.locale === "en" ? "en" : "vi", "betaUpdates." + key);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const button = (action, label, disabled = false) => '<button type="button" class="button" data-beta-update="' + action + '"' + (disabled ? " disabled" : "") + '>' + escape(tr(label)) + '</button>';
  function identify() {
    const name = document.querySelector(".brand-name"), sub = document.querySelector(".brand-sub"), pill = document.getElementById("desktopPill");
    if (name) name.textContent = tr("product");
    if (sub) sub.textContent = tr("identity");
    if (pill) pill.textContent = tr("identity") + " · " + info.version;
  }
  function settings() {
    if (state.page !== "settings" || !update) return;
    let panel = document.getElementById("betaUpdates");
    if (!panel) {
      panel = document.createElement("section"); panel.id = "betaUpdates"; panel.className = "card card-pad beta-updates";
      document.querySelector(".release-info-card")?.after(panel);
    }
    const status = update.status || "idle";
    const waiting = ["checking", "downloading", "installing"].includes(status);
    const code = update.errorCode ? tr("errors." + update.errorCode) : "";
    const markup = '<h3>' + escape(tr("title")) + '</h3><dl class="beta-update-facts"><div><dt>' + escape(tr("current")) + '</dt><dd>' + escape(update.currentVersion || info.version) + '</dd></div><div><dt>' + escape(tr("channel")) + '</dt><dd>' + escape(tr("identity")) + '</dd></div><div><dt>' + escape(tr("lastChecked")) + '</dt><dd>' + escape(update.lastCheckedAt ? new Date(update.lastCheckedAt).toLocaleString(state.locale === "en" ? "en-US" : "vi-VN") : tr("never")) + '</dd></div></dl>' +
      '<label class="beta-automatic"><input type="checkbox" data-beta-automatic' + (update.automatic ? ' checked' : '') + '><span>' + escape(tr("automatic")) + '</span></label>' +
      '<p role="status" aria-live="polite">' + escape(tr("states." + status)) + (update.availableVersion ? ' · ' + escape(update.availableVersion) : '') + '</p>' +
      (status === "downloading" ? '<progress aria-label="' + escape(tr("states.downloading")) + '" max="100" value="' + Number(update.percent || 0) + '"></progress><span> ' + Math.round(update.percent || 0) + '%</span>' : '') +
      (code ? '<p class="beta-update-error" role="status">' + escape(code) + '</p>' : '') +
      '<div class="beta-update-actions">' + button("check", "check", waiting || !update.enabled || status === "downloaded") +
      (status === "available" ? button("download", "download") : '') +
      (status === "downloading" ? button("cancel", "cancel") : '') +
      (status === "downloaded" ? button("install", "install") + button("later", "later") : '') + '</div>' +
      (update.releaseNotes ? '<details><summary>' + escape(tr("notes")) + '</summary><p class="beta-release-notes">' + escape(update.releaseNotes) + '</p></details>' : '') +
      (!update.enabled ? '<p class="muted">' + escape(tr("packagedOnly")) + '</p>' : '');
    // Avoid replacing focused controls on unrelated DOM scans/renders.
    if (panel.dataset.content !== markup) {
      const active = document.activeElement, within = panel.contains(active);
      const focusedAction = within ? active.dataset.betaUpdate : null;
      const automaticFocused = within && active.matches("[data-beta-automatic]");
      const notesOpen = panel.querySelector("details")?.open;
      panel.innerHTML = markup; panel.dataset.content = markup;
      if (notesOpen && panel.querySelector("details")) panel.querySelector("details").open = true;
      if (within) {
        const next = automaticFocused ? panel.querySelector("[data-beta-automatic]") :
          panel.querySelector('[data-beta-update="' + focusedAction + '"]:not(:disabled)') ||
          panel.querySelector('[data-beta-update="' + (status === "downloaded" ? "install" : status === "downloading" ? "cancel" : "check") + '"]:not(:disabled)');
        if (next) next.focus({ preventScroll: true });
        else { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
      }
    }
  }
  function showNotice() {
    if (!notice) { notice = document.createElement("aside"); notice.className = "beta-update-notice"; notice.setAttribute("role", "status"); document.body.append(notice); }
    notice.innerHTML = '<strong>' + escape(tr("notice")) + '</strong><p>' + escape(tr("product")) + ' ' + escape(update.availableVersion) + '</p><div class="beta-update-actions">' + button("view", "view") + button("later", "later") + '</div>';
    notice.hidden = false;
  }
  function accept(next) {
    if (!next?.status) return;
    update = next; settings();
    if (shouldNotify(update)) showNotice();
  }
  async function start() {
    if (!window.desktopAPI?.getVersionInfo) return;
    info = await window.desktopAPI.getVersionInfo().catch(() => null);
    if (info?.source !== "private-beta") return;
    document.documentElement.dataset.privateBeta = "true";
    navItems.splice(0, navItems.length, ...navItems.filter(item => item.group || model.primary.has(item.id)));
    const previousRender = render;
    render = function(...args) {
      const source = Boolean(window.ViralCoreProjectPersistence?.snapshot()?.source?.path) && state.jobs?.some(job => job.sourcePath && !job.isRenderOutput);
      state.page = model.route(state.page, { source, contextualImport });
      if (state.page !== "download") contextualImport = false;
      const result = previousRender(...args); identify(); settings();
      if (notice && !notice.hidden) showNotice();
      return result;
    };
    document.addEventListener("click", async event => {
      const target = event.target.closest?.("[data-beta-update]");
      if (!target) return;
      const action = target.dataset.betaUpdate;
      if (action === "later") { if (notice) notice.hidden = true; return; }
      if (action === "view") { if (notice) notice.hidden = true; state.page = "settings"; render(); document.getElementById("betaUpdates")?.scrollIntoView({ block: "center" }); return; }
      const methods = { check: "checkAppUpdate", download: "downloadAppUpdate", cancel: "cancelAppUpdate", install: "installAppUpdate" };
      target.disabled = true;
      try { accept(await window.desktopAPI[methods[action]]()); }
      catch { accept({ ...update, errorCode: "UPDATE_REQUEST_FAILED" }); }
      finally { if (target.isConnected) target.disabled = false; }
    });
    document.addEventListener("change", async event => {
      if (!event.target.matches?.("[data-beta-automatic]")) return;
      accept(await window.desktopAPI.setAppUpdateAutomatic(event.target.checked));
    });
    document.addEventListener("click", event => {
      if (event.target.closest?.('#quickProject, [data-start-route="download"], [data-ai-route="download"]')) contextualImport = true;
    }, true);
    window.desktopAPI.onAppUpdateState?.(accept);
    accept(await window.desktopAPI.getAppUpdateState().catch(() => null));
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { start().catch(() => {}); }, { once: true });
  else start().catch(() => {});
})();
