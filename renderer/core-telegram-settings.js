(function installTelegramSettings() {
  "use strict";
  if (!window.desktopAPI?.getTelegramStatus) return;
  let status = null, busy = null, feedback = null, queued = false;
  const t = (key, vars) => window.I18N.t(state.locale === "en" ? "en" : "vi", "telegramNotifications." + key, vars);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
  const errorKey = code => ({SECURE_STORAGE_UNAVAILABLE:"secureUnavailable", TELEGRAM_AUTH_FAILED:"authFailed", TELEGRAM_CHAT_NOT_FOUND:"chatNotFound", TELEGRAM_NETWORK:"networkError", TELEGRAM_TIMEOUT:"timeout", TELEGRAM_RATE_LIMITED:"rateLimited", TELEGRAM_CONFIG_PROTECTED:"protected", TELEGRAM_JOURNAL_PROTECTED:"protected", TELEGRAM_JOURNAL_WRITE_FAILED:"protected", TELEGRAM_CONFIG_WRITE_FAILED:"protected", TELEGRAM_INVALID_REQUEST:"invalid", TELEGRAM_BUSY:"busy"}[code] || "sendFailed");
  function html() {
    return '<section class="card card-pad telegram-settings" data-telegram-settings><h3>' + esc(t("title")) + '</h3><p>' + esc(t("description")) + '</p><div class="telegram-fields">' +
      '<label for="telegramBotToken">' + esc(t("botToken")) + '<input id="telegramBotToken" type="password" autocomplete="new-password" spellcheck="false" maxlength="256"></label>' +
      '<label for="telegramChatId">' + esc(t("chatId")) + '<input id="telegramChatId" type="text" inputmode="text" autocomplete="off" maxlength="21"></label></div>' +
      '<label class="telegram-enabled"><input type="checkbox" data-telegram-enabled><span>' + esc(t("enabled")) + '</span></label><p data-telegram-status role="status" aria-live="polite"></p>' +
      '<div class="telegram-actions">' + ["save", "sendTest", "disconnect"].map(action => '<button type="button" class="button ghost" data-core-capability="functional" data-telegram-action="' + action + '">' + esc(t(action)) + '</button>').join("") + '</div><div class="telegram-help">' +
      ["helpBotFather", "helpStartBot", "helpChatId"].map(key => '<p>' + esc(t(key)) + '</p>').join("") + '</div></section>';
  }
  function refresh() {
    queued = false; if (state.page !== "settings") return;
    const host = document.getElementById("page"); let panel = host.querySelector("[data-telegram-settings]");
    if (!panel) {host.insertAdjacentHTML("beforeend", html()); panel = host.querySelector("[data-telegram-settings]");}
    if (panel.dataset.locale !== state.locale) {panel.innerHTML = html().replace(/^<section[^>]*>|<\/section>$/g, ""); panel.dataset.locale = state.locale;}
    const message = feedback || (status?.code ? errorKey(status.code) : status?.configured ? "configured" : "notConfigured");
    const text = t(busy === "save" ? "saving" : busy === "sendTest" ? "testing" : message) + (status?.chatIdMasked ? " · " + t("savedChat", {chat:status.chatIdMasked}) : "");
    const node = panel.querySelector("[data-telegram-status]"); if (node.textContent !== text) node.textContent = text;
    const enabled = panel.querySelector("[data-telegram-enabled]"); if (busy !== "enabled") enabled.checked = !!status?.enabled; enabled.disabled = !!busy || !status?.configured || !!status?.code;
    panel.querySelector('[data-telegram-action="save"]').disabled = !!busy || !status?.secureStorageAvailable || !!status?.code;
    panel.querySelector('[data-telegram-action="sendTest"]').disabled = !!busy || !status?.configured || !status?.secureStorageAvailable;
    panel.querySelector('[data-telegram-action="disconnect"]').disabled = !!busy || !status?.configured && !status?.code;
    for (const input of panel.querySelectorAll(".telegram-fields input")) input.disabled = !!busy;
  }
  function queue() {if (queued || state.page !== "settings") return; queued = true; requestAnimationFrame(refresh);}
  async function load() {try {const r = await window.desktopAPI.getTelegramStatus(); if (r?.ok) status = r.data; else feedback = errorKey(r?.code);} catch {feedback = "sendFailed";} queue();}
  async function action(kind, payload) {
    if (busy) return; busy = kind; feedback = null; queue();
    try {
      const response = await (kind === "save" || kind === "enabled" ? window.desktopAPI.saveTelegramConfig(payload) : kind === "sendTest" ? window.desktopAPI.testTelegramNotification() : window.desktopAPI.clearTelegramConfig());
      if (response?.ok) {
        if (kind === "save") {const input = document.getElementById("telegramBotToken"); if (input) input.value = ""; const chat = document.getElementById("telegramChatId"); if (chat) chat.value = "";}
        if (response.data) status = response.data;
        feedback = kind === "save" ? "connected" : kind === "sendTest" ? "testSucceeded" : kind === "disconnect" ? "disconnected" : null;
      } else feedback = errorKey(response?.code);
    } catch {feedback = "sendFailed";} finally {payload = null; busy = null; queue();}
  }
  function install() {
    document.addEventListener("click", event => {
      const button = event.target.closest?.("[data-telegram-action]"); if (state.page !== "settings" || !button || button.disabled) return;
      const kind = button.dataset.telegramAction;
      if (kind === "save") action(kind, {botToken:document.getElementById("telegramBotToken").value, chatId:document.getElementById("telegramChatId").value.trim(), enabled:true});
      else action(kind);
    });
    document.addEventListener("change", event => {if (state.page === "settings" && event.target.matches?.("[data-telegram-enabled]") && !event.target.disabled) action("enabled", {enabled:event.target.checked});});
    new MutationObserver(queue).observe(document.getElementById("page"), {childList:true, subtree:true});
    load(); queue();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, {once:true}); else install();
})();
