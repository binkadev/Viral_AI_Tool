(function installCoreTranscriptWorkstation() {
  "use strict";

  const page = document.getElementById("page");
  if (!page) return;

  let pending = false;
  let lastSignature = "";
  let renderGeneration = 0;

  function appState() {
    try {
      return typeof state !== "undefined" ? state : null;
    } catch {
      return null;
    }
  }

  function localeCopy() {
    const locale = document.documentElement.lang === "en" ? "en" : "vi";
    const tr = key => window.I18N?.t?.(locale, key) || key;
    return {
      source: tr("speech.workstationSource"),
      translation: tr("speech.workstationTranslation"),
      segments: tr("speech.workstationSegments"),
      empty: tr("speech.workstationEmptyTranslation")
    };
  }

  function finiteTime(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function formatTime(value) {
    const seconds = finiteTime(value);
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    const pad = number => String(number).padStart(2, "0");
    return hours > 0 ? pad(hours) + ":" + pad(minutes) + ":" + pad(secs) : pad(minutes) + ":" + pad(secs);
  }

  function translationLookup(current, speechResult) {
    const translation = current?.translation?.result;
    if (!translation || !Array.isArray(translation.segments)) return new Map();
    if (speechResult?.sourcePath && translation.sourcePath && String(translation.sourcePath) !== String(speechResult.sourcePath)) {
      return new Map();
    }

    const map = new Map();
    translation.segments.forEach((segment, index) => {
      const id = segment?.id != null ? String(segment.id) : "";
      const start = finiteTime(segment?.start).toFixed(3);
      const text = String(segment?.translatedText ?? segment?.text ?? "");
      if (id) map.set("id:" + id, text);
      map.set("start:" + start, text);
      map.set("index:" + index, text);
    });
    return map;
  }

  function translatedTextFor(segment, index, translations) {
    const id = segment?.id != null ? String(segment.id) : "";
    const start = finiteTime(segment?.start).toFixed(3);
    const idKey = id ? "id:" + id : "";
    const startKey = "start:" + start;
    const indexKey = "index:" + index;

    if (idKey && translations.has(idKey)) return String(translations.get(idKey) ?? "");
    if (translations.has(startKey)) return String(translations.get(startKey) ?? "");
    if (translations.has(indexKey)) return String(translations.get(indexKey) ?? "");
    return String(segment?.translatedText ?? "");
  }

  function documentSignature(result, translations) {
    const segments = Array.isArray(result?.segments) ? result.segments : [];
    return [String(result?.sourcePath || ""), segments.length]
      .concat(segments.map((segment, index) => [
        String(segment?.id ?? index),
        finiteTime(segment?.start).toFixed(3),
        finiteTime(segment?.end).toFixed(3),
        String(segment?.sourceText ?? segment?.text ?? ""),
        translatedTextFor(segment, index, translations),
        String(segment?.speaker || ""),
        String(segment?.voice || ""),
        String(segment?.status || "")
      ].join("\u001f")))
      .join("\u001e");
  }

  function makeCellLabel(text) {
    const label = document.createElement("span");
    label.className = "core-transcript-cell-label";
    label.textContent = text;
    return label;
  }

  function makeRow(segment, index, translatedText, copy) {
    const row = document.createElement("div");
    row.className = "transcript-row core-transcript-row";
    row.dataset.segmentId = String(segment?.id ?? ("segment-" + (index + 1)));
    row.dataset.start = String(finiteTime(segment?.start));
    row.dataset.end = String(Math.max(finiteTime(segment?.end), finiteTime(segment?.start)));
    row.dataset.translatedText = translatedText;
    if (segment?.speaker) row.dataset.speaker = String(segment.speaker);
    if (segment?.voice) row.dataset.voice = String(segment.voice);
    row.dataset.status = String(segment?.status || "ready");

    const time = document.createElement("time");
    time.className = "core-transcript-time";
    time.dateTime = "PT" + finiteTime(segment?.start) + "S";
    time.textContent = formatTime(segment?.start) + " – " + formatTime(segment?.end);
    time.title = finiteTime(segment?.start).toFixed(3) + "s – " + finiteTime(segment?.end).toFixed(3) + "s";

    const sourceCell = document.createElement("div");
    sourceCell.className = "core-transcript-cell core-transcript-source";
    sourceCell.appendChild(makeCellLabel(copy.source));
    const sourceText = document.createElement("p");
    sourceText.textContent = String(segment?.sourceText ?? segment?.text ?? "");
    sourceCell.appendChild(sourceText);

    const translationCell = document.createElement("div");
    translationCell.className = "core-transcript-cell core-transcript-translation";
    translationCell.appendChild(makeCellLabel(copy.translation));
    const translationText = document.createElement("div");
    translationText.className = "core-transcript-translation-text";
    translationText.textContent = translatedText || copy.empty;
    translationText.classList.toggle("is-empty", !translatedText);
    translationCell.appendChild(translationText);

    row.append(time, sourceCell, translationCell);
    return row;
  }

  function ensureHeader(result, count, copy) {
    const resultHead = result.querySelector(".speech-result-head");
    let header = result.querySelector(".core-transcript-workstation-head");
    if (!header) {
      header = document.createElement("div");
      header.className = "core-transcript-workstation-head";
      header.innerHTML = '<div class="core-transcript-column-title" data-column="time">#</div>' +
        '<div class="core-transcript-column-title" data-column="source"></div>' +
        '<div class="core-transcript-column-title" data-column="translation"></div>' +
        '<div class="core-transcript-count"></div>';
      if (resultHead?.nextSibling) result.insertBefore(header, resultHead.nextSibling);
      else result.prepend(header);
    }
    const source = header.querySelector('[data-column="source"]');
    const translation = header.querySelector('[data-column="translation"]');
    const countNode = header.querySelector(".core-transcript-count");
    if (source) source.textContent = copy.source;
    if (translation) translation.textContent = copy.translation;
    if (countNode) countNode.textContent = count + " " + copy.segments;
  }

  function projectTranscript() {
    const resultElement = page.querySelector(".speech-result");
    const list = resultElement?.querySelector(".transcript-list");
    if (!(resultElement instanceof HTMLElement) || !(list instanceof HTMLElement)) {
      lastSignature = "";
      return;
    }

    if (list.contains(document.activeElement)) return;

    const current = appState();
    const result = current?.speech?.result;
    const segments = Array.isArray(result?.segments) ? result.segments : [];
    if (!segments.length) return;

    const translations = translationLookup(current, result);
    const signature = documentSignature(result, translations);
    const copy = localeCopy();
    ensureHeader(resultElement, segments.length, copy);

    if (signature === lastSignature && Number(list.dataset.coreTranscriptCount || 0) === segments.length) return;

    const fragment = document.createDocumentFragment();
    segments.forEach((segment, index) => {
      fragment.appendChild(makeRow(segment, index, translatedTextFor(segment, index, translations), copy));
    });
    list.replaceChildren(fragment);
    list.dataset.coreTranscriptCount = String(segments.length);
    list.dataset.coreTranscriptGeneration = String(++renderGeneration);
    list.setAttribute("data-core-transcript-workstation", "ready");
    lastSignature = signature;

    window.dispatchEvent(new CustomEvent("viral-ai:transcript-workstation-ready", {
      detail: {
        count: segments.length,
        sourcePath: result?.sourcePath || null,
        generation: renderGeneration
      }
    }));
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      projectTranscript();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(page, { childList: true, subtree: true });
  window.addEventListener("viral-ai:core-state-changed", schedule);
  window.addEventListener("languagechange", schedule);
  schedule();
})();
