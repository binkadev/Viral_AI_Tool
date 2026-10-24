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
  const homeCopy = (key, vars) => window.I18N.t(state.locale === 'en' ? 'en' : 'vi', 'homeWorkspace.' + key, vars);
  const managerCopy = key => window.I18N.t(state.locale === 'en' ? 'en' : 'vi', 'productionManager.' + key);
  function page() {
    const persistence = window.ViralCoreProjectPersistence, runtime = window.ViralProductionManager?.runtime;
    let view, unavailable = false, projects = [];
    try {
      view = runtime?.collect();
      const summaries = new Map((view?.summaries || []).map(s => [s.projectId, s]));
      projects = (persistence?.listProjects() || []).map(p => summaries.get(p.projectId)).filter(Boolean);
    } catch { unavailable = true; }
    const active = projects.find(p => p.projectId === persistence?.activeProjectId());
    const attention = p => ['needs_attention', 'review'].includes(p.status);
    const review = projects.find(p => p !== active && attention(p));
    const recent = projects.filter(p => p !== active && p !== review).slice(0, 3);
    const disabled = view?.protected || view?.opening;
    const open = (p, label, primary = false) => '<button type="button" class="home-open' + (primary ? ' home-primary' : '') + '" data-home-project="' + esc(p.projectId) + '"' + (disabled ? ' disabled' : '') + '>' + esc(homeCopy(label)) + '<span aria-hidden="true">↗</span></button>';
    const routeButton = (id, label, primary = false) => '<button type="button" class="home-open' + (primary ? ' home-primary' : '') + '" data-start-route="' + id + '">' + esc(homeCopy(label)) + '<span aria-hidden="true">↗</span></button>';
    const meta = p => '<p class="home-project-meta"><span>' + esc(managerCopy(p.status)) + '</span><span>' + esc(homeCopy('scenes', {count:p.materials.total})) + '</span></p>';
    return '<div class="home-workspace"><header class="home-heading"><span class="home-eyebrow">' + esc(homeCopy('eyebrow')) + '</span><h2>' + esc(homeCopy('title')) + '</h2></header>' +
      '<section class="home-hero" aria-labelledby="home-next"><div class="home-hero-copy"><span class="home-eyebrow">' + esc(homeCopy(active ? 'current' : 'start')) + '</span><h3 id="home-next">' + esc(homeCopy(active ? 'returnTitle' : projects.length ? 'newTitle' : 'emptyTitle')) + '</h3>' +
      (active ? '<h4>' + esc(active.name) + '</h4>' + meta(active) + '<p>' + esc(homeCopy(attention(active) ? 'attentionHint' : active.checkingOutput ? 'checkingHint' : 'continueHint')) + '</p>' : '<p>' + esc(homeCopy('emptyBody')) + '</p>') +
      '<div class="home-actions">' + (active && !view?.protected ? open(active, 'continue', true) : routeButton('ai-create', 'create', true)) + (active ? routeButton('ai-create', 'new') : routeButton('download', 'import')) + '</div></div>' +
      '<ol class="home-workflow">' + ['idea','materials','export'].map((key, i) => '<li><span aria-hidden="true">0' + (i+1) + '</span><div><strong>' + esc(homeCopy(key)) + '</strong><p>' + esc(homeCopy(key + 'Hint')) + '</p></div></li>').join('') + '</ol></section>' +
      (unavailable ? '<p class="home-notice" role="alert">' + esc(homeCopy('loadError')) + '</p>' : view?.protected ? '<p class="home-notice" role="alert">' + esc(managerCopy('storageProtected')) + '</p>' : view?.error ? '<p class="home-notice" role="alert">' + esc(managerCopy(view.error)) + '</p>' : '') +
      (review ? '<section class="home-attention"><div><span class="home-eyebrow">' + esc(homeCopy('attention')) + '</span><h3>' + esc(review.name) + '</h3>' + meta(review) + '</div>' + open(review, 'review') + '</section>' : '') +
      (recent.length ? '<section class="home-projects"><div class="home-section-heading"><h3>' + esc(homeCopy('projects')) + '</h3><button type="button" class="home-link" data-home-manager>' + esc(homeCopy('allProjects')) + ' ↗</button></div><div class="home-project-grid">' + recent.map(p => '<article class="home-project"><span class="home-project-mark" aria-hidden="true">▱</span><h4>' + esc(p.name) + '</h4>' + meta(p) + open(p, 'open') + '</article>').join('') + '</div></section>' : '') +
      '<footer class="home-footer"><p><span class="home-status-dot" aria-hidden="true"></span><span data-start-status role="status">' + esc(copy()[status]) + '</span></p><button type="button" class="home-link" data-start-route="settings">' + esc(homeCopy('settings')) + ' ↗</button>' + (active ? routeButton('download', 'import') : '') + '</footer></div>';
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
      const project = target?.closest('[data-home-project]');
      if (project && !project.disabled) {
        window.ViralProductionManager?.runtime.open(project.dataset.homeProject).then(opened => { if (!opened && state.page === 'home') render(); });
      }
      if (target?.closest('[data-home-manager]')) route('productions');
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
