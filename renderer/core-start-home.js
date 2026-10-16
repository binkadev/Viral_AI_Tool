(function installStartHome() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const copy = () => window.I18N.messages[state.locale === "en" ? "en" : "vi"].startHome;
  const sources = () => (Array.isArray(state.jobs) ? state.jobs : []).filter(j => j?.sourcePath && !j.isRenderOutput);
  let status = "statusChecking";
  let pending = false;
  function route(id) {
    state.page = id;
    render();
    document.getElementById("page").scrollTop = 0;
  }
  function thumb(job) {
    // Only show stored media previews. No stock images stand in for user projects.
    const url = typeof job.thumbnail === "string" ? job.thumbnail : "";
    return '<div class="start-project-thumb">' + (url && /^(data:image\/(png|jpeg|webp);|file:|blob:)/i.test(url)
      ? '<img src="' + esc(url) + '" alt="" data-start-thumb>' : '<span>' + esc(copy().noThumb) + '</span>') + '</div>';
  }
  function action(routeId, icon, title, body, disabled = false) {
    return '<button class="start-action" type="button" data-start-route="' + routeId + '"' + (disabled ? ' disabled' : '') + '><span class="start-action-icon" aria-hidden="true">' + icon + '</span><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span><i aria-hidden="true">↗</i></button>';
  }
  function page() {
    const c = copy(), jobs = sources(), current = jobs[0];
    const examples = window.I18N.messages[state.locale === "en" ? "en" : "vi"].aiCreate.examples;
    return '<div class="start-home"><header class="start-heading"><div><span class="start-eyebrow">' + esc(c.eyebrow) + '</span><h2>' + esc(c.title) + '</h2><p>' + esc(c.body) + '</p></div><button class="start-status" type="button" data-start-route="settings" aria-label="' + esc(c.settings) + '"><span data-start-status role="status">' + esc(c[status]) + '</span><span aria-hidden="true">↗</span></button></header>' +
      '<section class="start-actions">' + action('ai-create','✦',c.ai,c.aiBody) + action('download','⇧',c.import,c.importBody) + action('ai-video','▷',c.continue,current ? c.continueBody : c.noCurrent,!current) + '</section>' +
      '<section class="start-projects"><div class="start-section-head"><h3>' + esc(c.recent) + '</h3><button type="button" class="button ghost" data-start-route="library">' + esc(c.library) + ' ↗</button></div>' +
      (current ? '<div class="start-project-grid">' + jobs.map((job,index) => '<button type="button" class="start-project" data-start-route="' + (index === 0 ? 'ai-video' : 'library') + '">' + thumb(job) + '<span class="start-project-copy">' + (index === 0 ? '<small>' + esc(c.current) + '</small>' : '') + '<strong>' + esc(job.name || c.video) + '</strong><span>' + esc(['missing','trashed'].includes(job.fileState) ? c.missing : c.saved) + '</span></span><span aria-hidden="true">↗</span></button>').join('') + '</div>' : '<div class="start-empty"><span aria-hidden="true">▱</span><div><strong>' + esc(c.empty) + '</strong><p>' + esc(c.emptyBody) + '</p></div></div>') + '</section>' +
      '<section><div class="start-section-head"><h3>' + esc(c.ideas) + '</h3><span>' + esc(c.ideasHint) + '</span></div><div class="core-ai-example-row">' + examples.map((item,index) => '<button type="button" class="core-ai-example" data-start-example="' + index + '"><span class="core-ai-example-art art-' + index + '" aria-hidden="true"><i></i><b></b><em></em></span><span class="core-ai-example-copy"><strong>' + esc(item.title) + '</strong><span>' + esc(item.detail) + '</span></span><span class="core-ai-example-arrow" aria-hidden="true">↗</span></button>').join('') + '</div></section></div>';
  }
  async function refreshStatus() {
    if (pending) return;
    pending = true;
    status = "statusChecking";
    paintStatus();
    try {
      const result = await window.desktopAPI?.getGenerationStatus?.();
      status = result?.ok === true ? (result.value?.ready === true && result.value?.state === "ready" ? "statusReady" : "statusUnavailable") : "statusUnknown";
    } catch { status = "statusUnknown"; }
    finally { pending = false; paintStatus(); }
  }
  function paintStatus() {
    const node = document.querySelector('[data-start-status]');
    if (node) node.textContent = copy()[status];
  }
  function install() {
    pages.home = page;
    pageMeta.home = ["startHome.nav", "startHome.breadcrumb"];
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('[data-start-route]');
      if (button && !button.disabled) {
        const id = button.dataset.startRoute;
        if (['ai-create','download','ai-video','library','settings'].includes(id) && (id !== 'ai-video' || sources().length)) route(id);
      }
      const example = target?.closest('[data-start-example]');
      if (example) {
        route('ai-create');
        document.querySelector('[data-ai-example="' + example.dataset.startExample + '"]')?.click();
      }
      if (target?.closest('[data-page="home"]')) refreshStatus();
    });
    document.addEventListener('error', event => {
      if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-start-thumb')) {
        const fallback = document.createElement('span');
        fallback.textContent = copy().noThumb;
        event.target.replaceWith(fallback);
      }
    }, true);
    window.addEventListener('focus', refreshStatus);
    refreshStatus();
    if (state.page === 'home') render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
