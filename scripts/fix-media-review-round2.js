"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, value) => fs.writeFileSync(path.join(root, file), value, "utf8");

function replaceOnce(content, needle, replacement, label) {
  const index = content.indexOf(needle);
  if (index < 0) throw new Error(`Missing anchor: ${label}`);
  if (content.indexOf(needle, index + needle.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + needle.length);
}

function patchResponsiveAssets() {
  const file = "renderer/core-editor-assets.css";
  let content = read(file);
  content = replaceOnce(
    content,
    '@media(max-width:1320px){.core-editor-assets-panel{display:none!important}.core-editor-assets-page .core-editor-focus-section .editor-grid.core-editor-assets-grid{grid-template-columns:minmax(0,1fr) 360px!important}}\n@media(max-width:1120px){.core-editor-assets-page .core-editor-focus-section .editor-grid.core-editor-assets-grid{grid-template-columns:minmax(0,1fr)!important}}',
    '@media(max-width:1320px){.core-editor-assets-page .core-editor-focus-section .editor-grid.core-editor-assets-grid{grid-template-columns:54px minmax(0,1fr) 340px!important}.core-editor-assets-panel{display:flex!important;width:54px}.core-editor-assets-panel .core-assets-head strong,.core-editor-assets-panel .core-assets-section-label,.core-editor-assets-panel .core-asset-copy{display:none}.core-editor-assets-panel .core-assets-head{justify-content:center;padding-inline:6px}.core-editor-assets-panel .core-assets-body{padding:7px}.core-editor-assets-panel .core-asset-item{grid-template-columns:1fr;padding:7px;place-items:center}.core-editor-assets-panel .core-asset-stat.is-upcoming{display:none}}\n@media(max-width:1120px){.core-editor-assets-page .core-editor-focus-section .editor-grid.core-editor-assets-grid{grid-template-columns:54px minmax(0,1fr) 320px!important}.core-editor-assets-panel{display:flex!important}}',
    "responsive assets rail"
  );
  write(file, content);

  const premiumFile = "renderer/core-editor-panels-workstation.css";
  let premium = read(premiumFile);
  premium = replaceOnce(
    premium,
    '@media(max-width:1120px){html.core-editor-premium .core-editor-assets-panel{display:none!important}}',
    '@media(max-width:1120px){\n  html.core-editor-premium .core-editor-assets-page .core-editor-focus-section .editor-grid.core-editor-assets-grid{grid-template-columns:52px minmax(0,1fr) 320px!important}\n  html.core-editor-premium .core-editor-assets-panel{display:flex!important;width:52px!important}\n}',
    "premium responsive assets rail"
  );
  write(premiumFile, premium);
}

function patchDesktopCancellation() {
  const file = "services/media/desktop-ipc.js";
  let content = read(file);
  content = replaceOnce(
    content,
    '  async function status() {\n',
    '  let activeSearchController = null;\n\n  function cancelSearch() {\n    if (!activeSearchController) return { ok: true, cancelled: false };\n    activeSearchController.abort();\n    activeSearchController = null;\n    return { ok: true, cancelled: true };\n  }\n\n  async function status() {\n',
    "desktop active search controller"
  );
  content = replaceOnce(
    content,
    '    try {\n      const client = await refreshedClient();\n      const data = await client.search(input);\n      return { ok: true, ...data };\n    } catch (error) {\n      return { ok: false, error: publicMediaClientError(error) };\n    }\n  }\n\n  return { status, search };',
    '    cancelSearch();\n    const controller = new AbortController();\n    activeSearchController = controller;\n    try {\n      const client = await refreshedClient();\n      const data = await client.search({ ...input, signal: controller.signal });\n      return { ok: true, ...data };\n    } catch (error) {\n      return { ok: false, error: publicMediaClientError(error) };\n    } finally {\n      if (activeSearchController === controller) activeSearchController = null;\n    }\n  }\n\n  return { status, search, cancelSearch };',
    "desktop search cancellation"
  );
  content = replaceOnce(
    content,
    '  ipcMain.handle("media:search", (_event, payload) => service.search(payload));\n  return service;',
    '  ipcMain.handle("media:search", (_event, payload) => service.search(payload));\n  ipcMain.handle("media:search-cancel", () => service.cancelSearch());\n  return service;',
    "desktop cancel IPC"
  );
  write(file, content);

  const preloadFile = "preload.js";
  let preload = read(preloadFile);
  preload = replaceOnce(
    preload,
    "  searchMedia: payload => ipcRenderer.invoke('media:search', payload),",
    "  searchMedia: payload => ipcRenderer.invoke('media:search', payload),\n  cancelMediaSearch: () => ipcRenderer.invoke('media:search-cancel'),",
    "preload cancel search"
  );
  write(preloadFile, preload);
}

function patchBackendCancellation() {
  const file = "dev-backend/media-routes.js";
  let content = read(file);
  content = replaceOnce(
    content,
    '    try {\n      const payload = await mediaSearchService.search({\n        query: url.searchParams.get("query") || "",\n        kind: url.searchParams.get("kind") || "video",\n        orientation: url.searchParams.get("orientation") || "any",\n        page: url.searchParams.get("page") || 1,\n        perPage: url.searchParams.get("perPage") || 18,\n        provider: url.searchParams.get("provider") || "auto"\n      });\n      json(res, 200, payload);\n      return true;\n    } catch (searchError) {\n      const publicValue = typeof mediaSearchService.publicError === "function"\n        ? mediaSearchService.publicError(searchError)\n        : { code: searchError?.code || "MEDIA_SEARCH_UNAVAILABLE", details: {} };\n      const mapped = mediaRouteError(publicValue);\n      error(res, mapped.status, mapped.code, publicValue.details || {});\n      return true;\n    }',
    '    const controller = new AbortController();\n    const abortSearch = () => controller.abort();\n    const abortOnResponseClose = () => { if (!res.writableEnded) abortSearch(); };\n    req.once?.("aborted", abortSearch);\n    res.once?.("close", abortOnResponseClose);\n    try {\n      const payload = await mediaSearchService.search({\n        query: url.searchParams.get("query") || "",\n        kind: url.searchParams.get("kind") || "video",\n        orientation: url.searchParams.get("orientation") || "any",\n        page: url.searchParams.get("page") || 1,\n        perPage: url.searchParams.get("perPage") || 18,\n        provider: url.searchParams.get("provider") || "auto"\n      }, { signal: controller.signal });\n      if (!controller.signal.aborted && !res.writableEnded) json(res, 200, payload);\n      return true;\n    } catch (searchError) {\n      if (controller.signal.aborted || res.writableEnded) return true;\n      const publicValue = typeof mediaSearchService.publicError === "function"\n        ? mediaSearchService.publicError(searchError)\n        : { code: searchError?.code || "MEDIA_SEARCH_UNAVAILABLE", details: {} };\n      const mapped = mediaRouteError(publicValue);\n      error(res, mapped.status, mapped.code, publicValue.details || {});\n      return true;\n    } finally {\n      req.removeListener?.("aborted", abortSearch);\n      res.removeListener?.("close", abortOnResponseClose);\n    }',
    "backend request cancellation"
  );
  write(file, content);
}

function patchDiscovery() {
  const file = "renderer/core-media-discovery.js";
  let content = read(file);
  content = replaceOnce(
    content,
    '  async function runSearch() {\n',
    '  function cancelActiveSearch() {\n    if (typeof window.desktopAPI?.cancelMediaSearch === "function") {\n      Promise.resolve(window.desktopAPI.cancelMediaSearch()).catch(() => {});\n    }\n  }\n\n  async function runSearch() {\n',
    "renderer cancel helper"
  );
  content = replaceOnce(
    content,
    '    const query = queryEl instanceof HTMLInputElement ? queryEl.value.trim() : "";\n    const requestId = ++activeRequest;\n',
    '    const query = queryEl instanceof HTMLInputElement ? queryEl.value.trim() : "";\n    cancelActiveSearch();\n    const requestId = ++activeRequest;\n',
    "cancel superseded search"
  );
  content = replaceOnce(
    content,
    '        if (code === "MEDIA_AUTH_REQUIRED" || code === "AUTH_REQUIRED") {\n          renderState("auth", "signInTitle", "signInBody");\n        } else {\n          renderState("error", "failedTitle", "failedBody");\n        }',
    '        if (code === "MEDIA_CANCELLED") {\n          return;\n        } else if (code === "MEDIA_AUTH_REQUIRED" || code === "AUTH_REQUIRED") {\n          renderState("auth", "signInTitle", "signInBody");\n        } else if (["MEDIA_PROVIDER_UNAVAILABLE", "MEDIA_NOT_CONFIGURED", "MEDIA_CONFIG_INVALID", "MEDIA_HTTPS_REQUIRED"].includes(code)) {\n          renderState("unavailable", "providerUnavailableTitle", "providerUnavailableBody");\n        } else if (code === "MEDIA_QUOTA_EXCEEDED") {\n          renderState("quota", "quotaTitle", "quotaBody");\n        } else {\n          renderState("error", "failedTitle", "failedBody");\n        }',
    "public media error mapping"
  );
  content = replaceOnce(
    content,
    '    activeRequest += 1;\n    currentView = "closed";',
    '    activeRequest += 1;\n    cancelActiveSearch();\n    currentView = "closed";',
    "cancel search on close"
  );
  write(file, content);
}

function patchI18n() {
  const file = "renderer/i18n.js";
  let content = read(file);
  content = replaceOnce(
    content,
    'failedTitle: "Chưa thể tìm tư liệu", failedBody: "Kết nối tìm kiếm đang gặp sự cố. Thử lại sau ít phút.", libraryFullTitle:',
    'failedTitle: "Chưa thể tìm tư liệu", failedBody: "Kết nối tìm kiếm đang gặp sự cố. Thử lại sau ít phút.", providerUnavailableTitle: "Nguồn tư liệu chưa sẵn sàng", providerUnavailableBody: "Tìm kiếm trực tuyến chưa được cấu hình. Bạn vẫn có thể dùng tư liệu cục bộ và tiếp tục chỉnh sửa.", quotaTitle: "Đã đạt giới hạn tìm kiếm", quotaBody: "Hạn mức tìm kiếm hiện tại đã được sử dụng hết. Kiểm tra gói và hạn mức của tài khoản, hoặc thử lại sau khi hạn mức được làm mới.", libraryFullTitle:',
    "VI media recovery copy"
  );
  content = replaceOnce(
    content,
    'failedTitle: "Media search could not finish", failedBody: "The search connection is having trouble. Try again in a moment.", libraryFullTitle:',
    'failedTitle: "Media search could not finish", failedBody: "The search connection is having trouble. Try again in a moment.", providerUnavailableTitle: "Media sources are not ready", providerUnavailableBody: "Online media search is not configured yet. You can keep using local media and continue editing this project.", quotaTitle: "Search allowance reached", quotaBody: "The current media search allowance has been used. Check your account plan and usage, or try again after the allowance refreshes.", libraryFullTitle:',
    "EN media recovery copy"
  );
  write(file, content);
}

function patchTests() {
  let workbench = read("tests/core-media-workbench.test.js");
  workbench = replaceOnce(
    workbench,
    'assert(discovery.includes(\'typeof window.desktopAPI?.searchMedia !== "function"\'), "missing bridge must produce an unavailable state rather than fake results");',
    'assert(discovery.includes(\'typeof window.desktopAPI?.searchMedia !== "function"\'), "missing bridge must produce an unavailable state rather than fake results");\nassert(discovery.includes("cancelActiveSearch();"), "superseded and closed searches must cancel the active desktop request");\nassert(discovery.includes(\'renderState("unavailable", "providerUnavailableTitle", "providerUnavailableBody")\'), "provider configuration failures need a specific recovery state");\nassert(discovery.includes(\'renderState("quota", "quotaTitle", "quotaBody")\'), "quota failures need a specific recovery state");',
    "workbench cancellation/error assertions"
  );
  workbench = replaceOnce(
    workbench,
    'for (const key of ["discoveryTitle", "searchPlaceholder", "unavailableTitle", "signInTitle", "failedTitle", "libraryFullTitle", "libraryFullBody", "addProject"]) {',
    'for (const key of ["discoveryTitle", "searchPlaceholder", "unavailableTitle", "signInTitle", "failedTitle", "providerUnavailableTitle", "providerUnavailableBody", "quotaTitle", "quotaBody", "libraryFullTitle", "libraryFullBody", "addProject"]) {',
    "workbench i18n recovery assertions"
  );
  workbench = replaceOnce(
    workbench,
    'assert(assetCss.includes("core-asset-stat.has-items"), "real project media counts must have a visible populated state");',
    'assert(assetCss.includes("core-asset-stat.has-items"), "real project media counts must have a visible populated state");\nassert(!assetCss.includes("@media(max-width:1320px){.core-editor-assets-panel{display:none!important}"), "responsive layout must not remove the only Find media entry");\nassert(assetCss.includes("grid-template-columns:54px minmax(0,1fr) 340px"), "responsive layout must retain a compact media rail below 1320px");',
    "responsive workbench assertions"
  );
  write("tests/core-media-workbench.test.js", workbench);

  let desktop = read("tests/media-desktop-ipc.test.js");
  desktop = replaceOnce(
    desktop,
    '  assert(handlers.has("media:search"));\n  assert.strictEqual(handlers.size, 2, "media IPC surface should stay narrow");',
    '  assert(handlers.has("media:search"));\n  assert(handlers.has("media:search-cancel"));\n  assert.strictEqual(handlers.size, 3, "media IPC surface should stay narrow");',
    "desktop cancel IPC test"
  );
  desktop = replaceOnce(
    desktop,
    '  assert(preload.includes("searchMedia: payload => ipcRenderer.invoke(\'media:search\', payload)"));',
    '  assert(preload.includes("searchMedia: payload => ipcRenderer.invoke(\'media:search\', payload)"));\n  assert(preload.includes("cancelMediaSearch: () => ipcRenderer.invoke(\'media:search-cancel\')"));',
    "preload cancel method test"
  );
  write("tests/media-desktop-ipc.test.js", desktop);

  let wiring = read("tests/media-workbench-wiring.test.js");
  wiring = replaceOnce(
    wiring,
    'assert(preload.includes("searchMedia: payload => ipcRenderer.invoke(\'media:search\', payload)"), "preload must expose only the narrow media search method");',
    'assert(preload.includes("searchMedia: payload => ipcRenderer.invoke(\'media:search\', payload)"), "preload must expose only the narrow media search method");\nassert(preload.includes("cancelMediaSearch: () => ipcRenderer.invoke(\'media:search-cancel\')"), "preload must expose narrow media search cancellation");\nassert(server.includes("new AbortController()"), "backend media route must propagate client disconnect cancellation");',
    "wiring cancellation assertions"
  );
  write("tests/media-workbench-wiring.test.js", wiring);

  let routes = read("tests/media-routes.test.js");
  routes = routes.replace(
    'const req = { headers: { authorization: "Bearer token" } };',
    'const req = { headers: { authorization: "Bearer token" }, once() {}, removeListener() {} };'
  );
  write("tests/media-routes.test.js", routes);
}

patchResponsiveAssets();
patchDesktopCancellation();
patchBackendCancellation();
patchDiscovery();
patchI18n();
patchTests();
console.log("Final media review fixes applied.");
