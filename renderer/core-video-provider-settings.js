(function installVideoProviderSettings() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const copy = () => window.I18N.messages[state.locale === "en" ? "en" : "vi"].videoProviders;
  let status = null, session = null, pending = false, failed = false, supportOpen = false;
  function content() {
    const c = copy();
    const current = pending ? "checking" : failed ? "error" : status?.state || "unconfigured";
    const message = failed ? c.checkError : (status?.messageCode ? c.messages[status.messageCode] || "" : "");
    const messageMarkup = message ? '<p class="video-provider-message"'+(failed?' role="alert"':'')+'>'+esc(message)+'</p>' : "";
    const sessionState = session?.state || "extension_offline";
    const distributionState = failed ? "extension_error" : session?.extensionState || "extension_install_required";
    const sessions = session?.sessions || [];
    const options = sessions.flatMap((profile, index) => (profile.tabs.length ? profile.tabs : [{tabId:null,authState:"muse_tab_missing"}]).map((tab, tabIndex) => {
      const value = JSON.stringify({instanceId:profile.instanceId,tabId:tab.tabId});
      const selected = session.selectedInstanceId === profile.instanceId && session.selectedTabId === tab.tabId;
      const profileName = profile.profileLabel || c.profileFallback.replace("{number}", String(index+1));
      const text = c.sessionOption.replace("{profile}", profileName).replace("{number}", String(tabIndex+1)).replace("{state}", c.sessionStates[tab.authState] || c.sessionStates.unknown);
      return '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(text)+'</option>';
    })).join("");
    return '<header><div><h3 id="video-providers-title">'+esc(c.title)+'</h3><p>'+esc(c.description)+'</p></div></header>'+
      '<div class="video-provider-row"><div><h4>'+esc(c.muse)+'</h4><p>'+esc(c.museDescription)+'</p></div>'+
      '<span class="video-provider-status" role="status" data-provider-state="'+esc(current)+'">'+esc(c.states[current] || c.states.unavailable)+'</span></div>'+
      messageMarkup+
      '<p role="status" data-extension-connected="'+Boolean(sessions.length)+'">'+esc(c.distributionStates[distributionState])+'</p>'+
      '<p role="status" data-muse-session-state="'+esc(sessionState)+'">'+esc(pending?c.states.checking:c.sessionStates[sessionState])+'</p>'+
      (sessions.length ? '<label class="video-provider-session-label">'+esc(c.profile)+'<select data-video-provider-session'+(pending?' disabled':'')+'><option value="">'+esc(c.chooseSession)+'</option>'+options+'</select></label>' : '<p>'+esc(c.connectionHint)+'</p>')+
      (!session?.storeConfigured ? '<p>'+esc(c.storeUnavailable)+'</p>' : '')+
      '<p class="video-provider-note">'+esc(c.foundationNote)+'</p>'+
      '<div class="video-provider-controls"><label><input type="checkbox" data-video-provider-enable'+
      (status?.enabled===true?' checked':'')+(pending||!status?' disabled':'')+'><span>'+esc(c.enable)+'</span></label>'+
      '<button type="button" class="button ghost" data-video-provider-open'+(pending||distributionState!=='extension_connected'||!status?.enabled||['extension_offline','selection_required'].includes(sessionState)?' disabled':'')+'>'+esc(c.openMuse)+'</button>'+
      '<button type="button" class="button ghost" data-video-provider-check' +(pending?' disabled':'')+'>'+
      esc(pending?c.states.checking:c.check)+'</button>'+
      (distributionState !== 'extension_connected' ? '<button type="button" class="button ghost" data-video-provider-store'+(pending||!session?.storeConfigured?' disabled':'')+'>'+esc(['extension_outdated','extension_update_required'].includes(distributionState)?c.updateExtension:c.installExtension)+'</button>' : '')+'</div>'+
      '<details data-video-provider-support'+(supportOpen?' open':'')+'><summary>'+esc(c.manualInstallation)+'</summary><p>'+esc(c.manualSteps)+'</p>'+
      '<button type="button" class="button ghost" data-video-provider-setup'+(pending?' disabled':'')+'>'+esc(c.manualFolder)+'</button></details>';
  }
  function html() {
    return '<section id="video-provider-settings" class="card card-pad video-provider-settings" aria-labelledby="video-providers-title" aria-busy="'+pending+'">'+content()+'</section>';
  }
  function paint(focus) {
    const root = document.getElementById("video-provider-settings");
    if (!root) return;
    const active = document.activeElement;
    const keepFocus = focus || (active?.matches?.("[data-video-provider-open]") ? "open" : active?.matches?.("[data-video-provider-enable]") ? "enable" : active?.matches?.("[data-video-provider-check]") ? "check" : null);
    supportOpen = Boolean(root.querySelector("[data-video-provider-support]")?.open);
    root.innerHTML = content();
    root.setAttribute("aria-busy", String(pending));
    if (keepFocus) root.querySelector("[data-video-provider-"+keepFocus+"]")?.focus({preventScroll:true});
  }
  async function refresh(enabled, focus, open = false, selection = null, setup = false, store = false) {
    if (pending) return;
    pending = true; failed = false; paint();
    try {
      const result = typeof enabled === "boolean"
        ? await window.desktopAPI.configureGenerationProvider({id:"muse", enabled})
        : await window.desktopAPI.checkGenerationProvider("muse");
      if (!result?.ok || result.value?.id !== "muse") throw new Error("unavailable");
      status = result.value;
      if (store) {
        const opened = await window.desktopAPI.openGenerationExtensionStore("muse");
        if (!opened?.ok) throw new Error("unavailable");
      }
      if (setup) {
        const installed = await window.desktopAPI.revealGenerationProviderExtension("muse");
        if (!installed?.ok) throw new Error("unavailable");
      }
      const sessionResult = selection
        ? await window.desktopAPI.selectGenerationProviderSession({id:"muse", ...selection})
        : open
        ? await window.desktopAPI.openGenerationProviderSession("muse")
        : await window.desktopAPI.checkGenerationProviderSession?.("muse");
      if (sessionResult && (!sessionResult.ok || sessionResult.value?.id !== "muse")) throw new Error("unavailable");
      session = sessionResult?.value || null;
    } catch { failed = true; session = null; }
    finally { pending = false; paint(focus); }
  }
  window.ViralVideoProviderSettings = {html};
  function install() {
    document.addEventListener("click", event => {
      if (event.target?.closest?.("[data-video-provider-open]")) refresh(undefined,"open",true);
      else if (event.target?.closest?.("[data-video-provider-check]")) refresh(undefined,"check");
      else if (event.target?.closest?.("[data-video-provider-store]")) refresh(undefined,"store",false,null,false,true);
      else if (event.target?.closest?.("[data-video-provider-setup]")) refresh(undefined,"setup",false,null,true);
      else if (event.target?.closest?.('[data-page="settings"]')) refresh();
    });
    document.addEventListener("change", event => {
      if (event.target?.matches?.("[data-video-provider-enable]")) refresh(event.target.checked,"enable");
      else if (event.target?.matches?.("[data-video-provider-session]") && event.target.value) {
        try {refresh(undefined,"session",false,JSON.parse(event.target.value));} catch {}
      }
    });
    window.addEventListener("focus", () => {if(state.page === "settings") refresh();});
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, {once:true});
  else install();
})();
