const { contextBridge, ipcRenderer } = require('electron');
// Main-process authority only: preferences, argv and renderer state cannot
// opt a packaged app into support diagnostics. Missing capability fails closed.
const developmentSupport = typeof ipcRenderer.sendSync === 'function' &&
  ipcRenderer.sendSync('generation:development-diagnostics') === true;

// Static DEV-only fault, installed before persistence captures the native setter.
// Main authority requires unpackaged + non-production + exact fixture/session.
if (typeof ipcRenderer.sendSync === 'function' && ipcRenderer.sendSync('dev:handoff-storage-fault') === 'dev-handoff-registry-fault-v1') {
  contextBridge.executeInMainWorld({ func: () => {
    const nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (this === localStorage && key === 'viral-ai-core-project-registry-v1' && window.__devHandoffFailRegistry === true) {
        throw new DOMException('DEV registry write failure', 'QuotaExceededError');
      }
      return nativeSet.call(this, key, value);
    };
  } });
}

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  getTelegramStatus: () => ipcRenderer.invoke('telegram:status'),
  saveTelegramConfig: payload => ipcRenderer.invoke('telegram:config-save', payload),
  clearTelegramConfig: () => ipcRenderer.invoke('telegram:config-clear'),
  testTelegramNotification: () => ipcRenderer.invoke('telegram:test'),
  notifyTelegram: intent => ipcRenderer.invoke('telegram:notify', intent),
  getDevGenerationFixture: () => ipcRenderer.invoke('dev:generation-fixture'),
  getDevHandoffFixture: (action, payload) => ipcRenderer.invoke('dev:generated-handoff', action, payload),
  onGenerationChanged: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (typeof payload?.id === 'string' && typeof payload?.status === 'string') callback({ id: payload.id, status: payload.status });
    };
    ipcRenderer.on('generation:changed', listener);
    return () => ipcRenderer.removeListener('generation:changed', listener);
  },
  getGenerationStatus: () => ipcRenderer.invoke('generation:status'),
  openGenerationProviderSession: id => ipcRenderer.invoke('generation:provider-session-open', id),
  selectGenerationProviderSession: selection => ipcRenderer.invoke('generation:provider-session-select', selection),
  openGenerationExtensionStore: id => ipcRenderer.invoke('generation:provider-extension-store', id),
  revealGenerationProviderExtension: id => ipcRenderer.invoke('generation:provider-extension-reveal', id),
  checkGenerationProviderSession: id => ipcRenderer.invoke('generation:provider-session-check', id),
  checkGenerationProvider: id => ipcRenderer.invoke('generation:provider-check', id),
  diagnoseGenerationProviderRuntime: id => ipcRenderer.invoke('generation:provider-runtime-diagnosis', id),
  getGenerationAcceptanceTrace: id => ipcRenderer.invoke('generation:acceptance-trace', id),
  ...(developmentSupport ? {diagnoseMuseOwnership: id => ipcRenderer.invoke('generation:ownership-diagnosis', id)} : {}),
  configureGenerationProvider: config => ipcRenderer.invoke('generation:provider-configure', config),
  listGenerationProviders: () => ipcRenderer.invoke('generation:providers'),
  submitGeneration: request => ipcRenderer.invoke('generation:submit', request),
  listGenerationJobs: projectId => ipcRenderer.invoke('generation:list', projectId),
  getGenerationJob: id => ipcRenderer.invoke('generation:get', id),
  getGenerationOutput: id => ipcRenderer.invoke('generation:output', id),
  getGenerationExecutionAudit: id => ipcRenderer.invoke('generation:execution-audit', id),
  reportGenerationAttachment: report => ipcRenderer.invoke('generation:attachment-report', report),
  cancelGeneration: id => ipcRenderer.invoke('generation:cancel', id),
  recoverGeneration: id => ipcRenderer.invoke('generation:recover', id),
  listRecoveryCandidates: id => ipcRenderer.invoke('generation:recovery-candidates', id),
  revealRecoveryCandidate: (jobId,candidateId) => ipcRenderer.invoke('generation:recovery-reveal', {jobId,candidateId}),
  confirmRecoveryCandidate: (jobId,candidateId) => ipcRenderer.invoke('generation:recovery-confirm', {jobId,candidateId}),
  dismissRecovery: id => ipcRenderer.invoke('generation:recovery-dismiss', id),
  retryGeneration: request => ipcRenderer.invoke('generation:retry', request),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  getVersionInfo: () => ipcRenderer.invoke('app:version-info'),
  getAppUpdateState: () => ipcRenderer.invoke('updates:state'),
  checkAppUpdate: () => ipcRenderer.invoke('updates:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('updates:download'),
  cancelAppUpdate: () => ipcRenderer.invoke('updates:cancel'),
  installAppUpdate: () => ipcRenderer.invoke('updates:install'),
  setAppUpdateAutomatic: value => ipcRenderer.invoke('updates:automatic', value),
  onAppUpdateState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updates:state-changed', listener);
    return () => ipcRenderer.removeListener('updates:state-changed', listener);
  },
  checkForUpdates: () => ipcRenderer.invoke('app:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  cancelUpdateDownload: () => ipcRenderer.invoke('app:cancel-update-download'),
  launchUpdate: () => ipcRenderer.invoke('app:launch-update'),
  onUpdateProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-progress', listener);
    return () => ipcRenderer.removeListener('app:update-progress', listener);
  },
  onUpdateAvailable: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-available', listener);
    return () => ipcRenderer.removeListener('app:update-available', listener);
  },
  openDiagnosticLogs: () => ipcRenderer.invoke('diagnostics:open-folder'),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),

  selectVideos: () => ipcRenderer.invoke('files:select-videos'),
  selectOutputFolder: () => ipcRenderer.invoke('folder:select-output'),
  showFolder: targetPath => ipcRenderer.invoke('folder:show', targetPath),
  showFile: filePath => ipcRenderer.invoke('file:show-in-folder', filePath),
  fileStatus: filePath => ipcRenderer.invoke('file:status', filePath),
  trashFile: filePath => ipcRenderer.invoke('file:trash', filePath),
  selectReplacementVideo: () => ipcRenderer.invoke('files:select-replacement-video'),

  probeVideo: inputPath => ipcRenderer.invoke('video:probe', inputPath),
  createThumbnail: inputPath => ipcRenderer.invoke('video:thumbnail', inputPath),
  getVideoUrl: inputPath => ipcRenderer.invoke('video:file-url', inputPath),
  getMediaPreviewUrl: payload => ipcRenderer.invoke('media:preview-url', payload),
  selectProjectMedia: () => ipcRenderer.invoke('media:select-local'),
  preflightExport: payload => ipcRenderer.invoke('video:preflight-export', payload),
  preflightLocalizedExport: payload => ipcRenderer.invoke('video:preflight-localized-export', payload),
  renderVideo: payload => ipcRenderer.invoke('video:render', payload),
  renderLocalizedVideo: payload => ipcRenderer.invoke('video:render-localized', payload),
  preflightProjectRender: payload => ipcRenderer.invoke('video:preflight-project-render', payload),
  renderProjectVideo: payload => ipcRenderer.invoke('video:render-project', payload),
  cancelRender: jobId => ipcRenderer.invoke('video:cancel-render', jobId),
  setLocale: locale => ipcRenderer.invoke('app:set-locale', locale),
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  login: payload => ipcRenderer.invoke('auth:login', payload),
  getAccount: () => ipcRenderer.invoke('auth:me'),
  getAccountSessions: () => ipcRenderer.invoke('auth:sessions'),
  revokeAccountSession: sessionId => ipcRenderer.invoke('auth:revoke-session', sessionId),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getBillingCatalog: () => ipcRenderer.invoke('billing:catalog'),
  getBillingInvoices: () => ipcRenderer.invoke('billing:invoices'),
  startBillingCheckout: planId => ipcRenderer.invoke('billing:checkout', planId),
  changeBillingPlan: planId => ipcRenderer.invoke('billing:plan-change', planId),
  cancelBillingSubscription: () => ipcRenderer.invoke('billing:cancel'),
  resumeBillingSubscription: () => ipcRenderer.invoke('billing:resume'),
  openBillingPortal: () => ipcRenderer.invoke('billing:portal'),
  openExternal: url => ipcRenderer.invoke('app:open-external', url),
  getCloudConfig: () => ipcRenderer.invoke('cloud:config-get'),
  saveCloudConfig: payload => ipcRenderer.invoke('cloud:config-save', payload),
  clearCloudConfig: () => ipcRenderer.invoke('cloud:config-clear'),
  testCloudConnection: backendUrl => ipcRenderer.invoke('cloud:test-connection', backendUrl),

  getMediaSearchStatus: () => ipcRenderer.invoke('media:search-status'),
  searchMedia: payload => ipcRenderer.invoke('media:search', payload),
  cancelMediaSearch: requestId => ipcRenderer.invoke('media:search-cancel', requestId),
  acquireMedia: payload => ipcRenderer.invoke('media:acquire', payload),
  cancelMediaAcquisition: jobId => ipcRenderer.invoke('media:acquisition-cancel', jobId),
  onMediaAcquisitionProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('media:acquisition-progress', listener);
    return () => ipcRenderer.removeListener('media:acquisition-progress', listener);
  },

  getSpeechModelCatalog: () => ipcRenderer.invoke('speech:model-catalog'),
  getSpeechModelStatus: modelId => ipcRenderer.invoke('speech:model-status', modelId),
  installSpeechModel: payload => ipcRenderer.invoke('speech:model-install', payload),
  cancelSpeechModelInstall: jobId => ipcRenderer.invoke('speech:model-cancel', jobId),
  removeSpeechModel: modelId => ipcRenderer.invoke('speech:model-remove', modelId),
  onSpeechModelProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('speech:model-progress', listener);
    return () => ipcRenderer.removeListener('speech:model-progress', listener);
  },

  getSpeechProviderStatus: () => ipcRenderer.invoke('speech:provider-status'),
  preflightSpeech: payload => ipcRenderer.invoke('speech:preflight', payload),
  startSpeech: payload => ipcRenderer.invoke('speech:start', payload),
  cancelSpeech: jobId => ipcRenderer.invoke('speech:cancel', jobId),
  getTranslationStatus: () => ipcRenderer.invoke('translation:status'),
  startTranslation: payload => ipcRenderer.invoke('translation:start', payload),
  cancelTranslation: jobId => ipcRenderer.invoke('translation:cancel', jobId),
  onTranslationProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('translation:progress', listener);
    return () => ipcRenderer.removeListener('translation:progress', listener);
  },
  getVoiceStatus: () => ipcRenderer.invoke('voice:status'),
  getVoiceCatalog: () => ipcRenderer.invoke('voice:catalog'),
  previewVoice: payload => ipcRenderer.invoke('voice:preview', payload),
  startVoice: payload => ipcRenderer.invoke('voice:start', payload),
  cancelVoice: jobId => ipcRenderer.invoke('voice:cancel', jobId),
  onVoiceProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:progress', listener);
    return () => ipcRenderer.removeListener('voice:progress', listener);
  },
  onSpeechProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('speech:progress', listener);
    return () => ipcRenderer.removeListener('speech:progress', listener);
  },

  onRenderProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('video:render-progress', listener);
    return () => ipcRenderer.removeListener('video:render-progress', listener);
  }
});
