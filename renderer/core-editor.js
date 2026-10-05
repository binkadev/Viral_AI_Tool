(function () {
  "use strict";

  const Model = globalThis.CoreEditorModel;
  if (!Model) return;

  const PREF_KEY = "viral-ai-core-editor-prefs";
  const copy = () => state.locale === "vi" ? {
    workspace: "Không gian biên tập",
    workflow: "Quy trình",
    asset: "Video nguồn",
    noAsset: "Chưa có video. Hãy import một file để bắt đầu.",
    import: "Import",
    importHint: "Chọn video từ máy",
    analyze: "Analyze",
    analyzeHint: "Đọc metadata và kiểm tra file",
    transcribe: "Transcript",
    transcribeHint: "Nhận diện lời nói từ audio",
    edit: "Edit",
    editHint: "Sửa transcript, giữ nguyên timestamp",
    localize: "Localize",
    localizeHint: "Dịch và chuẩn bị giọng",
    render: "Render",
    renderHint: "Chỉ mở khi input bắt buộc đã sẵn sàng",
    openOutput: "Mở file đã render",
    actions: "Hành động",
    properties: "Thuộc tính",
    advanced: "Thiết lập dịch vụ nâng cao",
    preview: "Preview",
    timeline: "Timeline",
    transcript: "Transcript",
    transcriptEmpty: "Chạy Transcript để bắt đầu biên tập lời thoại.",
    sourceText: "Nội dung gốc",
    translatedText: "Bản dịch",
    ready: "Sẵn sàng",
    active: "Đang chạy",
    complete: "Hoàn tất",
    failed: "Lỗi",
    blocked: "Chưa mở",
    disabledNoVideo: "Cần import video hợp lệ trước.",
    disabledNotAnalyzed: "Cần Analyze video trước khi nhận diện lời nói.",
    disabledNoTranscript: "Cần Transcript trước khi dùng bước này.",
    disabledNoTranslation: "Cần bản dịch trước khi tạo giọng.",
    disabledNoVoice: "Cần giọng AI hoàn tất trước khi render.",
    play: "Phát",
    pause: "Tạm dừng",
    fullscreen: "Toàn màn hình",
    collapse: "Thu gọn panel",
    expand: "Mở panel",
    editingInvalidatesTranslation: "Transcript đã thay đổi. Bản dịch và giọng cũ cần tạo lại.",
    editingInvalidatesVoice: "Bản dịch đã thay đổi. Giọng cũ cần tạo lại.",
    reanalyze: "Phân tích lại",
    retry: "Thử lại",
    rendered: "Đã render"
  } : {
    workspace: "Editing workspace",
    workflow: "Workflow",
    asset: "Source video",
    noAsset: "No video yet. Import a local file to begin.",
    import: "Import",
    importHint: "Choose a local video",
    analyze: "Analyze",
    analyzeHint: "Read metadata and validate the file",
    transcribe: "Transcript",
    transcribeHint: "Recognize speech from audio",
    edit: "Edit",
    editHint: "Edit text without changing timestamps",
    localize: "Localize",
    localizeHint: "Translate and prepare voice",
    render: "Render",
    renderHint: "Unlocks only when required inputs are ready",
    openOutput: "Open rendered file",
    actions: "Actions",
    properties: "Properties",
    advanced: "Advanced service settings",
    preview: "Preview",
    timeline: "Timeline",
    transcript: "Transcript",
    transcriptEmpty: "Run Transcript to start editing dialogue.",
    sourceText: "Source text",
    translatedText: "Translation",
    ready: "Ready",
    active: "Running",
    complete: "Complete",
    failed: "Failed",
    blocked: "Locked",
    disabledNoVideo: "Import a valid video first.",
    disabledNotAnalyzed: "Analyze the video before transcription.",
    disabledNoTranscript: "A transcript is required first.",
    disabledNoTranslation: "A translation is required before voice generation.",
    disabledNoVoice: "AI voice must be complete before rendering.",
    play: "Play",
    pause: "Pause",
    fullscreen: "Fullscreen",
    collapse: "Collapse panel",
    expand: "Expand panel",
    editingInvalidatesTranslation: "Transcript changed. Translation and voice need to be generated again.",
    editingInvalidatesVoice: "Translation changed. Voice needs to be generated again.",
    reanalyze: "Analyze again",
    retry: "Retry",
    rendered: "Rendered"
  };

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { prefs = {}; }

  const session = {
    sourcePath: null,
    currentTime: 0,
    duration: 0,
    playing: false,
    volume: 1,
    playbackRate: 1,
    activeSegmentIndex: -1,
    editorTouched: false,
    seekOrigin: null
  };

  function persistPrefs() {
    localStorage.setItem(PREF_KEY, JSON.stringify({
      leftCollapsed: prefs.leftCollapsed === true,
      rightCollapsed: prefs.rightCollapsed === true
    }));
  }

  function capturePlayback() {
    const video = document.querySelector("#page .preview-video");
    if (!video) return { ...session };
    const source = latestSourceJob?.();
    return {
      sourcePath: source?.sourcePath || session.sourcePath,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : session.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : session.duration,
      playing: !video.paused && !video.ended,
      volume: Number.isFinite(video.volume) ? video.volume : session.volume,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : session.playbackRate,
      activeSegmentIndex: session.activeSegmentIndex,
      editorTouched: session.editorTouched
    };
  }

  function jobForSource(source) {
    const renderJob = Model.completedRenderForSource(state.jobs, source?.sourcePath);
    return {
      speechJob: speechJobForSource(source),
      speechResult: speechResultForSource(source),
      translationJob: translationJobForSource(source),
      translationResult: translationResultForSource(source),
      voiceJob: voiceJobForSource(source),
      voiceResult: voiceResultForSource(source),
      renderJob
    };
  }

  function workflowContext(source = latestSourceJob()) {
    const related = jobForSource(source);
    return {
      source,
      ...related,
      workflow: Model.deriveWorkflow({
        source,
        speechJob: related.speechJob,
        speechResult: related.speechResult,
        translationJob: related.translationJob,
        translationResult: related.translationResult,
        voiceJob: related.voiceJob,
        voiceResult: related.voiceResult,
        jobs: state.jobs,
        editorTouched: session.editorTouched
      })
    };
  }

  function stateLabel(status) {
    const c = copy();
    return c[status] || status;
  }

  function stepLabel(id) {
    const c = copy();
    return ({
      import: c.import,
      analyze: c.analyze,
      transcript: c.transcribe,
      edit: c.edit,
      localize: c.localize,
      render: c.render
    })[id] || id;
  }

  function stepHint(id) {
    const c = copy();
    return ({
      import: c.importHint,
      analyze: c.analyzeHint,
      transcript: c.transcribeHint,
      edit: c.editHint,
      localize: c.localizeHint,
      render: c.renderHint
    })[id] || "";
  }

  function buildWorkflowMarkup(workflow) {
    return '<div class="core-workflow-list">' + workflow.steps.map((step, index) =>
      '<div class="core-workflow-step ' + step.status + '" data-core-step="' + step.id + '">' +
        '<span class="step-index">' + (step.status === "complete" ? "✓" : String(index + 1)) + '</span>' +
        '<span><b>' + escapeHtml(stepLabel(step.id)) + '</b><small>' + escapeHtml(stepHint(step.id)) + '</small></span>' +
        '<span class="step-state">' + escapeHtml(stateLabel(step.status)) + '</span>' +
      '</div>'
    ).join("") + '</div>';
  }

  function buildAssetMarkup(source) {
    const c = copy();
    if (!source) return '<div class="core-asset-empty">' + escapeHtml(c.noAsset) + '</div>';
    const meta = mediaMetaText(source) || (source.mediaState === "reading" ? t("media.readingInfo") : "");
    return '<div class="core-asset-card"><b>' + escapeHtml(source.name || "Video") + '</b>' +
      '<span>' + escapeHtml(meta || source.sourcePath || "") + '</span></div>';
  }

  function actionStatus(job, complete) {
    if (complete) return "complete";
    if (String(job?.status || "") === "failed") return "failed";
    if (Model.isBusy(job)) return "active";
    return "ready";
  }

  function actionButton({ id, icon, title, hint, enabled, status = "ready", reason = "", actionLabel = "" }) {
    const disabled = enabled ? "" : " disabled";
    const tooltip = reason || hint;
    return '<button class="core-action ' + status + '" type="button" data-core-action="' + id + '"' + disabled +
      ' title="' + escapeHtml(tooltip) + '">' +
      '<span class="core-action-icon">' + icon + '</span>' +
      '<span class="core-action-copy"><b>' + escapeHtml(title) + '</b><small>' + escapeHtml(hint) + '</small></span>' +
      '<span class="core-action-state">' + escapeHtml(actionLabel || stateLabel(status)) + '</span>' +
    '</button>';
  }

  function buildActionsMarkup(context) {
    const c = copy();
    const { source, speechJob, speechResult, translationJob, translationResult, voiceJob, voiceResult, workflow } = context;
    const renderOutput = workflow.rendered;

    return '<div class="core-actions">' +
      actionButton({ id:"import", icon:"＋", title:c.import, hint:c.importHint, enabled:true, status:source ? "complete" : "ready" }) +
      actionButton({
        id:"analyze", icon:"◇", title:c.analyze, hint:workflow.analyzed ? c.reanalyze : c.analyzeHint,
        enabled:workflow.can.analyze,
        status:workflow.analyzed ? "complete" : source?.mediaState === "failed" ? "failed" : source?.mediaState === "reading" ? "active" : "ready",
        reason:workflow.can.analyze ? "" : c.disabledNoVideo
      }) +
      actionButton({
        id:"transcribe", icon:"≋", title:c.transcribe, hint:c.transcribeHint,
        enabled:workflow.can.transcribe,
        status:actionStatus(speechJob, Boolean(speechResult)),
        reason:workflow.can.transcribe ? "" : workflow.analyzed ? c.transcribeHint : c.disabledNotAnalyzed
      }) +
      actionButton({
        id:"edit", icon:"✎", title:c.edit, hint:c.editHint,
        enabled:workflow.can.edit,
        status:workflow.can.edit ? (session.editorTouched ? "complete" : "ready") : "blocked",
        reason:workflow.can.edit ? "" : c.disabledNoTranscript
      }) +
      actionButton({
        id:"translate", icon:"文", title:c.localize, hint:c.localizeHint,
        enabled:workflow.can.translate,
        status:actionStatus(translationJob, Boolean(translationResult)),
        reason:workflow.can.translate ? "" : c.disabledNoTranscript
      }) +
      actionButton({
        id:"voice", icon:"◖", title:t("voiceWorkflow.title"), hint:t("voiceWorkflow.desc"),
        enabled:workflow.can.voice,
        status:actionStatus(voiceJob, Boolean(voiceResult)),
        reason:workflow.can.voice ? "" : c.disabledNoTranslation
      }) +
      actionButton({
        id:renderOutput ? "open-render" : "render", icon:"▶", title:renderOutput ? c.openOutput : c.render,
        hint:renderOutput ? c.rendered : c.renderHint,
        enabled:Boolean(renderOutput) || workflow.can.render,
        status:renderOutput ? "complete" : workflow.can.render ? "ready" : "blocked",
        reason:(renderOutput || workflow.can.render) ? "" : (workflow.localized ? c.disabledNoVoice : c.disabledNoTranslation),
        actionLabel:renderOutput ? c.complete : ""
      }) +
    '</div>';
  }

  function transcriptModel(context) {
    return Model.normalizeSegments(
      context.speechResult,
      context.translationResult,
      state.voice.assignments
    );
  }

  function buildTranscriptMarkup(context) {
    const c = copy();
    const segments = transcriptModel(context);
    const hasTranslation = Boolean(context.translationResult?.segments?.length);

    if (!segments.length) {
      return '<div class="core-transcript-panel"><div class="core-transcript-head"><b>' + escapeHtml(c.transcript) +
        '</b><span>0</span></div><div class="core-transcript-empty">' + escapeHtml(c.transcriptEmpty) + '</div></div>';
    }

    return '<div class="core-transcript-panel"><div class="core-transcript-head"><b>' + escapeHtml(c.transcript) + '</b><span>' +
      segments.length + ' · ' + escapeHtml(hasTranslation ? c.sourceText + " / " + c.translatedText : c.sourceText) + '</span></div>' +
      '<div class="core-transcript-list">' + segments.map(segment =>
        '<div class="core-transcript-row" data-segment-index="' + segment.index + '" data-segment-start="' + segment.start +
          '" data-segment-end="' + segment.end + '">' +
          '<time class="core-transcript-time">' + escapeHtml(Model.formatClock(segment.start)) + '</time>' +
          '<div class="core-transcript-fields ' + (hasTranslation ? "has-translation" : "") + '">' +
            '<textarea class="core-transcript-field" rows="2" data-segment-field="source" data-segment-index="' + segment.index +
              '" aria-label="' + escapeHtml(c.sourceText) + '">' + escapeHtml(segment.sourceText) + '</textarea>' +
            (hasTranslation
              ? '<textarea class="core-transcript-field" rows="2" data-segment-field="translation" data-segment-index="' + segment.index +
                '" aria-label="' + escapeHtml(c.translatedText) + '">' + escapeHtml(segment.translatedText) + '</textarea>'
              : '') +
          '</div></div>'
      ).join("") + '</div></div>';
  }

  function buildTimelineMarkup(context, duration) {
    const c = copy();
    const segments = transcriptModel(context);
    const safeDuration = Math.max(0.001, Number(duration || context.source?.meta?.duration || segments.at(-1)?.end || 0.001));

    return '<div class="core-timeline-panel"><div class="core-panel-head"><div><h4>' + escapeHtml(c.timeline) +
      '</h4></div><span class="core-player-time" data-core-timeline-time>00:00 / ' + escapeHtml(Model.formatClock(safeDuration)) + '</span></div>' +
      '<div class="core-timeline-ruler" data-core-timeline>' +
        segments.map(segment => {
          const left = Math.max(0, Math.min(100, (segment.start / safeDuration) * 100));
          const width = Math.max(.35, Math.min(100 - left, ((Math.max(segment.end, segment.start + .01) - segment.start) / safeDuration) * 100));
          return '<button class="core-timeline-segment" type="button" data-segment-index="' + segment.index +
            '" data-segment-start="' + segment.start + '" title="' + escapeHtml(Model.formatClock(segment.start)) +
            '" style="left:' + left.toFixed(4) + '%;width:' + width.toFixed(4) + '%"></button>';
        }).join("") +
        '<i class="core-timeline-playhead" data-core-playhead></i>' +
      '</div></div>';
  }

  function enhancePlayer(preview, context, snapshot) {
    const c = copy();
    const video = preview.querySelector(".preview-video");
    preview.classList.add("core-preview-stage");

    const frame = document.createElement("div");
    frame.className = "core-preview-frame";
    preview.parentNode.insertBefore(frame, preview);
    frame.appendChild(preview);

    const restoreLeft = document.createElement("button");
    restoreLeft.type = "button";
    restoreLeft.className = "core-panel-restore left";
    restoreLeft.dataset.coreExpand = "left";
    restoreLeft.title = c.expand;
    restoreLeft.textContent = "›";
    frame.appendChild(restoreLeft);

    const restoreRight = document.createElement("button");
    restoreRight.type = "button";
    restoreRight.className = "core-panel-restore right";
    restoreRight.dataset.coreExpand = "right";
    restoreRight.title = c.expand;
    restoreRight.textContent = "‹";
    frame.appendChild(restoreRight);

    if (!video) return { frame, video:null };

    video.controls = false;
    video.playsInline = true;
    video.preload = "metadata";
    video.removeAttribute("width");
    video.removeAttribute("height");
    video.style.transform = "none";

    const controls = document.createElement("div");
    controls.className = "core-player-controls";
    controls.innerHTML =
      '<button type="button" data-core-play title="' + escapeHtml(c.play) + '">▶</button>' +
      '<span class="core-player-time" data-core-current>00:00</span>' +
      '<input class="core-player-seek" data-core-seek type="range" min="0" max="0" step="0.01" value="0" aria-label="Timeline">' +
      '<span class="core-player-time" data-core-duration>00:00</span>' +
      '<button type="button" data-core-fullscreen title="' + escapeHtml(c.fullscreen) + '">⛶</button>';
    frame.appendChild(controls);

    const sourcePath = context.source?.sourcePath || null;
    const sameSource = snapshot?.sourcePath && sourcePath && snapshot.sourcePath === sourcePath;
    session.sourcePath = sourcePath;
    session.currentTime = sameSource ? Number(snapshot.currentTime || 0) : 0;
    session.duration = Number(snapshot?.duration || context.source?.meta?.duration || 0);
    session.playing = sameSource && snapshot?.playing === true;
    session.volume = sameSource ? Number(snapshot?.volume ?? 1) : 1;
    session.playbackRate = sameSource ? Number(snapshot?.playbackRate ?? 1) : 1;

    const playButton = controls.querySelector("[data-core-play]");
    const seek = controls.querySelector("[data-core-seek]");
    const current = controls.querySelector("[data-core-current]");
    const duration = controls.querySelector("[data-core-duration]");
    const fullscreen = controls.querySelector("[data-core-fullscreen]");

    const update = () => updatePlaybackUI(video, context);

    video.addEventListener("loadedmetadata", () => {
      session.duration = Number.isFinite(video.duration) ? video.duration : session.duration;
      video.volume = Math.max(0, Math.min(1, session.volume));
      video.playbackRate = session.playbackRate || 1;
      if (sameSource && session.currentTime > 0) {
        try { video.currentTime = Model.clampTime(session.currentTime, video.duration); } catch {}
      }
      update();
      if (session.playing) video.play().catch(() => { session.playing = false; update(); });
    });
    video.addEventListener("durationchange", update);
    video.addEventListener("timeupdate", update);
    video.addEventListener("play", () => { session.playing = true; update(); });
    video.addEventListener("pause", () => { session.playing = false; update(); });
    video.addEventListener("ended", () => { session.playing = false; update(); });
    video.addEventListener("ratechange", () => { session.playbackRate = video.playbackRate; });
    video.addEventListener("volumechange", () => { session.volume = video.volume; });

    playButton.addEventListener("click", () => {
      if (video.paused || video.ended) video.play().catch(() => {});
      else video.pause();
    });

    seek.addEventListener("input", () => {
      const next = Model.clampTime(seek.value, video.duration || session.duration);
      session.seekOrigin = "controls";
      try { video.currentTime = next; } catch {}
      update();
    });

    fullscreen.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === frame) await document.exitFullscreen();
        else await frame.requestFullscreen();
      } catch {}
    });

    preview.addEventListener("dblclick", async (event) => {
      if (event.target.closest(".core-player-controls")) return;
      try {
        if (document.fullscreenElement === frame) await document.exitFullscreen();
        else await frame.requestFullscreen();
      } catch {}
    });

    update();
    return { frame, video };
  }

  function updatePlaybackUI(video, context) {
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Number(context.source?.meta?.duration || session.duration || 0);
    const currentTime = Model.clampTime(video.currentTime, duration || Number.MAX_SAFE_INTEGER);
    session.duration = duration;
    session.currentTime = currentTime;
    session.playing = !video.paused && !video.ended;

    const frame = video.closest(".core-preview-frame");
    if (!frame) return;
    const seek = frame.querySelector("[data-core-seek]");
    const current = frame.querySelector("[data-core-current]");
    const durationLabel = frame.querySelector("[data-core-duration]");
    const playButton = frame.querySelector("[data-core-play]");
    if (seek) {
      seek.max = String(Math.max(0, duration));
      seek.value = String(currentTime);
      seek.disabled = !(duration > 0);
    }
    if (current) current.textContent = Model.formatClock(currentTime);
    if (durationLabel) durationLabel.textContent = Model.formatClock(duration);
    if (playButton) {
      playButton.textContent = session.playing ? "Ⅱ" : "▶";
      playButton.title = session.playing ? copy().pause : copy().play;
    }

    const root = frame.closest(".core-editor-shell");
    const timelineTime = root?.querySelector("[data-core-timeline-time]");
    if (timelineTime) timelineTime.textContent = Model.formatClock(currentTime) + " / " + Model.formatClock(duration);
    const playhead = root?.querySelector("[data-core-playhead]");
    if (playhead) playhead.style.left = (duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0) + "%";

    syncActiveTranscript(root, context, currentTime);
  }

  function syncActiveTranscript(root, context, currentTime) {
    if (!root) return;
    const segments = transcriptModel(context);
    const index = Model.findActiveSegmentIndex(segments, currentTime);
    if (index === session.activeSegmentIndex) return;
    session.activeSegmentIndex = index;

    root.querySelectorAll("[data-segment-index]").forEach(node => {
      node.classList.toggle("is-active", Number(node.dataset.segmentIndex) === index);
    });

    const row = root.querySelector('.core-transcript-row[data-segment-index="' + index + '"]');
    const editing = document.activeElement?.classList?.contains("core-transcript-field");
    if (row && !editing) row.scrollIntoView({ block:"nearest", behavior:"smooth" });
  }

  function seekTo(video, time, context, origin) {
    if (!video) return;
    const duration = video.duration || session.duration || context.source?.meta?.duration || 0;
    session.seekOrigin = origin;
    try { video.currentTime = Model.clampTime(time, duration); } catch {}
    updatePlaybackUI(video, context);
  }

  function bindTimelineAndTranscript(root, video, context) {
    root.querySelectorAll(".core-timeline-segment").forEach(node => {
      node.addEventListener("click", event => {
        event.stopPropagation();
        seekTo(video, Number(node.dataset.segmentStart || 0), context, "timeline-segment");
      });
    });

    const timeline = root.querySelector("[data-core-timeline]");
    if (timeline) {
      timeline.addEventListener("click", event => {
        if (event.target.closest(".core-timeline-segment")) return;
        const rect = timeline.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        seekTo(video, ratio * (video?.duration || session.duration || 0), context, "timeline");
      });
    }

    root.querySelectorAll(".core-transcript-row").forEach(row => {
      row.addEventListener("click", event => {
        if (event.target.closest(".core-transcript-field")) return;
        seekTo(video, Number(row.dataset.segmentStart || 0), context, "transcript");
      });
    });

    root.querySelectorAll(".core-transcript-field").forEach(field => {
      field.dataset.initialValue = field.value;
      field.addEventListener("click", event => event.stopPropagation());
      field.addEventListener("keydown", event => event.stopPropagation());
      field.addEventListener("input", () => {
        const index = Number(field.dataset.segmentIndex);
        const type = field.dataset.segmentField;
        applyTranscriptEdit(index, type, field.value, false);
        field.closest(".core-transcript-row")?.classList.add("is-edited");
      });
      field.addEventListener("blur", () => {
        if (field.value === field.dataset.initialValue) return;
        const index = Number(field.dataset.segmentIndex);
        const type = field.dataset.segmentField;
        applyTranscriptEdit(index, type, field.value, true);
      });
    });
  }

  function applyTranscriptEdit(index, type, value, finalize) {
    const source = latestSourceJob();
    if (!source || !Number.isInteger(index) || index < 0) return;
    const next = String(value || "");

    if (type === "source") {
      const result = speechResultForSource(source);
      const segment = result?.segments?.[index];
      if (!segment) return;
      segment.text = next;
      result.text = result.segments.map(item => String(item?.text || "").trim()).filter(Boolean).join(" ");
      session.editorTouched = true;

      if (finalize && state.translation.result?.sourcePath === source.sourcePath) {
        state.translation.job = null;
        state.translation.result = null;
        state.voice.job = null;
        state.voice.result = null;
        save();
        toast(copy().editingInvalidatesTranslation);
        render();
        return;
      }
    } else if (type === "translation") {
      const result = translationResultForSource(source);
      const segment = result?.segments?.[index];
      if (!segment) return;
      segment.text = next;
      session.editorTouched = true;

      if (finalize && state.voice.result?.sourcePath === source.sourcePath) {
        state.voice.job = null;
        state.voice.result = null;
        save();
        toast(copy().editingInvalidatesVoice);
        render();
        return;
      }
    }

    save();
  }

  function bindCoreActions(root, context) {
    const source = context.source;
    const action = id => root.querySelector('[data-core-action="' + id + '"]');

    action("import")?.addEventListener("click", () => addFiles());
    action("analyze")?.addEventListener("click", async () => {
      if (!source) return;
      await enrichJob(source);
    });
    action("transcribe")?.addEventListener("click", () => document.getElementById("speechStart")?.click());
    action("edit")?.addEventListener("click", () => {
      root.querySelector(".core-transcript-panel")?.scrollIntoView({ behavior:"smooth", block:"nearest" });
      root.querySelector(".core-transcript-field")?.focus();
    });
    action("translate")?.addEventListener("click", () => document.getElementById("translationStart")?.click());
    action("voice")?.addEventListener("click", () => document.getElementById("voiceStart")?.click());
    action("render")?.addEventListener("click", () => startLocalizedRender());
    action("open-render")?.addEventListener("click", () => {
      const filePath = context.workflow.rendered?.outputPath;
      if (filePath) window.desktopAPI?.showFile?.(filePath);
    });

    root.querySelectorAll("[data-core-collapse]").forEach(button => {
      button.addEventListener("click", () => {
        const side = button.dataset.coreCollapse;
        if (side === "left") prefs.leftCollapsed = true;
        if (side === "right") prefs.rightCollapsed = true;
        persistPrefs();
        root.classList.toggle("left-collapsed", prefs.leftCollapsed === true);
        root.classList.toggle("right-collapsed", prefs.rightCollapsed === true);
      });
    });
    root.querySelectorAll("[data-core-expand]").forEach(button => {
      button.addEventListener("click", () => {
        const side = button.dataset.coreExpand;
        if (side === "left") prefs.leftCollapsed = false;
        if (side === "right") prefs.rightCollapsed = false;
        persistPrefs();
        root.classList.toggle("left-collapsed", prefs.leftCollapsed === true);
        root.classList.toggle("right-collapsed", prefs.rightCollapsed === true);
      });
    });
  }

  function gateOriginalCoreControls(context) {
    const speech = document.getElementById("speechStart");
    if (speech) {
      speech.disabled = !context.workflow.can.transcribe;
      if (speech.disabled) speech.title = context.workflow.analyzed ? copy().transcribeHint : copy().disabledNotAnalyzed;
    }
    const translation = document.getElementById("translationStart");
    if (translation) {
      translation.disabled = !context.workflow.can.translate;
      if (translation.disabled) translation.title = copy().disabledNoTranscript;
    }
    const voice = document.getElementById("voiceStart");
    if (voice) {
      voice.disabled = !context.workflow.can.voice;
      if (voice.disabled) voice.title = copy().disabledNoTranslation;
    }
    const renderButton = document.getElementById("render");
    if (renderButton) {
      renderButton.disabled = !context.workflow.can.render;
      if (renderButton.disabled) renderButton.title = context.workflow.localized ? copy().disabledNoVoice : copy().disabledNoTranslation;
    }
  }

  function refreshCoreStatus() {
    if (state.page !== "ai-video") return;
    const root = document.querySelector(".core-editor-shell");
    if (!root) return;
    const context = workflowContext();
    gateOriginalCoreControls(context);

    context.workflow.steps.forEach(step => {
      const node = root.querySelector('[data-core-step="' + step.id + '"]');
      if (!node) return;
      node.className = "core-workflow-step " + step.status;
      const label = node.querySelector(".step-state");
      if (label) label.textContent = stateLabel(step.status);
    });
  }

  function enhanceAiVideo(snapshot) {
    if (state.page !== "ai-video") return;
    const page = document.getElementById("page");
    if (!page || page.querySelector(".core-editor-shell")) return;

    const context = workflowContext();
    const oldWorkflow = page.querySelector(".workflow");
    const oldEditorGrid = page.querySelector(".editor-grid");
    const preview = oldEditorGrid?.querySelector(".preview");
    const propertiesStack = oldEditorGrid?.querySelector(".stack");
    if (!oldEditorGrid || !preview || !propertiesStack) return;

    page.classList.add("core-product-page");

    const oldWorkflowHead = oldWorkflow?.previousElementSibling;
    const oldEditorHead = oldEditorGrid.previousElementSibling;
    oldWorkflow?.classList.add("core-source-hidden");
    oldWorkflowHead?.classList.add("core-source-hidden");
    oldEditorHead?.classList.add("core-source-hidden");
    oldEditorGrid.classList.add("core-source-hidden");

    const shell = document.createElement("section");
    shell.className = "core-editor-shell" +
      (prefs.leftCollapsed ? " left-collapsed" : "") +
      (prefs.rightCollapsed ? " right-collapsed" : "");

    const left = document.createElement("aside");
    left.className = "core-left-panel";
    left.innerHTML =
      '<div class="core-panel-head"><div><h3>' + escapeHtml(copy().workflow) + '</h3></div>' +
        '<button class="core-collapse-button" type="button" data-core-collapse="left" title="' + escapeHtml(copy().collapse) + '">‹</button></div>' +
      '<div data-core-workflow>' + buildWorkflowMarkup(context.workflow) + '</div>' +
      '<div class="core-panel-head"><div><h4>' + escapeHtml(copy().asset) + '</h4></div></div>' +
      '<div data-core-asset>' + buildAssetMarkup(context.source) + '</div>';

    const center = document.createElement("main");
    center.className = "core-center-panel";
    const previewSlot = document.createElement("div");
    previewSlot.className = "core-preview-slot";
    center.appendChild(previewSlot);
    previewSlot.appendChild(preview);

    const durationGuess = Number(context.source?.meta?.duration || snapshot?.duration || 0);
    const timelineWrap = document.createElement("div");
    timelineWrap.innerHTML = buildTimelineMarkup(context, durationGuess);
    center.appendChild(timelineWrap.firstElementChild);

    const transcriptWrap = document.createElement("div");
    transcriptWrap.innerHTML = buildTranscriptMarkup(context);
    center.appendChild(transcriptWrap.firstElementChild);

    const right = document.createElement("aside");
    right.className = "core-right-panel";
    right.innerHTML =
      '<div class="core-panel-head"><div><h3>' + escapeHtml(copy().actions) + '</h3></div>' +
        '<button class="core-collapse-button" type="button" data-core-collapse="right" title="' + escapeHtml(copy().collapse) + '">›</button></div>' +
      '<div data-core-actions>' + buildActionsMarkup(context) + '</div>' +
      '<div class="core-panel-head"><div><h4>' + escapeHtml(copy().properties) + '</h4></div></div>';

    const properties = document.createElement("div");
    properties.className = "core-properties-stack";
    properties.appendChild(propertiesStack);
    right.appendChild(properties);

    const advanced = document.createElement("details");
    advanced.className = "core-advanced-services";
    advanced.innerHTML = '<summary>' + escapeHtml(copy().advanced) + '</summary><div class="core-advanced-services-body"></div>';
    const advancedBody = advanced.querySelector(".core-advanced-services-body");
    page.querySelectorAll(".speech-card").forEach(card => advancedBody.appendChild(card));
    right.appendChild(advanced);

    shell.append(left, center, right);
    page.insertBefore(shell, page.firstChild);

    const player = enhancePlayer(preview, context, snapshot || session);
    bindTimelineAndTranscript(shell, player.video, context);
    bindCoreActions(shell, context);
    gateOriginalCoreControls(context);
    if (player.video) updatePlaybackUI(player.video, context);
  }

  const baseRender = render;
  render = function coreRenderWrapper() {
    const snapshot = capturePlayback();
    baseRender();
    enhanceAiVideo(snapshot);
  };

  enhanceAiVideo(capturePlayback());
  setInterval(refreshCoreStatus, 500);
})();
