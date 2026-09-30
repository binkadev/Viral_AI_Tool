const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),

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
  renderVideo: payload => ipcRenderer.invoke('video:render', payload),
  cancelRender: jobId => ipcRenderer.invoke('video:cancel-render', jobId),

  onRenderProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('video:render-progress', listener);
    return () => ipcRenderer.removeListener('video:render-progress', listener);
  }
});
