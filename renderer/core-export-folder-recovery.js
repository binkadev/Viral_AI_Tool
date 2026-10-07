(function installCoreExportFolderRecovery() {
  "use strict";

  let legacyHandle = null;
  let legacyLocalized = null;
  let legacyReal = null;
  let pendingPipeline = null;

  function wrapRenderEntrypoints() {
    try {
      if (typeof startLocalizedRender === "function" && startLocalizedRender.__coreFolderTracked !== true) {
        legacyLocalized = startLocalizedRender;
        const localized = async function coreTrackedLocalizedRender(sourceOverride = null) {
          pendingPipeline = { kind: "localized", source: sourceOverride || null };
          return legacyLocalized(sourceOverride);
        };
        localized.__coreFolderTracked = true;
        startLocalizedRender = localized;
      }
      if (typeof startRealRender === "function" && startRealRender.__coreFolderTracked !== true) {
        legacyReal = startRealRender;
        const real = async function coreTrackedRealRender(sourceOverride = null) {
          pendingPipeline = { kind: "real", source: sourceOverride || null };
          return legacyReal(sourceOverride);
        };
        real.__coreFolderTracked = true;
        startRealRender = real;
      }
    } catch {}
  }

  async function retryPipeline(source) {
    const pending = pendingPipeline;
    pendingPipeline = null;
    if (pending?.kind === "localized" && typeof startLocalizedRender === "function") {
      return startLocalizedRender(source || pending.source || null);
    }
    if (pending?.kind === "real" && typeof startRealRender === "function") {
      return startRealRender(source || pending.source || null);
    }
    return null;
  }

  function install() {
    try {
      wrapRenderEntrypoints();
      if (typeof handleExportBlock !== "function") return false;
      if (handleExportBlock.__coreFolderRecovery === true) return true;
      legacyHandle = handleExportBlock;

      const replacement = async function coreHandleExportBlock(response, source) {
        const code = response?.error?.code || "PROCESSING_FAILED";
        if (!["OUTPUT_UNAVAILABLE", "OUTPUT_REQUIRED"].includes(code)) {
          pendingPipeline = null;
          return legacyHandle(response, source);
        }

        const root = document.getElementById("modal");
        if (!root) return legacyHandle(response, source);
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
        if (cancel) cancel.onclick = () => {
          pendingPipeline = null;
          root.classList.add("hidden");
        };

        const choose = document.getElementById("outputFolderChoose");
        if (choose instanceof HTMLButtonElement) {
          choose.onclick = async () => {
            choose.disabled = true;
            let folder = null;
            try { folder = await window.desktopAPI?.selectOutputFolder?.(); }
            catch { folder = null; }
            if (!folder) {
              choose.disabled = false;
              return;
            }
            state.output = folder;
            try { if (typeof save === "function") save(); } catch {}
            root.classList.add("hidden");
            try { if (typeof render === "function") render(); } catch {}
            await retryPipeline(source);
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
