"use strict";
const {token, chat, bot} = require("./config-store"), {failure} = require("./storage");
function createTelegramClient({fetchImpl = globalThis.fetch, timeoutMs = 9000} = {}) {
  const controllers = new Set();
  async function request(botToken, method, body) {
    token(botToken); const controller = new AbortController(); controllers.add(controller); let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, Math.max(8000, Math.min(10000, timeoutMs)));
    try {
      const response = await fetchImpl("https://api.telegram.org/bot" + botToken + "/" + method,
        {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:controller.signal, redirect:"error"});
      const value = await response.json();
      if (!response.ok || value?.ok !== true) {
        const status = value?.error_code || response.status;
        const code = status === 401 || status === 404 && method === "getMe" ? "TELEGRAM_AUTH_FAILED" : status === 429 ? "TELEGRAM_RATE_LIMITED" :
          status === 400 && /chat not found/i.test(String(value?.description)) ? "TELEGRAM_CHAT_NOT_FOUND" : status >= 400 && status < 500 ? "TELEGRAM_REQUEST_REJECTED" : "TELEGRAM_SEND_FAILED";
        return {ok:false, code, uncertain:status >= 500};
      }
      return {ok:true, ...(method === "getMe" ? {bot:bot(value.result)} : {})};
    } catch (e) {return {ok:false, code:timedOut ? "TELEGRAM_TIMEOUT" : e.code === "TELEGRAM_AUTH_FAILED" ? e.code : "TELEGRAM_NETWORK", uncertain:true};}
    finally {clearTimeout(timer); controllers.delete(controller);}
  }
  return {verify:botToken => request(token(botToken), "getMe", {}),
    send(botToken, chatId, text) {
      if (typeof text !== "string" || !text || text.length > 3000) throw failure("TELEGRAM_INVALID_REQUEST");
      return request(token(botToken), "sendMessage", {chat_id:chat(chatId), text, link_preview_options:{is_disabled:true}});
    }, abortAll() {for (const controller of controllers) controller.abort();}};
}
module.exports = {createTelegramClient};
