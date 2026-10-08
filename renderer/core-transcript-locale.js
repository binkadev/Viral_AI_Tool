(function registerCoreTranscriptLocale() {
  "use strict";

  const messages = window.I18N?.messages;
  if (!messages?.vi?.speech || !messages?.en?.speech) return;

  Object.assign(messages.vi.speech, {
    workstationSource: "Nguồn",
    workstationTranslation: "Bản dịch",
    workstationSegments: "phân đoạn",
    workstationEmptyTranslation: "Chưa có bản dịch"
  });

  Object.assign(messages.en.speech, {
    workstationSource: "Source",
    workstationTranslation: "Translation",
    workstationSegments: "segments",
    workstationEmptyTranslation: "No translation yet"
  });
})();
