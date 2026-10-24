(function installCoreProductionSettings() {
  "use strict";

  const sections = ["general", "ai", "integrations", "storage", "appearance", "advanced"];
  let active = "general";
  const opened = new Set();
  const w = key => window.I18N.t(state.locale === "en" ? "en" : "vi", "settingsWorkspace." + key);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  const heading = key => '<header class="swp-section-heading"><h2>' + esc(w(key)) + '</h2><p>' + esc(w(key + "Hint")) + '</p></header>';
  const detail = (key, title, content) => '<details class="swp-disclosure" data-swp-details="' + key + '"' + (opened.has(key) ? ' open' : '') + '><summary>' + esc(title) + '<span aria-hidden="true">&#8964;</span></summary>' + content + '</details>';
  function workspace(html) {
    const template = document.createElement("template"); template.innerHTML = html;
    const source = template.content, take = selector => source.querySelector(selector)?.outerHTML || "";
    const row = id => source.querySelector("#" + id)?.closest(".settings-select-row")?.outerHTML || "";
    const locale = row("settingsLocale"), appearance = ["appearanceSelect", "motionSelect", "scaleSelect"].map(row).join("");
    const output = source.querySelector("#outputPath")?.closest(".card")?.outerHTML || "";
    const group = (key, content) => '<section class="swp-section" data-swp-panel="' + key + '"' + (active !== key ? ' hidden' : '') + '>' + heading(key) + content + '</section>';
    return '<div class="settings-workspace" data-settings-workspace data-settings-active="' + active + '"><header class="swp-heading"><span class="swp-eyebrow">' + esc(w("eyebrow")) + '</span><h1>' + esc(w("title")) + '</h1><p>' + esc(w("description")) + '</p></header><div class="swp-layout"><nav class="swp-nav" aria-label="' + esc(w("navigation")) + '">' +
      sections.map(key => '<button type="button" data-swp-section="' + key + '" aria-controls="swp-content"' + (active === key ? ' aria-current="page"' : '') + '><span>' + esc(w(key)) + '</span><span aria-hidden="true">&#8250;</span></button>').join("") + '</nav><div class="swp-content" id="swp-content">' +
      group("general", '<section class="swp-surface"><p class="swp-save-hint">' + esc(w("immediate")) + '</p>' + locale + '</section>' + detail("account", w("account"), '<p class="swp-note">' + esc(w("accountHint")) + '</p>' + take(".account-settings-card"))) +
      group("appearance", '<section class="swp-surface"><p class="swp-save-hint">' + esc(w("immediate")) + '</p>' + appearance + '</section>') +
      group("storage", '<p class="swp-note">' + esc(w("storageScope")) + '</p>' + output) +
      group("integrations", '<p class="swp-note">' + esc(w("optional")) + '</p><div data-swp-telegram-host></div>') +
      group("ai", '<p class="swp-note">' + esc(w("generationScope")) + '</p>') + group("advanced", '') +
      take("#video-provider-settings") + '<div data-swp-panel="advanced"' + (active !== "advanced" ? ' hidden' : '') + '>' +
      (take("#developerCloudSettings") ? detail("cloud", w("cloud"), '<p class="swp-note">' + esc(w("explicitCloud")) + '</p>' + take("#developerCloudSettings")) : '') +
      detail("release", w("release"), take(".release-info-card")) + detail("support", w("support"), take(".diagnostics-card")) + '</div></div></div></div>';
  }
  function synchronize() {
    const root = document.querySelector("[data-settings-workspace]"); if (!root || state.page !== "settings") return;
    const provider = root.querySelector("#video-provider-settings");
    // Move the owner's existing nodes, never clone controls or replace its state.
    // The owner can repaint; this presentation pass then regroups its new nodes.
    if (provider && !provider.querySelector("[data-swp-provider-main]")) {
      const main = document.createElement("div"), technical = document.createElement("div"), connection = document.createElement("div");
      const ready = provider.querySelector('[data-provider-state="ready"]'), copy = window.I18N.messages[state.locale === "en" ? "en" : "vi"].videoProviders;
      main.dataset.swpProviderMain = ""; main.dataset.swpPanel = "ai";
      technical.dataset.swpPanel = "advanced"; technical.className = "swp-provider-technical";
      for (const node of [...provider.children]) {
        if (node.matches("[data-video-provider-support]")) technical.append(node);
        else if (node.matches("[data-muse-runtime-diagnostic]")) {
          const shell = document.createElement("div"); shell.innerHTML = detail("muse", w("museDiagnostics"), ""); shell.firstElementChild.append(node); technical.prepend(shell.firstElementChild);
        } else if (ready && node.matches("[data-extension-connected], [data-muse-session-state]")) connection.append(node);
        else if (node.tagName === "P" && node.textContent === copy.storeUnavailable) {
          connection.append(node);
          if (provider.querySelector("[data-video-provider-store]")) {const hint = document.createElement("p"); hint.dataset.swpStoreHint = ""; hint.textContent = w("storeHint"); main.append(hint);}
        } else main.append(node);
      }
      if (connection.children.length) {const shell = document.createElement("div"); shell.innerHTML = detail("connection", w("connectionDetails"), ""); shell.firstElementChild.append(connection); technical.append(shell.firstElementChild);}
      provider.append(main, technical);
    }
    const telegram = document.querySelector("[data-telegram-settings]"), destination = root.querySelector("[data-swp-telegram-host]");
    if (telegram && destination && telegram.parentElement !== destination) destination.append(telegram);
    root.dataset.settingsActive = active;
    for (const panel of root.querySelectorAll("[data-swp-panel]")) {
      const hide = panel.dataset.swpPanel !== active; if (panel.hidden !== hide) panel.hidden = hide;
    }
    for (const button of root.querySelectorAll("[data-swp-section]")) {
      if (button.dataset.swpSection === active) {if (!button.hasAttribute("aria-current")) button.setAttribute("aria-current", "page");}
      else if (button.hasAttribute("aria-current")) button.removeAttribute("aria-current");
    }
    for (const id of ["settingsLocale", "appearanceSelect", "motionSelect", "scaleSelect", "outputPath"]) {
      const control = root.querySelector("#" + id); if (!control || control.labels?.length) continue;
      const label = control.closest(".settings-select-row")?.querySelector(".setting-copy b") || control.closest(".card")?.querySelector(".label");
      if (label && control.getAttribute("aria-labelledby") !== "swp-label-" + id) {label.id = "swp-label-" + id; control.setAttribute("aria-labelledby", label.id);}
    }
    const saveTelegram = root.querySelector('[data-telegram-action="save"]'); if (saveTelegram && !saveTelegram.classList.contains("swp-primary")) saveTelegram.classList.add("swp-primary");
    const picker = root.querySelector("#chooseOutput"); if (picker && !picker.classList.contains("swp-primary")) picker.classList.add("swp-primary");
    const controls = provider?.querySelector(".video-provider-controls"), open = controls?.querySelector("[data-video-provider-open]"), store = controls?.querySelector("[data-video-provider-store]");
    const primary = open && !open.disabled ? open : store && !store.disabled ? store : controls?.querySelector("[data-video-provider-check]");
    for (const button of controls?.querySelectorAll("button") || []) if (button.classList.contains("swp-primary") !== (button === primary)) button.classList.toggle("swp-primary", button === primary);
    const help = provider?.querySelector(".video-provider-message, [data-muse-session-state]");
    if (help) {help.id = "swp-provider-help"; for (const button of controls?.querySelectorAll("button") || []) if (button.getAttribute("aria-describedby") !== help.id) button.setAttribute("aria-describedby", help.id);}
    const storeHint = provider?.querySelector("[data-swp-store-hint]"); if (storeHint && store?.disabled) {storeHint.id = "swp-store-help"; store.setAttribute("aria-describedby", storeHint.id);}
  }
  function choose(key) {
    if (!sections.includes(key)) return;
    active = key; synchronize();
    const page = document.getElementById("page"); if (page) page.scrollTop = 0;
  }

  function install() {
    try {
      if (typeof pages === "undefined" || !pages || typeof pages.settings !== "function") return false;
      if (pages.settings.__coreProductionSettings === true) return true;

      const legacy = pages.settings;
      const production = function coreProductionSettingsPage() {
        let html = String(legacy() || "");

        // Legacy switches are visual-only placeholders with no persisted state or handler.
        html = html.replace(/<div class="setting-row">[\s\S]*?<div class="switch [^"]*"><\/div><\/div>/g, "");

        // The legacy 1080p/4K selector is not connected to render configuration.
        html = html.replace(/<div style="margin-top:14px"><label class="label">[\s\S]*?<select class="select"><option>1080p<\/option><option>4K<\/option><\/select><\/div>/g, "");

        return workspace((window.ViralVideoProviderSettings?.html() || "") + html);
      };

      production.__coreProductionSettings = true;
      pages.settings = production;
      if (!document.querySelector('link[href="core-settings-workspace.css"]')) {
        const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "core-settings-workspace.css"; document.head.append(style);
      }
      document.addEventListener("click", event => {
        const button = event.target.closest?.("[data-swp-section]"); if (button) choose(button.dataset.swpSection);
      });
      document.addEventListener("keydown", event => {
        const button = event.target.closest?.("[data-swp-section]"); if (!button || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        const index = sections.indexOf(button.dataset.swpSection), next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + sections.length) % sections.length;
        event.preventDefault(); choose(sections[next]); document.querySelector('[data-swp-section="' + sections[next] + '"]')?.focus({preventScroll:true});
      });
      document.addEventListener("click", event => {
        if (event.target.closest?.("#openCloudSettings")) {active = "advanced"; opened.add("cloud");}
        if (event.target.closest?.('[data-beta-update="view"]')) {active = "advanced"; opened.add("release");}
      }, true);
      document.addEventListener("toggle", event => {
        const node = event.target; if (!node.isConnected || !node.matches?.("[data-swp-details]")) return;
        if (node.open) opened.add(node.dataset.swpDetails); else opened.delete(node.dataset.swpDetails);
      }, true);
      new MutationObserver(synchronize).observe(document.getElementById("page"), {childList:true, subtree:true});
      synchronize();
      if (state?.page === "settings" && typeof render === "function") render();
      document.documentElement.dataset.coreProductionSettings = "enabled";
      return true;
    } catch {
      return false;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
  else install();
})();
