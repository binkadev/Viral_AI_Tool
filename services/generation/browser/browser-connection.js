"use strict";

// A health connection may issue only Browser.getVersion. No page or credential APIs.
function connectBrowser({port, browserPath}, {WebSocketImpl = globalThis.WebSocket, signal, timeoutMs = 2000} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath)) return Promise.reject(new Error("BROWSER_CONNECTION_FAILED"));
  return new Promise((resolve, reject) => {
    let socket, timer, settled = false;
    const close = () => { try {socket?.close();} catch {} };
    const cleanup = () => {clearTimeout(timer);signal?.removeEventListener("abort", abort);};
    const fail = () => {
      if (settled) return;
      settled = true; cleanup(); close();
      reject(new Error("BROWSER_CONNECTION_FAILED"));
    };
    const abort = () => {if (settled) close(); else fail();};
    if (signal?.aborted) {fail();return;}
    try { socket = new WebSocketImpl("ws://127.0.0.1:" + port + browserPath); }
    catch {fail();return;}
    signal?.addEventListener("abort", abort, {once:true});
    timer = setTimeout(fail, timeoutMs);
    socket.addEventListener("error", fail);
    socket.addEventListener("close", fail);
    socket.addEventListener("open", () => {
      if (!settled) socket.send(JSON.stringify({id:1, method:"Browser.getVersion"}));
    });
    socket.addEventListener("message", event => {
      if (settled) return;
      let message;
      try { message = JSON.parse(String(event.data)); } catch {fail();return;}
      if (message.id !== 1) return;
      if (typeof message.result?.product !== "string" || !/^(Chrome|HeadlessChrome)\//.test(message.result.product)) {fail();return;}
      settled = true; cleanup();
      resolve({alive:()=>socket.readyState===1, close});
    });
  });
}
module.exports = {connectBrowser};
