const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  getVersionInfo: () => ipcRenderer.invoke('app:version-info'),

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
  preflightExport: payload => ipcRenderer.invoke('video:preflight-export', payload),
  preflightLocalizedExport: payload => ipcRenderer.invoke('video:preflight-localized-export', payload),
  renderVideo: payload => ipcRenderer.invoke('video:render', payload),
  renderLocalizedVideo: payload => ipcRenderer.invoke('video:render-localized', payload),
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
