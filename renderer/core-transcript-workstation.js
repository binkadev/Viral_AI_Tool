(function installCoreTranscriptWorkstation() {
  "use strict";

  const model = window.ViralCoreTranscriptModel;
  if (!model) return;

  const VIEW_KEY = "viral-ai-core-transcript-view";
  const VALID_VIEWS = new Set(["source", "translation"]);
  let scheduled = 0;

  function appState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch {
      return null;
    }
  }

  function locale() {
    const current = appState();
    if (current?.locale === "en") return "en";
    return document.documentElement.lang === "en" ? "en" : "vi";
  }

  function tr(key, vars) {
    try {
      if (typeof t === "function") return t(key, vars);
    } catch {}
    try {
      return window.I18N?.t?.(locale(), key, vars) || key;
    } catch {
      return key;
    }
  }

  function storedView() {
    const value = localStorage.getItem(VIEW_KEY) || "source";
    return VALID_VIEWS.has(value) ? value : "source";
  }

  function setStoredView(value) {
    if (!VALID_VIEWS.has(value)) return;
    localStorage.setItem(VIEW_KEY, value);
  }

  function isStale(value) {
    return String(value?.status || value?.state || "").toLowerCase() === "stale";
  }

  function latestSourcePath(current, source) {
    if (source?.sourcePath) return String(source.sourcePath);
    const jobs = Array.isArray(current?.jobs) ? current.jobs : [];
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      const job = jobs[index];
      if (!job?.isRenderOutput && job?.sourcePath) return String(job.sourcePath);
    }
    return null;
  }

  function translationForContext(current, source) {
    const result = current?.translation?.result || null;
    if (!result) return null;

    const sourcePath = latestSourcePath(current, source);
    if (sourcePath && String(result?.sourcePath || "") !== sourcePath) return null;

    const activeTarget = String(current?.translation?.targetLanguage || "");
    const resultTarget = String(result?.targetLanguage || "");
    if (activeTarget && resultTarget !== activeTarget) return null;

    return result;
  }

  function translationSegments(result) {
    return Array.isArray(result?.segments) ? result.segments : [];
  }

  function translatedTextFor(segment, index, translation) {
    if (!translation) return "";
    const list = translationSegments(translation);
    const byId = list.find(item => String(item?.id || "") === String(segment.id));
    const candidate = byId || list[index] || null;
    return String(
      candidate?.translatedText ??
      candidate?.translated ??
      candidate?.text ??
      ""
    );
  }

  function formatTimestamp(value) {
    const total = Math.max(0, Number(value) || 0);
    const whole = Math.floor(total);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = whole % 60;
    const two = number => String(number).padStart(2, "0");
    return hours > 0
      ? [two(hours), two(minutes), two(seconds)].join(":")
      : [two(minutes), two(seconds)].join(":");
  }

  function transcriptDuration(source) {
    const explicit = Number(source?.duration || 0);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const segments = Array.isArray(source?.segments) ? source.segments : [];
    return segments.reduce((max, segment) => Math.max(max, Number(segment?.end || 0)), 0);
  }

  function transcriptContext() {
    const current = appState();
    if (!current?.speech?.result) return null;
    const source = model.normalizeDocument(current.speech.result);
    if (!source.segments.length) return null;
    const translation = translationForContext(current, source);
    const translated = source.segments.map((segment, index) => translatedTextFor(segment, index, translation));
    return {
      source,
      translation,
      translated,
      translationAvailable: Boolean(translation) && translated.some(text => text.trim().length > 0),
      translationStale: isStale(translation)
    };
  }

  function signatureOf(context, view) {
    const segments = context.source.segments;
    const textSignature = segments.map(segment => [segment.id, segment.start, segment.end, segment.sourceText].join("~")).join("|");
    const translationSignature = context.translated.join("|");
    return [
      view,
      context.source.editedAt || "",
      context.translation?.targetLanguage || "",
      context.translation?.staleAt || "",
      context.translationStale ? "stale" : "fresh",
      textSignature,
      translationSignature
    ].join("::");
  }

  function toolbarSignature(context, view) {
    return [
      locale(),
      view,
      context.source.segments.length,
      context.translation?.targetLanguage || "",
      context.translationAvailable ? "translated" : "source-only",
      context.translationStale ? "stale" : "fresh"
    ].join("|");
  }

  function ensureToolbar(result, context, view) {
    let toolbar = result.querySelector(".core-transcript-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "core-transcript-toolbar";
      const head = result.querySelector(".speech-result-head");
      if (head?.nextSibling) result.insertBefore(toolbar, head.nextSibling);
      else if (head) head.insertAdjacentElement("afterend", toolbar);
      else result.prepend(toolbar);
    }

    const signature = toolbarSignature(context, view);
    if (toolbar.dataset.workstationSignature === signature) return;
    toolbar.dataset.workstationSignature = signature;
    toolbar.replaceChildren();

    const switcher = document.createElement("div");
    switcher.className = "core-transcript-view-switcher";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", tr("speech.resultTitle"));

    ["source", "translation"].forEach(mode => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "core-transcript-view-button";
      button.dataset.transcriptView = mode;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", mode === view ? "true" : "false");
      button.classList.toggle("is-active", mode === view);
      button.textContent = mode === "source" ? tr("speech.resultTitle") : tr("translation.resultTitle");
      if (mode === "translation" && !context.translationAvailable) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      button.addEventListener("click", () => {
        if (button.disabled) return;
        setStoredView(mode);
        schedule();
      });
      switcher.appendChild(button);
    });

    const meta = document.createElement("div");
    meta.className = "core-transcript-meta";
    const count = document.createElement("span");
    count.textContent = tr("speech.resultDesc", {
      count: context.source.segments.length,
      duration: formatTimestamp(transcriptDuration(context.source))
    });
    meta.appendChild(count);
    if (context.translationStale) {
      const stale = document.createElement("span");
      stale.className = "core-transcript-stale";
      stale.textContent = tr("translation.translateAgain");
      stale.setAttribute("aria-label", tr("translation.translateAgain"));
      meta.appendChild(stale);
    }

    toolbar.append(switcher, meta);
  }

  function makeRow(segment, translatedText, view) {
    const row = document.createElement("div");
    row.className = "transcript-row core-transcript-row";
    row.dataset.segmentId = String(segment.id);
    row.dataset.start = String(segment.start);
    row.dataset.end = String(segment.end);
    row.dataset.translatedText = translatedText;
    row.dataset.status = String(segment.status || "ready");
    if (segment.speaker) row.dataset.speaker = String(segment.speaker);
    if (segment.voice) row.dataset.voice = String(segment.voice);
    row.dataset.transcriptView = view;

    const time = document.createElement("time");
    time.className = "core-transcript-time";
    time.dateTime = "PT" + Number(segment.start || 0).toFixed(3) + "S";
    time.textContent = formatTimestamp(segment.start);
    time.title = formatTimestamp(segment.start) + " – " + formatTimestamp(segment.end);

    const content = document.createElement("div");
    content.className = "core-transcript-content";

    const source = document.createElement("p");
    source.className = "core-transcript-source";
    source.textContent = String(segment.sourceText ?? segment.text ?? "");
    source.setAttribute("aria-label", tr("speech.resultTitle"));
    source.hidden = view === "translation";

    const translation = document.createElement("div");
    translation.className = "core-transcript-translation";
    translation.textContent = translatedText || "—";
    translation.setAttribute("aria-label", tr("translation.resultTitle"));
    translation.hidden = view !== "translation";

    content.append(source, translation);
    row.append(time, content);
    return row;
  }

  function wireSourceClickSeek(list) {
    if (list.dataset.sourceSeekWired === "true") return;
    list.dataset.sourceSeekWired = "true";
    list.addEventListener("pointerdown", event => {
      const source = event.target instanceof Element ? event.target.closest(".core-transcript-source") : null;
      if (!(source instanceof HTMLElement) || document.activeElement === source) return;
      const row = source.closest(".transcript-row");
      if (!row) return;
      const currentTime = Number(row.dataset.start || 0);
      if (!Number.isFinite(currentTime)) return;
      window.dispatchEvent(new CustomEvent("viral-ai:player-seek", {
        detail: { currentTime, source: "transcript-source" }
      }));
    }, true);
  }

  function renderRows(result, context, view) {
    let list = result.querySelector(".transcript-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "transcript-list";
      result.appendChild(list);
    }

    const signature = signatureOf(context, view);
    if (list.dataset.workstationSignature === signature) return;
    const scrollTop = list.scrollTop;
    const activeId = list.querySelector(".transcript-row.is-active")?.dataset.segmentId || null;
    const fragment = document.createDocumentFragment();
    context.source.segments.forEach((segment, index) => {
      fragment.appendChild(makeRow(segment, context.translated[index], view));
    });
    list.replaceChildren(fragment);
    list.dataset.workstationSignature = signature;
    list.dataset.transcriptCount = String(context.source.segments.length);
    list.dataset.longTranscript = context.source.segments.length >= 100 ? "true" : "false";
    wireSourceClickSeek(list);

    if (activeId) {
      const active = Array.from(list.querySelectorAll(".transcript-row")).find(row => row.dataset.segmentId === activeId);
      active?.classList.add("is-active");
      active?.setAttribute("aria-current", "true");
    }
    list.scrollTop = scrollTop;
  }

  function hydrate() {
    const context = transcriptContext();
    const result = document.querySelector(".speech-result");
    if (!context || !(result instanceof HTMLElement)) return;

    result.classList.add("core-transcript-workstation");
    let view = storedView();
    if (view === "translation" && !context.translationAvailable) {
      view = "source";
      setStoredView(view);
    }
    result.dataset.transcriptView = view;
    result.dataset.translationState = context.translationStale ? "stale" : context.translationAvailable ? "ready" : "empty";
    ensureToolbar(result, context, view);
    renderRows(result, context, view);
  }

  function schedule() {
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      hydrate();
    });
  }

  function start() {
    const page = document.getElementById("page");
    if (page) {
      const observer = new MutationObserver(schedule);
      observer.observe(page, { childList: true, subtree: true });
    }
    window.addEventListener("viral-ai:core-state-changed", schedule);
    schedule();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
