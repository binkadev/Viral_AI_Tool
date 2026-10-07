(function installCoreCommandPalette() {
  "use strict";

  const root = document.documentElement;
  let overlay = null;
  let input = null;
  let list = null;
  let activeIndex = 0;

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function copy() {
    return locale() === "en"
      ? { placeholder: "Search commands…", empty: "No matching command", hint: "Navigate quickly", trigger: "Search commands" }
      : { placeholder: "Tìm chức năng…", empty: "Không tìm thấy chức năng phù hợp", hint: "Đi nhanh đến chức năng", trigger: "Tìm chức năng" };
  }

  function syncTriggerText() {
    const trigger = document.querySelector(".command-palette");
    const label = trigger?.querySelector(".command-copy");
    if (label) label.textContent = copy().trigger;
  }

  function commands() {
    return Array.from(document.querySelectorAll("#nav .nav-item[data-page]"))
      .filter(node => !node.hidden && node.getAttribute("aria-hidden") !== "true")
      .map(node => ({
        page: String(node.dataset.page || ""),
        label: String(node.textContent || "").trim(),
        icon: String(node.querySelector(".nav-icon")?.textContent || "").trim(),
        node
      }))
      .filter(item => item.page && item.label);
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "core-command-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="core-command-dialog" role="dialog" aria-modal="true" aria-label="Quick command palette">' +
        '<div class="core-command-input-wrap">' +
          '<span class="core-command-search" aria-hidden="true">⌕</span>' +
          '<input class="core-command-input" autocomplete="off" spellcheck="false" />' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<div class="core-command-meta"><span class="core-command-hint"></span><span>↑ ↓ · Enter</span></div>' +
        '<div class="core-command-list" role="listbox"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector(".core-command-input");
    list = overlay.querySelector(".core-command-list");

    overlay.addEventListener("pointerdown", event => {
      if (event.target === overlay) close();
    });
    input?.addEventListener("input", () => {
      activeIndex = 0;
      renderList();
    });
    input?.addEventListener("keydown", onInputKeyDown);
    list?.addEventListener("click", event => {
      const button = event.target.closest("[data-command-page]");
      if (!(button instanceof HTMLButtonElement)) return;
      run(String(button.dataset.commandPage || ""));
    });
  }

  function filteredCommands() {
    const query = String(input?.value || "").trim().toLocaleLowerCase();
    const all = commands();
    if (!query) return all;
    return all.filter(item => item.label.toLocaleLowerCase().includes(query));
  }

  function renderList() {
    if (!list) return;
    const c = copy();
    const items = filteredCommands();
    activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, items.length - 1)));
    if (!items.length) {
      list.innerHTML = '<div class="core-command-empty">' + c.empty + '</div>';
      return;
    }
    list.innerHTML = items.map((item, index) =>
      '<button type="button" class="core-command-item ' + (index === activeIndex ? "is-active" : "") + '" data-command-page="' + item.page + '" role="option" aria-selected="' + (index === activeIndex ? "true" : "false") + '">' +
        '<span class="core-command-item-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<span class="core-command-item-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="core-command-item-enter">↵</span>' +
      '</button>'
    ).join("");
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function open() {
    ensureOverlay();
    if (!overlay || !input) return;
    syncTriggerText();
    const c = copy();
    input.placeholder = c.placeholder;
    const hint = overlay.querySelector(".core-command-hint");
    if (hint) hint.textContent = c.hint;
    input.value = "";
    activeIndex = 0;
    renderList();
    overlay.hidden = false;
    root.classList.add("core-command-open");
    requestAnimationFrame(() => input.focus());
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    root.classList.remove("core-command-open");
    document.querySelector(".command-palette")?.focus();
  }

  function run(page) {
    const target = document.querySelector('#nav .nav-item[data-page="' + CSS.escape(page) + '"]');
    close();
    if (target instanceof HTMLButtonElement) target.click();
  }

  function onInputKeyDown(event) {
    const items = filteredCommands();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      renderList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      renderList();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      run(items[activeIndex]?.page || "");
    }
  }

  function onGlobalKeyDown(event) {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && String(event.key).toLowerCase() === "k") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape" && overlay && !overlay.hidden) {
      event.preventDefault();
      close();
    }
  }

  function start() {
    const trigger = document.querySelector(".command-palette");
    if (trigger instanceof HTMLButtonElement) {
      trigger.disabled = false;
      trigger.removeAttribute("aria-disabled");
      trigger.removeAttribute("data-core-disabled-reason");
      trigger.classList.remove("core-coming-soon-control");
      trigger.dataset.coreCapability = "functional";
      trigger.addEventListener("click", open);
    }
    syncTriggerText();
    document.addEventListener("keydown", onGlobalKeyDown);
    window.addEventListener("viral-ai:core-state-changed", syncTriggerText);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
