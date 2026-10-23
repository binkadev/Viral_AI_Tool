(function attach(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralProjectIdentity = api;
})(typeof window !== "undefined" ? window : globalThis, function projectIdentityPresentation() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  function create({ owner, persistence, locale, currentId, changed, document, i18n }) {
    let edit = null, focus = null;
    const t = key => i18n.t(locale(), key);
    function markup(projectId, name) {
      if (edit && edit.projectId !== currentId()) edit = null;
      const editing = edit?.projectId === projectId;
      return '<div class="project-identity" data-project-identity="' + esc(owner) + '">' +
        (editing ? '<label class="project-name-editor"><span>' + esc(t('projectIdentity.projectName')) + '</span><input type="text" data-project-name value="' + esc(edit.draft) + '"' + (edit.pending ? ' disabled' : '') + '></label><div class="project-name-actions">' +
          '<button type="button" class="button ghost" data-project-name-save' + (edit.pending ? ' disabled' : '') + '>' + esc(t('common.save')) + '</button>' +
          '<button type="button" class="button ghost" data-project-name-cancel' + (edit.pending ? ' disabled' : '') + '>' + esc(t('common.cancel')) + '</button></div>' +
          (edit.error ? '<p class="project-name-error" role="alert">' + esc(t('projectIdentity.' + edit.error)) + '</p>' : '') :
          '<span class="project-identity-icon" aria-hidden="true">▤</span><strong class="project-identity-name" title="' + esc(name) + '">' + esc(name) + '</strong><button type="button" class="button ghost" data-project-name-rename>' + esc(t('projectIdentity.rename')) + '</button>') + '</div>';
    }
    function cancel() {
      if (!edit || edit.pending) return;
      edit = null; focus = 'button'; changed();
    }
    async function save() {
      if (!edit || edit.pending || edit.projectId !== currentId()) return;
      const intent = edit, projectId = intent.projectId, submitted = intent.draft;
      intent.pending = true; intent.error = null; changed();
      try {
        await persistence.renameProject(projectId, submitted);
        if (edit !== intent || currentId() !== projectId) return;
        edit = null; focus = 'button'; changed();
      } catch (error) {
        if (edit !== intent || currentId() !== projectId) return;
        intent.pending = false;
        intent.error = ({PROJECT_NAME_INVALID:'invalid',PROJECT_NOT_FOUND:'missing',PROJECT_TRANSITION_PENDING:'busy',PROJECT_STORAGE_PROTECTED:'protected',PROJECT_STATE_UNAVAILABLE:'busy'}[error?.code || error?.message] || 'failed');
        focus = 'input'; changed();
      }
    }
    function target(event) {
      const host = event.target?.closest?.('[data-project-identity]');
      return host?.dataset.projectIdentity === owner && currentId() ? event.target : null;
    }
    document.addEventListener('input', event => {
      const node = target(event);
      if (node?.matches?.('[data-project-name]') && edit && !edit.pending && edit.projectId === currentId()) edit.draft = node.value;
    });
    document.addEventListener('click', event => {
      const node = target(event); if (!node || node.disabled) return;
      if (node.closest?.('[data-project-name-rename]')) {
        if (edit?.pending) return;
        const projectId = currentId(), project = persistence.listProjects().find(p => p.projectId === projectId);
        if (!project) return;
        edit = {projectId, draft:project.projectName, pending:false, error:null}; focus = 'input'; changed();
      } else if (node.closest?.('[data-project-name-save]')) save();
      else if (node.closest?.('[data-project-name-cancel]')) cancel();
    });
    document.addEventListener('keydown', event => {
      const node = target(event); if (!node?.matches?.('[data-project-name]') || event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    return { markup, restoreFocus(host) {
      if (!focus) return;
      const selector = '[data-project-identity="' + owner + '"] ' + (focus === 'input' ? '[data-project-name]' : '[data-project-name-rename]');
      const node = host.querySelector(selector); if (node) {node.focus({preventScroll:true}); focus = null;}
    }};
  }
  return {create};
});
