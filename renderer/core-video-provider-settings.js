(function installVideoProviderSettings() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const copy = () => window.I18N.messages[state.locale === "en" ? "en" : "vi"].videoProviders;
  let status = null, session = null, pending = false, opening = false, failed = false;
  function content() {
    const c = copy();
    const current = pending ? "checking" : failed ? "error" : status?.state || "unconfigured";
    const message = failed ? c.checkError : (status?.messageCode ? c.messages[status.messageCode] || "" : "");
    const messageMarkup = message ? '<p class="video-provider-message"'+(failed?' role="alert"':'')+'>'+esc(message)+'</p>' : "";
    return '<header><div><h3 id="video-providers-title">'+esc(c.title)+'</h3><p>'+esc(c.description)+'</p></div></header>'+
      '<div class="video-provider-row"><div><h4>'+esc(c.muse)+'</h4><p>'+esc(c.museDescription)+'</p></div>'+
      '<span class="video-provider-status" role="status" data-provider-state="'+esc(current)+'">'+esc(c.states[current] || c.states.unavailable)+'</span></div>'+
      messageMarkup+
      (session || opening ? '<p role="status" data-browser-state="'+esc(opening?'browser_starting':session.state)+'">'+esc(c.browserStates[opening?'browser_starting':session.state])+'</p>' : '')+
      (session?.messageCode ? '<p role="alert">'+esc(c.browserMessages[session.messageCode] || c.checkError)+'</p>' : '')+
      '<p class="video-provider-note">'+esc(c.foundationNote)+'</p>'+
      '<div class="video-provider-controls"><label><input type="checkbox" data-video-provider-enable'+
      (status?.enabled===true?' checked':'')+(pending||!status?' disabled':'')+'><span>'+esc(c.enable)+'</span></label>'+
      '<button type="button" class="button ghost" data-video-provider-open'+(pending||!status?.enabled?' disabled':'')+'>'+esc(c.openMuse)+'</button>'+
      '<button type="button" class="button ghost" data-video-provider-check' +(pending?' disabled':'')+'>'+
      esc(pending?c.states.checking:c.check)+'</button></div>';
  }
  function html() {
    return '<section id="video-provider-settings" class="card card-pad video-provider-settings" aria-labelledby="video-providers-title" aria-busy="'+pending+'">'+content()+'</section>';
  }
  function paint(focus) {
    const root = document.getElementById("video-provider-settings");
    if (!root) return;
    const active = document.activeElement;
    const keepFocus = focus || (active?.matches?.("[data-video-provider-open]") ? "open" : active?.matches?.("[data-video-provider-enable]") ? "enable" : active?.matches?.("[data-video-provider-check]") ? "check" : null);
    root.innerHTML = content();
    root.setAttribute("aria-busy", String(pending));
    if (keepFocus) root.querySelector("[data-video-provider-"+keepFocus+"]")?.focus({preventScroll:true});
  }
  async function refresh(enabled, focus, open = false) {
    if (pending) return;
    pending = true; opening = open; failed = false; paint();
    try {
      const result = typeof enabled === "boolean"
        ? await window.desktopAPI.configureGenerationProvider({id:"muse", enabled})
        : await window.desktopAPI.checkGenerationProvider("muse");
      if (!result?.ok || result.value?.id !== "muse") throw new Error("unavailable");
      status = result.value;
      const sessionResult = open
        ? await window.desktopAPI.openGenerationProviderSession("muse")
        : await window.desktopAPI.checkGenerationProviderSession?.("muse");
      if (sessionResult && (!sessionResult.ok || sessionResult.value?.id !== "muse")) throw new Error("unavailable");
      session = sessionResult?.value || null;
    } catch { failed = true; session = null; }
    finally { pending = false; opening = false; paint(focus); }
  }
  window.ViralVideoProviderSettings = {html};
  function install() {
    document.addEventListener("click", event => {
      if (event.target?.closest?.("[data-video-provider-open]")) refresh(undefined,"open",true);
      else if (event.target?.closest?.("[data-video-provider-check]")) refresh(undefined,"check");
      else if (event.target?.closest?.('[data-page="settings"]')) refresh();
    });
    document.addEventListener("change", event => {
      if (event.target?.matches?.("[data-video-provider-enable]")) refresh(event.target.checked,"enable");
    });
    window.addEventListener("focus", () => {if(state.page === "settings") refresh();});
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, {once:true});
  else install();
})();
