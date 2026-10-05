(function () {
  "use strict";

  const Model = globalThis.CoreEditorModel;
  if (!Model) return;

  let lastPlaybackKey = "";

  function currentSource() {
    try { return latestSourceJob?.() || null; } catch { return null; }
  }

  function markRenderedOutputsStale(sourcePath) {
    if (!sourcePath || !Array.isArray(state?.jobs)) return;
    for (const job of state.jobs) {
      if (
        job?.isRenderOutput === true &&
        job?.sourcePath === sourcePath &&
        String(job?.status || "") === "completed"
      ) {
        job.stale = true;
      }
    }
  }

  function label(textVi, textEn) {
    return state?.locale === "vi" ? textVi : textEn;
  }

  function setActionState(root, id, {
    disabled,
    stateText,
    statusClass,
    reason
  } = {}) {
    const button = root?.querySelector('[data-core-action="' + id + '"]');
    if (!button) return;

    if (typeof disabled === "boolean") button.disabled = disabled;
    if (reason) button.title = reason;

    if (statusClass) {
      button.classList.remove("ready", "active", "complete", "failed", "blocked", "stale");
      button.classList.add(statusClass);
    }

    const stateNode = button.querySelector(".core-action-state");
    if (stateNode && stateText) stateNode.textContent = stateText;
  }

  function setWorkflowState(root, id, status, text) {
    const step = root?.querySelector('[data-core-step="' + id + '"]');
    if (!step) return;
    step.classList.remove("ready", "active", "complete", "failed", "blocked", "stale");
    step.classList.add(status);
    const stateNode = step.querySelector(".step-state");
    if (stateNode) stateNode.textContent = text;
  }

  function showStaleNotice(root, kind) {
    const transcript = root?.querySelector(".core-transcript-panel");
    if (!transcript) return;

    let notice = transcript.querySelector(".core-stale-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "core-stale-notice";
      transcript.insertBefore(notice, transcript.children[1] || null);
    }

    notice.textContent = kind === "source"
      ? label(
          "Transcript đã thay đổi. Hãy chạy Localize lại trước khi tạo giọng hoặc render.",
          "Transcript changed. Run Localize again before voice generation or render."
        )
      : label(
          "Bản dịch đã thay đổi. Hãy tạo lại giọng trước khi render.",
          "Translation changed. Regenerate voice before render."
        );
  }

  function refreshAfterSourceEdit(source) {
    const root = document.querySelector(".core-editor-shell");
    if (!root || !source) return;

    setWorkflowState(root, "localize", "stale", label("Cần cập nhật", "Needs update"));
    setWorkflowState(root, "render", "stale", label("Cần cập nhật", "Needs update"));

    setActionState(root, "translate", {
      disabled: false,
      statusClass: "ready",
      stateText: label("Chạy lại", "Run again"),
      reason: label("Transcript đã thay đổi. Hãy dịch lại.", "Transcript changed. Translate again.")
    });
    setActionState(root, "voice", {
      disabled: true,
      statusClass: "blocked",
      stateText: label("Chưa mở", "Locked"),
      reason: label("Cần bản dịch mới trước khi tạo giọng.", "A fresh translation is required before voice generation.")
    });
    setActionState(root, "render", {
      disabled: true,
      statusClass: "blocked",
      stateText: label("Chưa mở", "Locked"),
      reason: label("Cần dịch và giọng mới trước khi render.", "Fresh translation and voice are required before render.")
    });
    setActionState(root, "open-render", {
      disabled: true,
      statusClass: "stale",
      stateText: label("Đã cũ", "Stale"),
      reason: label("Output cũ không còn khớp transcript hiện tại.", "The old output no longer matches the current transcript.")
    });

    root.querySelectorAll('[data-segment-field="translation"]').forEach(field => {
      field.disabled = true;
      field.title = label("Transcript đã đổi. Hãy Localize lại.", "Transcript changed. Run Localize again.");
    });
    root.querySelector(".core-transcript-panel")?.classList.add("is-downstream-stale");
    showStaleNotice(root, "source");
  }

  function refreshAfterTranslationEdit(source) {
    const root = document.querySelector(".core-editor-shell");
    if (!root || !source) return;

    setWorkflowState(root, "render", "stale", label("Cần cập nhật", "Needs update"));
    setActionState(root, "voice", {
      disabled: false,
      statusClass: "ready",
      stateText: label("Chạy lại", "Run again"),
      reason: label("Bản dịch đã thay đổi. Hãy tạo lại giọng.", "Translation changed. Regenerate voice.")
    });
    setActionState(root, "render", {
      disabled: true,
      statusClass: "blocked",
      stateText: label("Chưa mở", "Locked"),
      reason: label("Cần tạo lại giọng trước khi render.", "Regenerate voice before render.")
    });
    setActionState(root, "open-render", {
      disabled: true,
      statusClass: "stale",
      stateText: label("Đã cũ", "Stale"),
      reason: label("Output cũ không còn khớp bản dịch hiện tại.", "The old output no longer matches the current translation.")
    });
    showStaleNotice(root, "translation");
  }

  function invalidateDownstream(field) {
    const source = currentSource();
    if (!source) return;

    const type = field.dataset.segmentField;
    if (type === "source") {
      const hadTranslation = state.translation?.result?.sourcePath === source.sourcePath;
      const hadVoice = state.voice?.result?.sourcePath === source.sourcePath;

      if (hadTranslation) {
        state.translation.job = null;
        state.translation.result = null;
      }
      if (hadVoice) {
        state.voice.job = null;
        state.voice.result = null;
      }
      markRenderedOutputsStale(source.sourcePath);
      save();
      refreshAfterSourceEdit(source);
      if (hadTranslation || hadVoice) {
        toast(label(
          "Transcript đã thay đổi. Bản dịch, giọng và output cũ cần cập nhật.",
          "Transcript changed. Translation, voice and previous output need updating."
        ));
      }
      return;
    }

    if (type === "translation") {
      const hadVoice = state.voice?.result?.sourcePath === source.sourcePath;
      if (hadVoice) {
        state.voice.job = null;
        state.voice.result = null;
      }
      markRenderedOutputsStale(source.sourcePath);
      save();
      refreshAfterTranslationEdit(source);
      if (hadVoice) {
        toast(label(
          "Bản dịch đã thay đổi. Giọng và output cũ cần cập nhật.",
          "Translation changed. Voice and previous output need updating."
        ));
      }
    }
  }

  // The original core editor used render() on transcript blur to invalidate
  // downstream results. That recreated the <video> element and could reset
  // playback. Intercept blur before the target handler, invalidate data in-place,
  // and keep the current player element/time untouched.
  document.addEventListener("blur", event => {
    const field = event.target?.closest?.(".core-transcript-field");
    if (!field) return;
    if (field.value === field.dataset.initialValue) return;

    event.stopImmediatePropagation();
    invalidateDownstream(field);
    field.dataset.initialValue = field.value;
  }, true);

  function playbackSyncTick() {
    const root = document.querySelector(".core-editor-shell");
    const video = root?.querySelector(".preview-video");
    if (!root || !video) {
      lastPlaybackKey = "";
      return;
    }

    const source = currentSource();
    let speechResult = null;
    try { speechResult = speechResultForSource(source); } catch {}
    const segments = Model.normalizeSegments(speechResult, null, null);
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const activeIndex = Model.findActiveSegmentIndex(segments, currentTime);
    const key = String(source?.sourcePath || "") + ":" + activeIndex;

    root.querySelectorAll(".core-transcript-row, .core-timeline-segment").forEach(node => {
      node.classList.toggle("is-active", Number(node.dataset.segmentIndex) === activeIndex && activeIndex >= 0);
    });

    if (key !== lastPlaybackKey) {
      lastPlaybackKey = key;
      const editing = document.activeElement?.classList?.contains("core-transcript-field");
      const row = activeIndex >= 0
        ? root.querySelector('.core-transcript-row[data-segment-index="' + activeIndex + '"]')
        : null;
      if (row && !editing) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // A low-cost guard complements native timeupdate. It fixes source-switch cases
  // where the new source happens to have the same active segment index as the old
  // one, without creating a second playback clock or changing video.currentTime.
  setInterval(playbackSyncTick, 160);
})();
