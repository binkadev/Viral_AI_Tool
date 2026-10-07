(function installCoreExportFolderRecovery() {
  "use strict";

  let legacy = null;

  function install() {
    try {
      if (typeof handleExportBlock !== "function") return false;
      if (handleExportBlock.__coreFolderRecovery === true) return true;
      legacy = handleExportBlock;

      const replacement = async function coreHandleExportBlock(response, source) {
        const code = response?.error?.code || "PROCESSING_FAILED";
        if (!["OUTPUT_UNAVAILABLE", "OUTPUT_REQUIRED"].includes(code)) {
          return legacy(response, source);
        }

        const root = document.getElementById("modal");
        if (!root) return legacy(response, source);
        root.classList.remove("hidden");
        root.innerHTML =
          '<div class="modal commercial-modal">' +
            '<div class="modal-icon warning">!</div>' +
            '<h3>' + escapeHtml(t("export.folderTitle")) + '</h3>' +
            '<p>' + escapeHtml(t("export.folderBody")) + '</p>' +
            '<div class="modal-actions">' +
              '<button id="outputFolderCancel" class="button ghost" type="button">' + escapeHtml(t("common.cancel")) + '</button>' +
              '<button id="outputFolderChoose" class="button primary" type="button">' + escapeHtml(t("common.choose")) + '</button>' +
            '</div>' +
          '</div>';

        const cancel = document.getElementById("outputFolderCancel");
        if (cancel) cancel.onclick = () => root.classList.add("hidden");

        const choose = document.getElementById("outputFolderChoose");
        if (choose instanceof HTMLButtonElement) {
          choose.onclick = async () => {
            choose.disabled = true;
            const folder = await window.desktopAPI?.selectOutputFolder?.();
            if (!folder) {
              choose.disabled = false;
              return;
            }
            state.output = folder;
            try { if (typeof save === "function") save(); } catch {}
            root.classList.add("hidden");
            try { if (typeof render === "function") render(); } catch {}
          };
        }
      };

      replacement.__coreFolderRecovery = true;
      handleExportBlock = replacement;
      document.documentElement.dataset.coreExportFolderRecovery = "enabled";
      return true;
    } catch {
      return false;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
  else install();
})();
