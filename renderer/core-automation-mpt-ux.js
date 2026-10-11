(function installAutomationMptUx() {
  "use strict";

  let queued = false;

  function appState() {
    try { return typeof state !== "undefined" ? state : null; }
    catch { return null; }
  }

  function locale() {
    return appState()?.locale === "en" ? "en" : "vi";
  }

  function text() {
    return locale() === "en"
      ? {
          setup: "Creation setup",
          content: "Script settings",
          contentHint: "Topic, audience and writing direction",
          video: "Video settings",
          videoHint: "Format, platform and media strategy",
          audio: "Audio & subtitles",
          audioHint: "Narration language and output tracks",
          source: "Media source",
          sourceValue: "Stock video · routed automatically",
          aspect: "Aspect ratio",
          aspectValue: "Project brief",
          narration: "Voiceover",
          narrationValue: "Automatic per scene",
          subtitles: "Subtitles",
          subtitlesValue: "Generated from narration",
          provider: "Script AI",
          stock: "Stock media",
          voice: "Voice",
          ready: "Ready",
          waiting: "Available later in flow",
          runHint: "Generate the editable script first. Every later step remains reviewable before export.",
          generatedHint: "Script exists. Review it, then continue through scenes, media and timeline.",
          task: "Generation status"
        }
      : {
          setup: "Thiết lập video",
          content: "Cài đặt kịch bản",
          contentHint: "Chủ đề, đối tượng và định hướng nội dung",
          video: "Cài đặt video",
          videoHint: "Định dạng, nền tảng và chiến lược tư liệu",
          audio: "Âm thanh & phụ đề",
          audioHint: "Ngôn ngữ lời đọc và các track đầu ra",
          source: "Nguồn tư liệu",
          sourceValue: "Stock video · tự động định tuyến",
          aspect: "Tỷ lệ khung hình",
          aspectValue: "Theo Brief của project",
          narration: "Giọng đọc",
          narrationValue: "Tự động theo từng cảnh",
          subtitles: "Phụ đề",
          subtitlesValue: "Tạo từ lời narration",
          provider: "AI kịch bản",
          stock: "Tư liệu stock",
          voice: "Giọng đọc",
          ready: "Sẵn sàng",
          waiting: "Sẵn sàng ở bước sau",
          runHint: "Tạo kịch bản có thể chỉnh sửa trước. Mỗi bước sau đều có thể kiểm tra trước khi xuất video.",
          generatedHint: "Kịch bản đã có. Kiểm tra lại rồi tiếp tục qua Phân cảnh, Tư liệu và Timeline.",
          task: "Trạng thái tạo video"
        };
  }

  function createSection(kind, title, hint) {
    const section = document.createElement("section");
    section.className = `automation-setup-section automation-setup-${kind}`;
    section.dataset.automationSetupSection = kind;

    const head = document.createElement("header");
    head.className = "automation-setup-section-head";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("small");
    small.textContent = hint;
    copy.append(strong, small);
    head.appendChild(copy);

    const body = document.createElement("div");
    body.className = "automation-setup-section-body";
    section.append(head, body);
    return { section, body };
  }

  function moveField(root, id, target) {
    const field = root.querySelector(`#${id}`)?.closest(".automation-field");
    if (field instanceof HTMLElement && field.parentElement !== target) target.appendChild(field);
    return field;
  }

  function infoRow(label, value, tone = "") {
    const row = document.createElement("div");
    row.className = "automation-setup-info-row" + (tone ? ` is-${tone}` : "");
    const left = document.createElement("span");
    left.textContent = label;
    const right = document.createElement("strong");
    right.textContent = value;
    row.append(left, right);
    return row;
  }

  function providerReady() {
    return document.querySelector(".automation-provider")?.classList.contains("ready") === true;
  }

  function stockReady() {
    const providers = Array.isArray(window.ViralAutomationStockStatus?.providers)
      ? window.ViralAutomationStockStatus.providers
      : [];
    return providers.some(item => item?.ready === true);
  }

  function voiceReady() {
    try {
      const snapshot = window.ViralAutomationVoiceState?.snapshot?.();
      return snapshot?.providerStatus?.ready === true;
    } catch {
      return false;
    }
  }

  function statusChip(label, ready, waitingText) {
    const chip = document.createElement("div");
    chip.className = "automation-engine-chip " + (ready ? "is-ready" : "is-waiting");
    const dot = document.createElement("i");
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = label;
    const small = document.createElement("small");
    small.textContent = ready ? text().ready : waitingText;
    copy.append(strong, small);
    chip.append(dot, copy);
    return chip;
  }

  function ensureEngineStrip(creator) {
    const hero = creator.querySelector(":scope > .automation-hero");
    const rail = creator.querySelector(":scope > .automation-stage-rail");
    if (!(hero instanceof HTMLElement) || !(rail instanceof HTMLElement)) return;

    let strip = creator.querySelector(":scope > .automation-engine-strip");
    if (!(strip instanceof HTMLElement)) {
      strip = document.createElement("section");
      strip.className = "automation-engine-strip";
      hero.insertAdjacentElement("afterend", strip);
    }

    const script = providerReady();
    const stock = stockReady();
    const voice = voiceReady();
    const signature = [locale(), script, stock, voice].join("|");
    if (strip.dataset.signature === signature) return;
    strip.dataset.signature = signature;
    strip.replaceChildren(
      statusChip(text().provider, script, text().waiting),
      statusChip(text().stock, stock, text().waiting),
      statusChip(text().voice, voice, text().waiting)
    );
  }

  function enhanceBrief(creator) {
    const card = creator.querySelector(".automation-brief-card");
    if (!(card instanceof HTMLElement) || card.hidden) return;
    card.classList.add("automation-mpt-brief-card");

    const fields = card.querySelector(".automation-brief-fields");
    if (!(fields instanceof HTMLElement)) return;

    let setup = fields.querySelector(":scope > .automation-setup-grid");
    if (!(setup instanceof HTMLElement)) {
      setup = document.createElement("div");
      setup.className = "automation-setup-grid";
      fields.appendChild(setup);

      const content = createSection("content", text().content, text().contentHint);
      const video = createSection("video", text().video, text().videoHint);
      const audio = createSection("audio", text().audio, text().audioHint);
      setup.append(content.section, video.section, audio.section);

      ["automationTopic", "automationProduct", "automationObjective", "automationAudience", "automationTone", "automationCta"]
        .forEach(id => moveField(fields, id, content.body));
      ["automationPlatform", "automationDuration"]
        .forEach(id => moveField(fields, id, video.body));
      moveField(fields, "automationLanguage", audio.body);

      const currentBrief = appState()?.automation?.brief || null;
      video.body.append(
        infoRow(text().aspect, String(currentBrief?.aspectRatio || "9:16")),
        infoRow(text().source, text().sourceValue)
      );
      audio.body.append(
        infoRow(text().narration, text().narrationValue),
        infoRow(text().subtitles, text().subtitlesValue)
      );
    } else {
      const currentBrief = appState()?.automation?.brief || null;
      const rows = setup.querySelectorAll(".automation-setup-video .automation-setup-info-row strong");
      const nextAspect = String(currentBrief?.aspectRatio || "9:16");
      if (rows[0] && rows[0].textContent !== nextAspect) rows[0].textContent = nextAspect;
    }

    const head = card.querySelector(":scope > .automation-card-head");
    const actionButton = head?.querySelector("#automationGenerateScript, #automationStopScript");
    let runbar = card.querySelector(":scope > .automation-runbar");
    if (!(runbar instanceof HTMLElement)) {
      runbar = document.createElement("footer");
      runbar.className = "automation-runbar";
      card.appendChild(runbar);
    }

    let runCopy = runbar.querySelector(":scope > .automation-runbar-copy");
    if (!(runCopy instanceof HTMLElement)) {
      runCopy = document.createElement("div");
      runCopy.className = "automation-runbar-copy";
      runbar.appendChild(runCopy);
    }
    const hasScript = Boolean(appState()?.automation?.script);
    const copySignature = [locale(), hasScript].join("|");
    if (runCopy.dataset.signature !== copySignature) {
      runCopy.dataset.signature = copySignature;
      const label = document.createElement("span");
      label.textContent = text().task;
      const body = document.createElement("strong");
      body.textContent = hasScript ? text().generatedHint : text().runHint;
      runCopy.replaceChildren(label, body);
    }

    if (actionButton instanceof HTMLButtonElement && actionButton.parentElement !== runbar) runbar.appendChild(actionButton);
    const job = card.querySelector(":scope > .automation-job");
    if (job instanceof HTMLElement && job.parentElement !== runbar) runbar.insertBefore(job, actionButton || null);
  }

  function enhanceScript(creator) {
    const card = creator.querySelector(".automation-script-card");
    if (!(card instanceof HTMLElement) || card.hidden) return;
    card.classList.add("automation-mpt-script-card");
  }

  function enhance() {
    queued = false;
    if (appState()?.page !== "automation") return;
    const creator = document.querySelector(".automation-creator.automation-workspace-v2");
    if (!(creator instanceof HTMLElement)) return;
    creator.classList.add("automation-mpt-inspired");
    document.documentElement.dataset.automationConsole = "mpt-inspired";
    ensureEngineStrip(creator);
    enhanceBrief(creator);
    enhanceScript(creator);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(enhance);
  }

  window.addEventListener("viral-ai:core-state-changed", queue);
  window.addEventListener("viral-ai:automation-page-rendered", queue);
  window.addEventListener("viral-ai:automation-recovery", queue);

  const start = () => {
    const page = document.getElementById("page");
    if (page) new MutationObserver(queue).observe(page, { childList: true, subtree: true });
    queue();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ViralAutomationMptUx = { refresh: queue };
})();
