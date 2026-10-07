(function installCoreLibraryOutputRecovery() {
  "use strict";

  let legacyMissingDialog = null;

  function install() {
    try {
      if (typeof showMissingFileDialog !== "function") return false;
      if (showMissingFileDialog.__coreOutputRecovery === true) return true;
      legacyMissingDialog = showMissingFileDialog;

      const replacement = function coreMissingFileDialog(job) {
        if (!job?.isRenderOutput) return legacyMissingDialog(job);

        const root = document.getElementById("modal");
        if (!root) return;
        const source = state.jobs.find(item => !item?.isRenderOutput && item?.sourcePath === job.sourcePath) || null;
        const canRerender = Boolean(source) && source.fileState !== "missing" && source.fileState !== "trashed";

        root.classList.remove("hidden");
        root.innerHTML =
          '<div class="modal commercial-modal missing-file-modal">' +
            '<div class="modal-icon warning">!</div>' +
            '<h3>' + escapeHtml(t("file.missingTitle")) + '</h3>' +
            '<p>' + escapeHtml(t("file.missingBody", { name: job.name })) + '</p>' +
            '<div class="missing-file-name">' + escapeHtml(job.name) + '</div>' +
            (!canRerender
              ? '<div class="speech-alert warning"><span>' + escapeHtml(t("export.retrySourceMissing")) + '</span></div>'
              : '') +
            '<div class="modal-actions split-actions">' +
              '<button id="missingClose" class="button ghost" type="button">' + escapeHtml(t("common.close")) + '</button>' +
              '<button id="missingRemove" class="button ghost" type="button">' + escapeHtml(t("file.removeLibrary")) + '</button>' +
              '<button id="missingRerender" class="button primary" type="button"' + (canRerender ? '' : ' disabled') + '>' + escapeHtml(t("export.retry")) + '</button>' +
            '</div>' +
          '</div>';

        const close = document.getElementById("missingClose");
        if (close) close.onclick = () => root.classList.add("hidden");

        const remove = document.getElementById("missingRemove");
        if (remove) remove.onclick = () => {
          root.classList.add("hidden");
          if (typeof removeJobFromLibrary === "function") removeJobFromLibrary(job);
        };

        const rerender = document.getElementById("missingRerender");
        if (rerender instanceof HTMLButtonElement && canRerender) {
          rerender.onclick = async () => {
            root.classList.add("hidden");
            if (job.localized && typeof startLocalizedRender === "function") return startLocalizedRender(source);
            if (typeof startRealRender === "function") return startRealRender(source);
          };
        }
      };

      replacement.__coreOutputRecovery = true;
      showMissingFileDialog = replacement;
      document.documentElement.dataset.coreLibraryOutputRecovery = "enabled";
      return true;
    } catch {
      return false;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
  else install();
})();
