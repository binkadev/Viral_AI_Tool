(function loadCoreEditorOutputStateV2() {
  "use strict";
  if (window.__coreOutputStateV2Loading) return;
  window.__coreOutputStateV2Loading = true;

  const existing = document.querySelector('script[src="core-editor-output-state-v2.js"]');
  if (existing) return;

  const script = document.createElement("script");
  script.src = "core-editor-output-state-v2.js";
  script.async = false;
  script.dataset.coreOutputStateLoader = "v2";
  document.body.appendChild(script);
})();
