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
      ? '<img src="' + esc(url) + '" alt="" data-start-thumb>' : '<span class="start-thumb-fallback"><i aria-hidden="true">▷</i><span>' + esc(copy().noThumb) + '</span></span>') + '</div>';
  }
  function duration(job) {
    const seconds = Number(job?.meta?.duration);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.floor(seconds);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function action(routeId, icon, title, body, disabled = false) {
    const primary = routeId === 'ai-create';
    return '<button class="start-action" type="button" data-start-route="' + routeId + '"' + (disabled ? ' disabled' : '') + '><span class="start-action-icon" aria-hidden="true">' + icon + '</span><span class="start-action-copy"><strong>' + esc(title) + '</strong><span>' + esc(body) + '</span></span>' + (primary ? '<span class="start-action-art" aria-hidden="true"><i></i><i></i><i>✦</i></span>' : '') + '<i class="start-action-arrow" aria-hidden="true">↗</i></button>';
  }
  function page() {
    const c = copy(), jobs = sources(), current = jobs[0];
    const examples = window.I18N.messages[state.locale === "en" ? "en" : "vi"].aiCreate.examples;
    return '<div class="start-home"><header class="start-heading"><div><span class="start-eyebrow">' + esc(c.eyebrow) + '</span><h2>' + esc(c.title) + '</h2><p>' + esc(c.body) + '</p></div><button class="start-status" type="button" data-start-route="settings" aria-label="' + esc(c.settings) + '"><span data-start-status role="status">' + esc(c[status]) + '</span><span aria-hidden="true">↗</span></button></header>' +
      '<section class="start-actions">' + action('ai-create','✦',c.ai,c.aiBody) + action('download','⇧',c.import,c.importBody) + action('ai-video','▷',c.continue,current ? (current.name || c.video) : c.noCurrent,!current) + '</section>' +
      '<section class="start-projects"><div class="start-section-head"><h3>' + esc(c.recent) + '</h3><button type="button" class="button ghost" data-start-route="library">' + esc(c.library) + ' ↗</button></div>' +
      (current ? '<div class="start-project-grid">' + jobs.map((job,index) => '<button type="button" class="start-project ' + (index === 0 ? 'is-current' : '') + '" data-start-route="' + (index === 0 ? 'ai-video' : 'library') + '">' + '<span class="start-project-media">' + thumb(job) + (index === 0 ? '<small class="start-current-badge">' + esc(c.current) + '</small>' : '') + (duration(job) ? '<span class="start-duration">' + esc(duration(job)) + '</span>' : '') + '</span><span class="start-project-copy">' + '<strong>' + esc(job.name || c.video) + '</strong><span>' + esc(['missing','trashed'].includes(job.fileState) ? c.missing : c.saved) + '</span></span><span class="start-project-open">' + esc(index === 0 ? c.continue : c.library) + ' <i aria-hidden="true">↗</i></span></button>').join('') + '</div>' : '<div class="start-empty"><span aria-hidden="true">▱</span><div><strong>' + esc(c.empty) + '</strong><p>' + esc(c.emptyBody) + '</p></div></div>') + '</section>' +
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
  const observedActivity = new WeakSet();
  function compactActivity() {
    if (state.page !== 'home') return;
    const activity = document.querySelector('#page > .core-editor-activity');
    const detail = activity?.querySelector('[data-activity-detail]');
    if (!detail) return;
    if (!observedActivity.has(activity)) {
      observedActivity.add(activity);
      new MutationObserver(compactActivity).observe(activity, {attributes:true, attributeFilter:['data-state']});
    }
    let disclosure = activity.querySelector('.start-activity-details');
    if (!disclosure) {
      disclosure = document.createElement('details');
      disclosure.className = 'start-activity-details';
      const summary = document.createElement('summary');
      disclosure.appendChild(summary);
      detail.before(disclosure);
      disclosure.appendChild(detail);
    }
    disclosure.querySelector('summary').textContent = copy().activityDetails;
    // Errors remain expanded; routine progress is compact and keyboard-expandable.
    if (disclosure.dataset.activityState !== activity.dataset.state) {
      disclosure.open = activity.dataset.state === 'failed';
      disclosure.dataset.activityState = activity.dataset.state || '';
    }
  }
  function install() {
    const viewport = document.getElementById('page');
    if (viewport) new MutationObserver(compactActivity).observe(viewport, {childList:true});
    window.addEventListener('viral-ai:core-state-changed', compactActivity);
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
        fallback.className = 'start-thumb-fallback';
        const icon = document.createElement('i');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▷';
        const label = document.createElement('span');
        label.textContent = copy().noThumb;
        fallback.append(icon, label);
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
