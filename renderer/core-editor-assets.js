(function installCoreEditorAssetsPanel() {
  "use strict";

  const COLLAPSED_KEY = "viral-ai-core-editor-assets-collapsed";
  const DISCOVERY_PAGE_SIZE = 18;
  let queued = false;
  let activeSearchRequestId = null;
  let drawerMode = null;
  let selectedRemoteResult = null;

  function installLocaleMessages() {
    const messages = window.I18N?.messages;
    if (!messages?.vi || !messages?.en) return;

    messages.vi.mediaLibrary = {
      title: "Tài nguyên",
      project: "Dự án",
      source: "Video nguồn",
      transcript: "Transcript",
      noTranscript: "Cần nhận diện lời nói trước",
      segments: "{count} đoạn",
      collapse: "Thu gọn tài nguyên",
      expand: "Mở tài nguyên",
      media: "Media",
      video: "Video",
      images: "Hình ảnh",
      audio: "Âm thanh",
      discover: "Khám phá",
      findMedia: "Tìm tư liệu",
      generateAi: "Tạo bằng AI",
      generated: "Đã tạo",
      aiVideo: "Video AI",
      aiImages: "Hình ảnh AI",
      aiAudio: "Giọng & âm thanh AI",
      favorites: "Yêu thích",
      saved: "Đã lưu",
      unavailableShort: "Chưa sẵn sàng",
      libraryTitle: "Thư viện dự án",
      libraryVideoTitle: "Video trong dự án",
      libraryImagesTitle: "Hình ảnh trong dự án",
      libraryAudioTitle: "Âm thanh trong dự án",
      libraryFavoritesTitle: "Tư liệu yêu thích",
      libraryGeneratedTitle: "Tư liệu đã tạo bằng AI",
      libraryDesc: "Tư liệu thuộc dự án hiện tại được giữ cùng metadata và trạng thái file.",
      emptyLibraryTitle: "Chưa có tư liệu ở nhóm này",
      emptyLibraryBody: "Tư liệu bạn thêm vào dự án sẽ xuất hiện ở đây và được giữ lại khi mở lại dự án.",
      available: "Sẵn sàng",
      remote: "Trực tuyến",
      missing: "Không tìm thấy file",
      interrupted: "Bị gián đoạn",
      failed: "Chưa hoàn tất",
      findTitle: "Tìm tư liệu cho video",
      findDesc: "Tìm video trực tuyến theo nội dung và khung hình. Kết quả tìm kiếm chỉ là bản xem trước cho tới khi được tải vào dự án.",
      searchPlaceholder: "Ví dụ: sư tử bên bờ sông...",
      search: "Tìm tư liệu",
      searching: "Đang tìm...",
      orientation: "Khung hình",
      anyOrientation: "Tất cả",
      portrait: "Dọc 9:16",
      landscape: "Ngang 16:9",
      square: "Vuông",
      close: "Đóng",
      onlineVideo: "Video trực tuyến",
      checkService: "Đang kiểm tra kho tư liệu...",
      readyTitle: "Kho tư liệu đã sẵn sàng",
      readyBody: "Nhập mô tả cảnh bạn cần. Ưu tiên khung dọc khi làm Shorts, Reels hoặc TikTok.",
      loginTitle: "Cần đăng nhập để tìm tư liệu",
      loginBody: "Đăng nhập Viral AI Tool để sử dụng kho tư liệu trực tuyến.",
      unavailableTitle: "Kho tư liệu trực tuyến chưa sẵn sàng",
      unavailableBody: "Bạn vẫn có thể tiếp tục với video và media trong máy. Hãy thử lại sau.",
      networkTitle: "Chưa thể kết nối kho tư liệu",
      networkBody: "Kiểm tra kết nối mạng rồi thử lại. Dự án hiện tại không bị thay đổi.",
      invalidTitle: "Mô tả tìm kiếm chưa hợp lệ",
      invalidBody: "Nhập ít nhất 2 ký tự mô tả cảnh hoặc chủ thể bạn muốn tìm.",
      quotaTitle: "Kho tư liệu tạm thời đang giới hạn lượt tìm",
      quotaBody: "Đợi một lúc rồi thử lại. Media đã có trong dự án không bị ảnh hưởng.",
      cancelledTitle: "Đã dừng tìm kiếm",
      cancelledBody: "Bạn có thể nhập nội dung khác và tìm lại bất cứ lúc nào.",
      retry: "Thử lại",
      resultsTitle: "Kết quả",
      resultsCount: "{count} kết quả",
      noResultsTitle: "Chưa tìm thấy tư liệu phù hợp",
      noResultsBody: "Thử mô tả ngắn hơn, đổi chủ thể hoặc chọn một khung hình khác.",
      sourceProvider: "Nguồn",
      creator: "Tác giả",
      duration: "Thời lượng",
      resolution: "Độ phân giải",
      openSource: "Mở trang nguồn",
      preview: "Xem trước",
      previewHint: "Chọn một kết quả để xem video trước khi dùng.",
      attribution: "Thông tin nguồn",
      projectAddLocked: "Tải vào dự án sẽ được bật sau khi bộ tải và cache an toàn hoàn tất.",
      previous: "Trang trước",
      next: "Trang sau",
      page: "Trang {page}",
      generatedPendingTitle: "Tạo media bằng AI chưa được bật ở bước này",
      generatedPendingBody: "Media Engine đang hoàn thiện tìm kiếm, tải và cache trước để các nguồn AI sau này dùng chung một quy trình an toàn."
    };

    messages.en.mediaLibrary = {
      title: "Assets",
      project: "Project",
      source: "Source video",
      transcript: "Transcript",
      noTranscript: "Run Speech first",
      segments: "{count} segments",
      collapse: "Collapse assets",
      expand: "Expand assets",
      media: "Media",
      video: "Video",
      images: "Images",
      audio: "Audio",
      discover: "Discover",
      findMedia: "Find media",
      generateAi: "Generate with AI",
      generated: "Generated",
      aiVideo: "AI video",
      aiImages: "AI images",
      aiAudio: "AI voice & audio",
      favorites: "Favorites",
      saved: "Saved",
      unavailableShort: "Not available yet",
      libraryTitle: "Project library",
      libraryVideoTitle: "Project videos",
      libraryImagesTitle: "Project images",
      libraryAudioTitle: "Project audio",
      libraryFavoritesTitle: "Favorite media",
      libraryGeneratedTitle: "AI-generated media",
      libraryDesc: "Media owned by the current project keeps its metadata and file state when the project is reopened.",
      emptyLibraryTitle: "No media in this group yet",
      emptyLibraryBody: "Media added to this project will appear here and remain available when you reopen the project.",
      available: "Available",
      remote: "Online",
      missing: "File not found",
      interrupted: "Interrupted",
      failed: "Not completed",
      findTitle: "Find media for your video",
      findDesc: "Search online video by subject and frame. Search results remain previews until they are safely downloaded into the project.",
      searchPlaceholder: "For example: lion beside a river...",
      search: "Find media",
      searching: "Searching...",
      orientation: "Frame",
      anyOrientation: "Any",
      portrait: "Portrait 9:16",
      landscape: "Landscape 16:9",
      square: "Square",
      close: "Close",
      onlineVideo: "Online video",
      checkService: "Checking the media library...",
      readyTitle: "Online media is ready",
      readyBody: "Describe the shot you need. Portrait is usually the best starting point for Shorts, Reels and TikTok.",
      loginTitle: "Sign in to find media",
      loginBody: "Sign in to Viral AI Tool to use the online media library.",
      unavailableTitle: "Online media is not available right now",
      unavailableBody: "You can keep working with source and local media. Try again later.",
      networkTitle: "Could not reach the media library",
      networkBody: "Check your connection and try again. Your current project was not changed.",
      invalidTitle: "Search description is not valid yet",
      invalidBody: "Enter at least 2 characters describing the scene or subject you want to find.",
      quotaTitle: "Media search is temporarily rate limited",
      quotaBody: "Wait a moment and try again. Media already in your project is not affected.",
      cancelledTitle: "Search stopped",
      cancelledBody: "You can change the query and search again at any time.",
      retry: "Try again",
      resultsTitle: "Results",
      resultsCount: "{count} results",
      noResultsTitle: "No matching media found",
      noResultsBody: "Try a shorter description, another subject, or a different frame.",
      sourceProvider: "Source",
      creator: "Creator",
      duration: "Duration",
      resolution: "Resolution",
      openSource: "Open source page",
      preview: "Preview",
      previewHint: "Select a result to preview the video before using it.",
      attribution: "Source information",
      projectAddLocked: "Download to project will be enabled after the safe download and cache lifecycle is complete.",
      previous: "Previous",
      next: "Next",
      page: "Page {page}",
      generatedPendingTitle: "AI media generation is not enabled in this slice",
      generatedPendingBody: "The Media Engine is completing search, download and cache first so future AI sources can share the same safe workflow."
    };
  }

  installLocaleMessages();

  function locale() {
    try {
      const saved = JSON.parse(localStorage.getItem("viral-ai-tool-state") || "{}");
      return saved?.locale === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  }

  function t(key, vars = {}) {
    return window.I18N?.t?.(locale(), "mediaLibrary." + key, vars) || key;
  }

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function mediaLibrary() {
    const current = appState();
    const model = window.ViralCoreMediaLibraryModel;
    if (model?.normalizeLibrary) return model.normalizeLibrary(current?.media || {});
    return current?.media && typeof current.media === "object"
      ? current.media
      : { assets: [], selectedAssetId: null };
  }

  function assets() {
    return Array.isArray(mediaLibrary()?.assets) ? mediaLibrary().assets : [];
  }

  function currentSource() {
    const current = appState();
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    return jobs.find(job => job?.sourcePath && !job?.isRenderOutput) || null;
  }

  function basename(value) {
    const raw = String(value || "");
    if (!raw) return "—";
    try {
      const url = new URL(raw);
      const urlPath = decodeURIComponent(url.pathname || "");
      return urlPath.split(/[\\/]/).filter(Boolean).pop() || raw;
    } catch {
      return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
    }
  }

  function durationFor(video, source) {
    const nativeDuration = Number(video?.duration);
    if (Number.isFinite(nativeDuration) && nativeDuration > 0) return nativeDuration;
    const hint = Number(video?.dataset?.coreDurationHint || 0);
    if (Number.isFinite(hint) && hint > 0) return hint;
    const stored = Number(source?.meta?.duration || 0);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
  }

  function collapsed() {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  }

  function applyCollapsed(panel, value) {
    panel.classList.toggle("is-collapsed", value);
    const button = panel.querySelector("[data-assets-collapse]");
    if (button instanceof HTMLButtonElement) {
      button.textContent = value ? "›" : "‹";
      button.title = value ? t("expand") : t("collapse");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", value ? "false" : "true");
    }
    localStorage.setItem(COLLAPSED_KEY, value ? "true" : "false");
  }

  function safeText(value, fallback = "—") {
    const text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function countAssets(filter) {
    return assets().filter(filter).length;
  }

  function navItem({ icon, label, count, action, disabled = false, badge }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "core-assets-nav-item";
    if (disabled) {
      button.disabled = true;
      button.classList.add("is-disabled");
    }
    if (action) button.dataset.assetAction = action;

    const iconNode = document.createElement("span");
    iconNode.className = "core-assets-nav-icon";
    iconNode.textContent = icon;
    const labelNode = document.createElement("span");
    labelNode.className = "core-assets-nav-label";
    labelNode.textContent = label;
    button.append(iconNode, labelNode);

    if (badge) {
      const badgeNode = document.createElement("span");
      badgeNode.className = "core-assets-nav-badge core-assets-nav-badge-muted";
      badgeNode.textContent = badge;
      button.append(badgeNode);
    } else if (Number.isFinite(count)) {
      const countNode = document.createElement("span");
      countNode.className = "core-assets-nav-badge";
      countNode.textContent = String(count);
      button.append(countNode);
    }
    return button;
  }

  function appendSection(body, label) {
    const node = document.createElement("div");
    node.className = "core-assets-section-label";
    node.textContent = label;
    body.append(node);
  }

  function renderRailNavigation(panel) {
    const body = panel.querySelector(".core-assets-body");
    if (!(body instanceof HTMLElement)) return;

    const localAssets = assets();
    const videoCount = localAssets.filter(asset => asset?.kind === "video").length;
    const imageCount = localAssets.filter(asset => asset?.kind === "image").length;
    const audioCount = localAssets.filter(asset => asset?.kind === "audio").length;
    const generatedVideo = countAssets(asset => asset?.origin === "generated" && asset?.kind === "video");
    const generatedImages = countAssets(asset => asset?.origin === "generated" && asset?.kind === "image");
    const generatedAudio = countAssets(asset => asset?.origin === "generated" && asset?.kind === "audio");
    const favoriteCount = countAssets(asset => asset?.favorite === true);
    const signature = [locale(), videoCount, imageCount, audioCount, generatedVideo, generatedImages, generatedAudio, favoriteCount].join("|");
    if (body.dataset.dynamicAssetsSignature === signature) return;
    body.dataset.dynamicAssetsSignature = signature;

    body.querySelectorAll("[data-dynamic-assets-section]").forEach(node => node.remove());
    const dynamic = document.createElement("div");
    dynamic.dataset.dynamicAssetsSection = "true";

    appendSection(dynamic, t("media"));
    dynamic.append(
      navItem({ icon: "▰", label: t("video"), count: videoCount, action: "library-video" }),
      navItem({ icon: "▧", label: t("images"), count: imageCount, action: "library-image" }),
      navItem({ icon: "♫", label: t("audio"), count: audioCount, action: "library-audio" })
    );

    appendSection(dynamic, t("discover"));
    dynamic.append(
      navItem({ icon: "⌕", label: t("findMedia"), action: "discover" }),
      navItem({ icon: "✦", label: t("generateAi"), action: "generate", disabled: true, badge: t("unavailableShort") })
    );

    appendSection(dynamic, t("generated"));
    dynamic.append(
      navItem({ icon: "▶", label: t("aiVideo"), count: generatedVideo, action: "generated-video" }),
      navItem({ icon: "◇", label: t("aiImages"), count: generatedImages, action: "generated-image" }),
      navItem({ icon: "≋", label: t("aiAudio"), count: generatedAudio, action: "generated-audio" })
    );

    appendSection(dynamic, t("favorites"));
    dynamic.append(navItem({ icon: "♡", label: t("saved"), count: favoriteCount, action: "favorites" }));
    body.append(dynamic);
  }

  function setDrawerOpen(drawer, open) {
    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      cancelActiveSearch();
      drawerMode = null;
      selectedRemoteResult = null;
      drawer.querySelector("video")?.pause?.();
    }
  }

  function cancelActiveSearch() {
    if (!activeSearchRequestId) return;
    const id = activeSearchRequestId;
    activeSearchRequestId = null;
    try { window.desktopAPI?.cancelMediaSearch?.(id); } catch {}
  }

  function requestId() {
    try {
      if (window.crypto?.randomUUID) return "media-" + window.crypto.randomUUID();
    } catch {}
    return "media-search-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function createDrawer(focus) {
    let drawer = focus.querySelector(":scope > .core-media-browser");
    if (drawer instanceof HTMLElement) return drawer;

    drawer = document.createElement("section");
    drawer.className = "core-media-browser";
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("aria-label", t("findTitle"));
    focus.append(drawer);
    return drawer;
  }

  function drawerHeader(drawer, title, desc) {
    drawer.replaceChildren();
    const head = document.createElement("header");
    head.className = "core-media-browser-head";
    const copy = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = t("title");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = desc;
    copy.append(eyebrow, heading, body);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "core-media-browser-close";
    close.setAttribute("aria-label", t("close"));
    close.title = t("close");
    close.textContent = "×";
    close.addEventListener("click", () => setDrawerOpen(drawer, false));
    head.append(copy, close);
    drawer.append(head);
  }

  function statusCopy(code) {
    if (code === "MEDIA_AUTH_REQUIRED") return [t("loginTitle"), t("loginBody")];
    if (code === "MEDIA_SEARCH_INVALID") return [t("invalidTitle"), t("invalidBody")];
    if (code === "MEDIA_QUOTA_EXCEEDED") return [t("quotaTitle"), t("quotaBody")];
    if (code === "MEDIA_CANCELLED") return [t("cancelledTitle"), t("cancelledBody")];
    if (code === "MEDIA_NETWORK" || code === "MEDIA_SEARCH_TIMEOUT") return [t("networkTitle"), t("networkBody")];
    return [t("unavailableTitle"), t("unavailableBody")];
  }

  function renderNotice(container, { title, body, working = false, action = null } = {}) {
    container.replaceChildren();
    const notice = document.createElement("div");
    notice.className = "core-media-browser-notice" + (working ? " is-working" : "");
    const mark = document.createElement("span");
    mark.className = "core-media-browser-notice-mark";
    mark.textContent = working ? "···" : "◇";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = body || "";
    copy.append(heading, paragraph);
    notice.append(mark, copy);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "core-media-secondary-button";
      button.textContent = t("retry");
      button.addEventListener("click", action);
      notice.append(button);
    }
    container.append(notice);
  }

  function assetStateLabel(asset) {
    if (asset?.fileState === "missing") return t("missing");
    if (asset?.status === "interrupted") return t("interrupted");
    if (asset?.status === "failed") return t("failed");
    if (asset?.fileState === "remote") return t("remote");
    return t("available");
  }

  function renderProjectLibrary(drawer, filter, title) {
    cancelActiveSearch();
    drawerMode = "library";
    drawerHeader(drawer, title, t("libraryDesc"));
    const content = document.createElement("div");
    content.className = "core-media-library-content";
    const list = assets().filter(filter);

    if (!list.length) {
      renderNotice(content, { title: t("emptyLibraryTitle"), body: t("emptyLibraryBody") });
    } else {
      const grid = document.createElement("div");
      grid.className = "core-project-media-grid";
      for (const asset of list) {
        const card = document.createElement("article");
        card.className = "core-project-media-card";
        const thumb = document.createElement("div");
        thumb.className = "core-project-media-thumb";
        if (asset?.previewUrl) {
          const image = document.createElement("img");
          image.src = asset.previewUrl;
          image.alt = "";
          image.loading = "lazy";
          thumb.append(image);
        } else {
          thumb.textContent = asset?.kind === "audio" ? "♫" : asset?.kind === "image" ? "◇" : "▶";
        }
        const copy = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = safeText(asset?.name);
        const meta = document.createElement("small");
        const width = Number(asset?.meta?.width || 0);
        const height = Number(asset?.meta?.height || 0);
        const dimensions = width && height ? width + "×" + height : null;
        const duration = Number(asset?.meta?.duration || 0) > 0 ? formatDuration(asset.meta.duration) : null;
        meta.textContent = [dimensions, duration, assetStateLabel(asset)].filter(Boolean).join(" · ");
        copy.append(name, meta);
        card.append(thumb, copy);
        grid.append(card);
      }
      content.append(grid);
    }
    drawer.append(content);
    setDrawerOpen(drawer, true);
  }

  function sourceButton(result) {
    const url = result?.attribution?.sourceUrl;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "core-media-secondary-button";
    button.textContent = t("openSource");
    button.disabled = !url;
    button.addEventListener("click", () => {
      if (url) window.desktopAPI?.openExternal?.(url);
    });
    return button;
  }

  function preferredVariant(result) {
    const variants = Array.isArray(result?.variants) ? result.variants.filter(item => item?.url) : [];
    if (!variants.length) return null;
    return variants.slice().sort((a, b) => {
      const score = item => (Number(item?.width || 0) * Number(item?.height || 0));
      return score(b) - score(a);
    })[0];
  }

  function renderRemotePreview(preview, result) {
    selectedRemoteResult = result;
    preview.replaceChildren();
    const variant = preferredVariant(result);
    const media = document.createElement("div");
    media.className = "core-media-result-preview-media";
    if (variant?.url) {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.poster = result?.previewUrl || "";
      video.src = variant.url;
      media.append(video);
    } else if (result?.previewUrl) {
      const image = document.createElement("img");
      image.src = result.previewUrl;
      image.alt = "";
      media.append(image);
    } else {
      media.textContent = "▶";
    }

    const info = document.createElement("div");
    info.className = "core-media-result-preview-info";
    const title = document.createElement("h3");
    title.textContent = safeText(result?.name, t("onlineVideo"));
    const facts = document.createElement("dl");
    const pairs = [
      [t("duration"), Number(result?.meta?.duration || 0) > 0 ? formatDuration(result.meta.duration) : "—"],
      [t("resolution"), result?.meta?.width && result?.meta?.height ? result.meta.width + "×" + result.meta.height : "—"],
      [t("creator"), safeText(result?.attribution?.creatorName)],
      [t("sourceProvider"), safeText(result?.provider)]
    ];
    for (const [label, value] of pairs) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      facts.append(dt, dd);
    }
    const actions = document.createElement("div");
    actions.className = "core-media-preview-actions";
    actions.append(sourceButton(result));
    const locked = document.createElement("small");
    locked.className = "core-media-project-lock-note";
    locked.textContent = t("projectAddLocked");
    info.append(title, facts, actions, locked);
    preview.append(media, info);
  }

  function renderSearchResults(drawer, data, queryState) {
    const resultArea = drawer.querySelector("[data-media-results]");
    const preview = drawer.querySelector("[data-media-preview]");
    if (!(resultArea instanceof HTMLElement) || !(preview instanceof HTMLElement)) return;
    resultArea.replaceChildren();
    preview.replaceChildren();

    const results = Array.isArray(data?.results) ? data.results : [];
    const header = document.createElement("div");
    header.className = "core-media-results-head";
    const heading = document.createElement("strong");
    heading.textContent = t("resultsTitle");
    const count = document.createElement("span");
    count.textContent = t("resultsCount", { count: results.length });
    header.append(heading, count);
    resultArea.append(header);

    if (!results.length) {
      const empty = document.createElement("div");
      renderNotice(empty, { title: t("noResultsTitle"), body: t("noResultsBody") });
      resultArea.append(empty);
      renderNotice(preview, { title: t("preview"), body: t("previewHint") });
    } else {
      const list = document.createElement("div");
      list.className = "core-media-results-list";
      for (const result of results) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "core-media-result-card";
        const thumb = document.createElement("span");
        thumb.className = "core-media-result-thumb";
        if (result?.previewUrl) {
          const image = document.createElement("img");
          image.src = result.previewUrl;
          image.alt = "";
          image.loading = "lazy";
          thumb.append(image);
        } else {
          thumb.textContent = "▶";
        }
        const copy = document.createElement("span");
        copy.className = "core-media-result-copy";
        const title = document.createElement("b");
        title.textContent = safeText(result?.name, t("onlineVideo"));
        const meta = document.createElement("small");
        const duration = Number(result?.meta?.duration || 0) > 0 ? formatDuration(result.meta.duration) : null;
        const dimensions = result?.meta?.width && result?.meta?.height ? result.meta.width + "×" + result.meta.height : null;
        meta.textContent = [duration, dimensions, result?.attribution?.creatorName].filter(Boolean).join(" · ");
        copy.append(title, meta);
        card.append(thumb, copy);
        card.addEventListener("click", () => {
          list.querySelectorAll(".is-selected").forEach(node => node.classList.remove("is-selected"));
          card.classList.add("is-selected");
          renderRemotePreview(preview, result);
        });
        list.append(card);
      }
      resultArea.append(list);
      renderRemotePreview(preview, results[0]);
      list.querySelector(".core-media-result-card")?.classList.add("is-selected");
    }

    const pager = document.createElement("div");
    pager.className = "core-media-results-pager";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "core-media-secondary-button";
    previous.textContent = t("previous");
    previous.disabled = queryState.page <= 1;
    const page = document.createElement("span");
    page.textContent = t("page", { page: queryState.page });
    const next = document.createElement("button");
    next.type = "button";
    next.className = "core-media-secondary-button";
    next.textContent = t("next");
    next.disabled = !data?.nextPage && results.length < DISCOVERY_PAGE_SIZE;
    previous.addEventListener("click", () => runSearch(drawer, { ...queryState, page: Math.max(1, queryState.page - 1) }));
    next.addEventListener("click", () => runSearch(drawer, { ...queryState, page: queryState.page + 1 }));
    pager.append(previous, page, next);
    resultArea.append(pager);
  }

  async function runSearch(drawer, override = null) {
    const queryInput = drawer.querySelector("[data-media-query]");
    const orientationInput = drawer.querySelector("[data-media-orientation]");
    const submit = drawer.querySelector("[data-media-search-submit]");
    const resultArea = drawer.querySelector("[data-media-results]");
    const preview = drawer.querySelector("[data-media-preview]");
    if (!(queryInput instanceof HTMLInputElement) || !(orientationInput instanceof HTMLSelectElement)) return;

    const state = override || {
      query: queryInput.value.trim(),
      orientation: orientationInput.value,
      page: 1
    };
    queryInput.value = state.query;
    orientationInput.value = state.orientation;

    if (state.query.length < 2) {
      if (resultArea) renderNotice(resultArea, { title: t("invalidTitle"), body: t("invalidBody") });
      return;
    }

    cancelActiveSearch();
    const id = requestId();
    activeSearchRequestId = id;
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = true;
      submit.textContent = t("searching");
    }
    if (resultArea) renderNotice(resultArea, { title: t("searching"), body: state.query, working: true });
    if (preview) renderNotice(preview, { title: t("preview"), body: t("previewHint") });

    try {
      const response = await window.desktopAPI?.searchMedia?.({
        requestId: id,
        query: state.query,
        kind: "video",
        orientation: state.orientation,
        page: state.page,
        perPage: DISCOVERY_PAGE_SIZE,
        provider: "auto"
      });
      if (activeSearchRequestId !== id) return;
      activeSearchRequestId = null;
      if (!response?.ok) {
        const [title, body] = statusCopy(response?.error?.code);
        if (resultArea) renderNotice(resultArea, { title, body, action: () => runSearch(drawer, state) });
        return;
      }
      renderSearchResults(drawer, response.data || {}, state);
    } catch {
      if (activeSearchRequestId !== id) return;
      activeSearchRequestId = null;
      if (resultArea) renderNotice(resultArea, { title: t("networkTitle"), body: t("networkBody"), action: () => runSearch(drawer, state) });
    } finally {
      if (activeSearchRequestId === id) activeSearchRequestId = null;
      if (submit instanceof HTMLButtonElement && !activeSearchRequestId) {
        submit.disabled = false;
        submit.textContent = t("search");
      }
    }
  }

  async function checkDiscoveryStatus(drawer) {
    const status = drawer.querySelector("[data-media-service-status]");
    if (!(status instanceof HTMLElement)) return;
    renderNotice(status, { title: t("checkService"), body: "", working: true });
    try {
      const response = await window.desktopAPI?.getMediaSearchStatus?.();
      if (!response?.ok) {
        const [title, body] = statusCopy(response?.error?.code);
        renderNotice(status, { title, body, action: () => checkDiscoveryStatus(drawer) });
        drawer.querySelectorAll("[data-media-search-control]").forEach(control => { control.disabled = true; });
        return;
      }
      if (response?.data?.ready !== true) {
        renderNotice(status, { title: t("unavailableTitle"), body: t("unavailableBody"), action: () => checkDiscoveryStatus(drawer) });
        drawer.querySelectorAll("[data-media-search-control]").forEach(control => { control.disabled = true; });
        return;
      }
      renderNotice(status, { title: t("readyTitle"), body: t("readyBody") });
      drawer.querySelectorAll("[data-media-search-control]").forEach(control => { control.disabled = false; });
    } catch {
      renderNotice(status, { title: t("networkTitle"), body: t("networkBody"), action: () => checkDiscoveryStatus(drawer) });
      drawer.querySelectorAll("[data-media-search-control]").forEach(control => { control.disabled = true; });
    }
  }

  function renderDiscovery(drawer) {
    drawerMode = "discover";
    drawerHeader(drawer, t("findTitle"), t("findDesc"));

    const controls = document.createElement("form");
    controls.className = "core-media-search-bar";
    controls.addEventListener("submit", event => {
      event.preventDefault();
      runSearch(drawer);
    });

    const query = document.createElement("input");
    query.type = "search";
    query.autocomplete = "off";
    query.placeholder = t("searchPlaceholder");
    query.dataset.mediaQuery = "true";
    query.dataset.mediaSearchControl = "true";
    query.disabled = true;

    const orientation = document.createElement("select");
    orientation.dataset.mediaOrientation = "true";
    orientation.dataset.mediaSearchControl = "true";
    orientation.disabled = true;
    for (const [value, label] of [
      ["any", t("anyOrientation")],
      ["portrait", t("portrait")],
      ["landscape", t("landscape")],
      ["square", t("square")]
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      orientation.append(option);
    }
    orientation.value = "portrait";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "core-media-primary-button";
    submit.dataset.mediaSearchSubmit = "true";
    submit.dataset.mediaSearchControl = "true";
    submit.textContent = t("search");
    submit.disabled = true;
    controls.append(query, orientation, submit);

    const service = document.createElement("div");
    service.className = "core-media-service-status";
    service.dataset.mediaServiceStatus = "true";

    const workspace = document.createElement("div");
    workspace.className = "core-media-browser-workspace";
    const results = document.createElement("section");
    results.className = "core-media-results";
    results.dataset.mediaResults = "true";
    const preview = document.createElement("aside");
    preview.className = "core-media-result-preview";
    preview.dataset.mediaPreview = "true";
    workspace.append(results, preview);

    drawer.append(controls, service, workspace);
    renderNotice(results, { title: t("resultsTitle"), body: t("readyBody") });
    renderNotice(preview, { title: t("preview"), body: t("previewHint") });
    setDrawerOpen(drawer, true);
    checkDiscoveryStatus(drawer);
    setTimeout(() => query.focus(), 80);
  }

  function renderGeneratedPending(drawer) {
    cancelActiveSearch();
    drawerMode = "generated-pending";
    drawerHeader(drawer, t("generateAi"), t("generatedPendingBody"));
    const content = document.createElement("div");
    content.className = "core-media-library-content";
    renderNotice(content, { title: t("generatedPendingTitle"), body: t("generatedPendingBody") });
    drawer.append(content);
    setDrawerOpen(drawer, true);
  }

  function handleRailAction(action, drawer) {
    if (action === "discover") return renderDiscovery(drawer);
    if (action === "generate") return renderGeneratedPending(drawer);
    if (action === "library-video") return renderProjectLibrary(drawer, asset => asset?.kind === "video", t("libraryVideoTitle"));
    if (action === "library-image") return renderProjectLibrary(drawer, asset => asset?.kind === "image", t("libraryImagesTitle"));
    if (action === "library-audio") return renderProjectLibrary(drawer, asset => asset?.kind === "audio", t("libraryAudioTitle"));
    if (action === "favorites") return renderProjectLibrary(drawer, asset => asset?.favorite === true, t("libraryFavoritesTitle"));
    if (action === "generated-video") return renderProjectLibrary(drawer, asset => asset?.origin === "generated" && asset?.kind === "video", t("libraryGeneratedTitle"));
    if (action === "generated-image") return renderProjectLibrary(drawer, asset => asset?.origin === "generated" && asset?.kind === "image", t("libraryGeneratedTitle"));
    if (action === "generated-audio") return renderProjectLibrary(drawer, asset => asset?.origin === "generated" && asset?.kind === "audio", t("libraryGeneratedTitle"));
  }

  function ensurePanel(grid, focus) {
    let panel = grid.querySelector(":scope > .core-editor-assets-panel");
    if (panel instanceof HTMLElement) return panel;

    panel = document.createElement("aside");
    panel.className = "core-editor-assets-panel";
    panel.setAttribute("aria-label", t("title"));

    const head = document.createElement("div");
    head.className = "core-assets-head";
    const title = document.createElement("strong");
    title.textContent = t("title");
    const collapseButton = document.createElement("button");
    collapseButton.type = "button";
    collapseButton.dataset.assetsCollapse = "true";
    collapseButton.textContent = "‹";
    head.append(title, collapseButton);

    const body = document.createElement("div");
    body.className = "core-assets-body";
    appendSection(body, t("project"));

    const sourceButtonNode = document.createElement("button");
    sourceButtonNode.type = "button";
    sourceButtonNode.className = "core-asset-item core-source-asset";
    sourceButtonNode.dataset.sourceAsset = "true";
    sourceButtonNode.innerHTML = '<span class="core-asset-icon">▶</span><span class="core-asset-copy"><b data-source-label></b><small data-source-name>—</small><em data-source-meta>—</em></span>';
    sourceButtonNode.querySelector("[data-source-label]").textContent = t("source");

    const transcriptButton = document.createElement("button");
    transcriptButton.type = "button";
    transcriptButton.className = "core-asset-item core-transcript-asset";
    transcriptButton.dataset.transcriptAsset = "true";
    transcriptButton.innerHTML = '<span class="core-asset-icon">TXT</span><span class="core-asset-copy"><b data-transcript-label></b><small data-transcript-status></small></span>';
    transcriptButton.querySelector("[data-transcript-label]").textContent = t("transcript");
    transcriptButton.querySelector("[data-transcript-status]").textContent = t("noTranscript");
    body.append(sourceButtonNode, transcriptButton);
    panel.append(head, body);
    grid.prepend(panel);

    const drawer = createDrawer(focus);
    collapseButton.addEventListener("click", () => applyCollapsed(panel, !panel.classList.contains("is-collapsed")));
    sourceButtonNode.addEventListener("click", () => {
      grid.querySelector("video.preview-video, video.core-player-media")?.focus?.();
      grid.querySelector(".preview")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
    transcriptButton.addEventListener("click", event => {
      const button = event.currentTarget;
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      window.dispatchEvent(new CustomEvent("viral-ai:bottom-dock-tab", { detail: { tab: "transcript" } }));
    });
    body.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest("[data-asset-action]") : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) return;
      handleRailAction(target.dataset.assetAction, drawer);
    });
    applyCollapsed(panel, collapsed());
    return panel;
  }

  function updatePanel(panel, grid) {
    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    const name = panel.querySelector("[data-source-name]");
    const meta = panel.querySelector("[data-source-meta]");
    const transcript = panel.querySelector("[data-transcript-asset]");
    const transcriptStatus = panel.querySelector("[data-transcript-status]");
    const title = panel.querySelector(".core-assets-head strong");
    if (title) title.textContent = t("title");
    const sourceLabel = panel.querySelector("[data-source-label]");
    if (sourceLabel) sourceLabel.textContent = t("source");
    const transcriptLabel = panel.querySelector("[data-transcript-label]");
    if (transcriptLabel) transcriptLabel.textContent = t("transcript");

    const sourceName = source?.name || source?.sourcePath || video?.currentSrc || video?.src;
    if (name) name.textContent = basename(sourceName);

    if (meta) {
      const nativeWidth = Number(video?.videoWidth || 0);
      const nativeHeight = Number(video?.videoHeight || 0);
      const storedWidth = Number(source?.meta?.width || 0);
      const storedHeight = Number(source?.meta?.height || 0);
      const width = nativeWidth > 0 ? nativeWidth : storedWidth;
      const height = nativeHeight > 0 ? nativeHeight : storedHeight;
      const duration = durationFor(video, source);
      const dimensions = width > 0 && height > 0 ? width + "×" + height : "—";
      meta.textContent = dimensions + " · " + formatDuration(duration);
    }

    const count = document.querySelectorAll(".transcript-list .transcript-row").length;
    if (transcript instanceof HTMLButtonElement) {
      transcript.disabled = count === 0;
      transcript.classList.toggle("is-disabled", count === 0);
      transcript.title = count === 0 ? t("noTranscript") : t("segments", { count });
    }
    if (transcriptStatus) transcriptStatus.textContent = count === 0 ? t("noTranscript") : t("segments", { count });
    renderRailNavigation(panel);
    applyCollapsed(panel, panel.classList.contains("is-collapsed"));
  }

  function enhance() {
    queued = false;
    const page = document.getElementById("page");
    if (!(page instanceof HTMLElement) || !page.classList.contains("core-editor-workbench-page")) return;
    const focus = page.querySelector(":scope > .core-editor-focus-section");
    const grid = focus?.querySelector(".editor-grid");
    if (!(grid instanceof HTMLElement) || !(focus instanceof HTMLElement)) return;

    const video = grid.querySelector("video.preview-video, video.core-player-media");
    const source = currentSource();
    if (!video && !source) return;

    const panel = ensurePanel(grid, focus);
    updatePanel(panel, grid);
    grid.classList.add("core-editor-assets-grid");
    page.classList.add("core-editor-assets-page");
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
    window.addEventListener("viral-ai:transcript-edit", queue);
    window.addEventListener("viral-ai:locale-changed", queue);
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
