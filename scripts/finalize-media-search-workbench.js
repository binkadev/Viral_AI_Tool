"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, "utf8");

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (content.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return content.slice(0, first) + replacement + content.slice(first + needle.length);
}

function insertAfterOnce(content, needle, insertion, label) {
  return replaceOnce(content, needle, needle + insertion, label);
}

function patchMain() {
  const file = "main.js";
  let content = read(file);
  if (!content.includes("require('./services/media/cloud-client')")) {
    content = insertAfterOnce(
      content,
      "const { BillingClient } = require('./services/billing/billing-client');\n",
      "const { CloudMediaClient } = require('./services/media/cloud-client');\n",
      "main media client import"
    );
  }

  if (!content.includes("function mediaClient()")) {
    const helper = `function mediaClient() {\n  const cloudConfig = cloudConfigStore?.read() || {\n    backendUrl: process.env.VIRAL_AI_CLOUD_URL || ''\n  };\n  return new CloudMediaClient({\n    backendUrl: cloudConfig.backendUrl || '',\n    getAccessToken: () => sessionStore?.getAccessToken() || null,\n    appVersion: app.getVersion()\n  });\n}\n\nfunction mediaSearchPayload(payload) {\n  const source = payload && typeof payload === 'object' ? payload : {};\n  const query = String(source.query || '').trim();\n  const kind = String(source.kind || 'video').trim().toLowerCase();\n  const orientation = String(source.orientation || 'any').trim().toLowerCase();\n  const provider = String(source.provider || 'auto').trim().toLowerCase();\n  const page = Number(source.page || 1);\n  const perPage = Number(source.perPage || 18);\n\n  if (query.length < 2 || query.length > 200) {\n    const error = new Error('Media search query is invalid.');\n    error.code = 'MEDIA_SEARCH_INVALID';\n    throw error;\n  }\n  if (!['video', 'image'].includes(kind) || !['any', 'portrait', 'landscape', 'square'].includes(orientation)) {\n    const error = new Error('Media search filters are invalid.');\n    error.code = 'MEDIA_SEARCH_INVALID';\n    throw error;\n  }\n  if (!['auto', 'pexels', 'pixabay'].includes(provider)) {\n    const error = new Error('Media provider selection is invalid.');\n    error.code = 'MEDIA_SEARCH_INVALID';\n    throw error;\n  }\n  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(perPage) || perPage < 1 || perPage > 50) {\n    const error = new Error('Media search paging is invalid.');\n    error.code = 'MEDIA_SEARCH_INVALID';\n    throw error;\n  }\n\n  return { query, kind, orientation, provider, page, perPage };\n}\n\nfunction publicMediaError(error) {\n  const aliases = {\n    AUTH_REQUIRED: 'MEDIA_AUTH_REQUIRED',\n    AUTH_EXPIRED: 'MEDIA_AUTH_REQUIRED',\n    MEDIA_NOT_CONFIGURED: 'MEDIA_SEARCH_UNAVAILABLE',\n    MEDIA_CONFIG_INVALID: 'MEDIA_SEARCH_UNAVAILABLE',\n    MEDIA_HTTPS_REQUIRED: 'MEDIA_SEARCH_UNAVAILABLE',\n    MEDIA_NETWORK: 'MEDIA_SEARCH_UNAVAILABLE',\n    MEDIA_REQUEST_FAILED: 'MEDIA_SEARCH_UNAVAILABLE'\n  };\n  const allowed = new Set([\n    'MEDIA_AUTH_REQUIRED',\n    'MEDIA_SEARCH_INVALID',\n    'MEDIA_PROVIDER_UNAVAILABLE',\n    'MEDIA_SEARCH_UNAVAILABLE',\n    'MEDIA_SEARCH_TIMEOUT',\n    'MEDIA_QUOTA_EXCEEDED',\n    'MEDIA_CANCELLED'\n  ]);\n  const raw = String(error?.code || 'MEDIA_SEARCH_UNAVAILABLE');\n  const code = aliases[raw] || (allowed.has(raw) ? raw : 'MEDIA_SEARCH_UNAVAILABLE');\n  return { code, details: {} };\n}\n\nasync function withMediaSession(action) {\n  const ready = await refreshSessionIfNeeded();\n  if (!ready || !sessionStore?.getAccessToken()) {\n    const error = new Error('Authentication is required.');\n    error.code = 'MEDIA_AUTH_REQUIRED';\n    throw error;\n  }\n  return action(mediaClient());\n}\n\n`;
    content = replaceOnce(content, "async function withBillingSession(action) {\n", helper + "async function withBillingSession(action) {\n", "main media helpers");
  }

  if (!content.includes("ipcMain.handle('media:status'")) {
    const handlers = `ipcMain.handle('media:status', async () => {\n  try {\n    const data = await withMediaSession(client => client.status());\n    return { ok: true, data };\n  } catch (error) {\n    diagnosticLogger?.info('media.status_failed', { code: error?.code || 'MEDIA_SEARCH_UNAVAILABLE' });\n    return { ok: false, error: publicMediaError(error) };\n  }\n});\n\nipcMain.handle('media:search', async (_event, payload) => {\n  try {\n    const safePayload = mediaSearchPayload(payload);\n    const data = await withMediaSession(client => client.search(safePayload));\n    return { ok: true, data };\n  } catch (error) {\n    diagnosticLogger?.info('media.search_failed', { code: error?.code || 'MEDIA_SEARCH_UNAVAILABLE' });\n    return { ok: false, error: publicMediaError(error) };\n  }\n});\n\n`;
    content = replaceOnce(content, "ipcMain.handle('files:select-videos', async () => {\n", handlers + "ipcMain.handle('files:select-videos', async () => {\n", "main media IPC handlers");
  }
  write(file, content);
}

function patchBackend() {
  const file = "dev-backend/server.js";
  let content = read(file);
  if (!content.includes('require("./media-search")')) {
    content = insertAfterOnce(
      content,
      'const billing = require("./billing");\n',
      'const { createMediaSearchService } = require("./media-search");\nconst { createMediaRouteHandler } = require("./media-routes");\n',
      "backend media imports"
    );
  }

  if (!content.includes("const handleMediaRoute = createMediaRouteHandler")) {
    const setup = `const mediaSearchService = createMediaSearchService();\nconst handleMediaRoute = createMediaRouteHandler({\n  mediaSearchService,\n  authenticate,\n  json,\n  error,\n  requestRateLimited: (req, scope) =>\n    requestRateLimited(req, scope, MAX_SENSITIVE_REQUESTS_PER_WINDOW, GENERAL_RATE_WINDOW_MS)\n});\n\n`;
    content = replaceOnce(content, "async function handle(req, res) {\n", setup + "async function handle(req, res) {\n", "backend media route setup");
  }

  if (!content.includes("if (await handleMediaRoute(req, res, url, method)) return;")) {
    const gate = `  if (requestRateLimited(req, "general")) {\n    audit("rate_limit.general", req, { method, path: url.pathname });\n    return error(res, 429, "RATE_LIMITED");\n  }\n`;
    content = replaceOnce(
      content,
      gate,
      gate + "\n  if (await handleMediaRoute(req, res, url, method)) return;\n",
      "backend media route dispatch"
    );
  }
  write(file, content);
}

const viMedia = `      mediaWorkbench: {\n        assets: "Tài nguyên", project: "Dự án", source: "Video nguồn", transcript: "Transcript", noTranscript: "Cần nhận diện lời nói trước", segments: "{count} đoạn",\n        media: "Tư liệu", video: "Video", images: "Hình ảnh", audio: "Âm thanh", discover: "Khám phá", findMedia: "Tìm tư liệu", findMediaHint: "Tìm video và hình ảnh phù hợp với nội dung", generateAi: "Tạo bằng AI", generateAiHint: "Tạo tư liệu mới bằng AI", generated: "Đã tạo", aiVideo: "Video AI", aiImages: "Ảnh AI", aiAudio: "Âm thanh AI", favorites: "Yêu thích", saved: "Đã lưu", items: "{count} mục", collapse: "Thu gọn tài nguyên", expand: "Mở tài nguyên",\n        discoveryTitle: "Tìm tư liệu", discoveryDesc: "Tìm video hoặc hình ảnh và thêm vào dự án mà không rời trình chỉnh sửa.", searchPlaceholder: "Ví dụ: sư tử săn mồi trong hoàng hôn", search: "Tìm kiếm", mediaType: "Loại tư liệu", orientation: "Khung hình", any: "Tất cả", portrait: "Dọc", landscape: "Ngang", square: "Vuông", close: "Đóng",\n        emptyTitle: "Tìm tư liệu cho cảnh của bạn", emptyBody: "Nhập mô tả ngắn về cảnh. Tư liệu tìm thấy chỉ được thêm vào dự án khi bạn chọn.", unavailableTitle: "Tìm tư liệu chưa sẵn sàng", unavailableBody: "Dịch vụ tìm tư liệu chưa được kết nối trên bản này. Dự án hiện tại vẫn an toàn và bạn có thể tiếp tục chỉnh sửa.", signInTitle: "Đăng nhập để tìm tư liệu", signInBody: "Đăng nhập tài khoản Viral AI Tool trước khi tìm tư liệu trực tuyến.", searching: "Đang tìm tư liệu...", noResultsTitle: "Chưa tìm thấy tư liệu phù hợp", noResultsBody: "Thử mô tả ngắn hơn hoặc đổi khung hình.", failedTitle: "Chưa thể tìm tư liệu", failedBody: "Kết nối tìm kiếm đang gặp sự cố. Thử lại sau ít phút.", libraryFullTitle: "Dự án đã đạt giới hạn tư liệu", libraryFullBody: "Xóa bớt tư liệu không còn dùng khỏi dự án rồi thử thêm lại. Tư liệu đang tìm vẫn chưa được thêm hoặc tải xuống.", results: "Kết quả", addProject: "Thêm vào dự án", preview: "Xem nguồn", sourceBy: "Nguồn: {name}", duration: "{seconds} giây"\n      },\n`;

const enMedia = `      mediaWorkbench: {\n        assets: "Assets", project: "Project", source: "Source video", transcript: "Transcript", noTranscript: "Run speech recognition first", segments: "{count} segments",\n        media: "Media", video: "Video", images: "Images", audio: "Audio", discover: "Discover", findMedia: "Find media", findMediaHint: "Find video and images that match your content", generateAi: "Generate with AI", generateAiHint: "Create new media with AI", generated: "Generated", aiVideo: "AI video", aiImages: "AI images", aiAudio: "AI audio", favorites: "Favorites", saved: "Saved", items: "{count} items", collapse: "Collapse assets", expand: "Expand assets",\n        discoveryTitle: "Find media", discoveryDesc: "Find video or images and add them to the project without leaving the editor.", searchPlaceholder: "For example: lion hunting at sunset", search: "Search", mediaType: "Media type", orientation: "Orientation", any: "Any", portrait: "Portrait", landscape: "Landscape", square: "Square", close: "Close",\n        emptyTitle: "Find media for your scene", emptyBody: "Describe the scene briefly. Search results are only added to the project when you choose them.", unavailableTitle: "Media search is not ready", unavailableBody: "Online media search is not connected in this build. Your current project remains safe and editable.", signInTitle: "Sign in to find media", signInBody: "Sign in to your Viral AI Tool account before searching online media.", searching: "Searching media...", noResultsTitle: "No matching media yet", noResultsBody: "Try a shorter description or a different orientation.", failedTitle: "Media search could not finish", failedBody: "The search connection is having trouble. Try again in a moment.", libraryFullTitle: "This project has reached its media limit", libraryFullBody: "Remove media you no longer need from the project, then try again. The selected result has not been added or downloaded.", results: "Results", addProject: "Add to project", preview: "View source", sourceBy: "Source: {name}", duration: "{seconds} sec"\n      },\n`;

function patchI18n() {
  const file = "renderer/i18n.js";
  let content = read(file);
  if ((content.match(/mediaWorkbench\s*:\s*\{/g) || []).length === 0) {
    content = replaceOnce(content, "    vi: {\n", "    vi: {\n" + viMedia, "VI central media catalog");
    content = replaceOnce(content, "    en: {\n", "    en: {\n" + enMedia, "EN central media catalog");
  }
  write(file, content);

  const legacy = path.join(root, "renderer/core-media-i18n.js");
  if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });

  const indexFile = "renderer/index.html";
  let index = read(indexFile);
  index = index.replace('<script src="i18n.js"></script><script src="core-media-i18n.js"></script>', '<script src="i18n.js"></script>');
  if (index.includes('src="core-media-i18n.js"')) throw new Error("Legacy media locale script still loaded");
  write(indexFile, index);
}

function patchTests() {
  const file = "tests/core-media-workbench.test.js";
  let content = read(file);
  content = content.replace('const locale = read("renderer/core-media-i18n.js");', 'const locale = read("renderer/i18n.js");');
  content = content.replace(
    'assert(index.includes(\'src="core-media-i18n.js"\'), "media locale catalog must be loaded until consolidated into the central catalog");\n',
    'assert(!index.includes(\'src="core-media-i18n.js"\'), "media workbench copy must not use a second locale catalog");\n'
  );
  content = content.replace(
    '  index.indexOf(\'src="core-media-i18n.js"\') < index.indexOf(\'src="core-editor-assets.js"\'),\n  "media locale must load before the assets rail"\n',
    '  index.indexOf(\'src="i18n.js"\') < index.indexOf(\'src="core-editor-assets.js"\'),\n  "central locale catalog must load before the assets rail"\n'
  );
  content = content.replace(
    'for (const language of ["vi", "en"]) {\n  assert(locale.includes(`window.I18N.messages.${language}.mediaWorkbench`), `${language} media workbench copy must exist`);\n}\n',
    'assert.strictEqual((locale.match(/mediaWorkbench\\s*:\\s*\\{/g) || []).length, 2, "central catalog must contain VI and EN media workbench copy");\nassert(locale.includes("Tìm tư liệu") && locale.includes("Find media"), "central catalog must include both media workbench languages");\n'
  );
  write(file, content);

  const wiring = `"use strict";\n\nconst assert = require("assert");\nconst fs = require("fs");\nconst path = require("path");\nconst root = path.join(__dirname, "..");\nconst read = file => fs.readFileSync(path.join(root, file), "utf8");\n\nconst main = read("main.js");\nconst preload = read("preload.js");\nconst server = read("dev-backend/server.js");\nconst index = read("renderer/index.html");\n\nassert(main.includes("require('./services/media/cloud-client')"), "desktop main must use the authenticated media cloud client");\nassert(main.includes("ipcMain.handle('media:status'"), "desktop main must expose media status IPC");\nassert(main.includes("ipcMain.handle('media:search'"), "desktop main must expose media search IPC");\nassert(main.includes("function mediaSearchPayload(payload)"), "desktop main must validate media search payloads before network use");\nassert(main.includes("refreshSessionIfNeeded()"), "media search must share authenticated session refresh semantics");\nassert(main.includes("function publicMediaError(error)"), "desktop media errors must be provider-neutral before crossing IPC");\nassert(preload.includes("getMediaStatus: () => ipcRenderer.invoke('media:status')"), "preload must expose only the narrow media status method");\nassert(preload.includes("searchMedia: payload => ipcRenderer.invoke('media:search', payload)"), "preload must expose only the narrow media search method");\nassert(server.includes('require("./media-search")'), "backend must mount the media search service");\nassert(server.includes('require("./media-routes")'), "backend must mount the authenticated media route module");\nassert(server.includes("const handleMediaRoute = createMediaRouteHandler"), "backend must configure the media route handler once");\nassert(server.includes("if (await handleMediaRoute(req, res, url, method)) return;"), "backend request dispatch must reach media routes");\nassert(!index.includes('src="core-media-i18n.js"'), "renderer must use the central i18n catalog only");\nassert(!main.includes("PEXELS_API_KEY") && !main.includes("PIXABAY_API_KEY"), "desktop main must never contain provider credentials");\nassert(!preload.includes("PEXELS_API_KEY") && !preload.includes("PIXABAY_API_KEY"), "preload must never contain provider credentials");\n\nconsole.log("Media backend, authenticated desktop IPC, preload boundary and central locale wiring contracts passed.");\n`;
  write("tests/media-workbench-wiring.test.js", wiring);
}

patchMain();
patchBackend();
patchI18n();
patchTests();

console.log("Media workbench search wiring patch applied.");
