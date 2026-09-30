const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  selectVideos: () => ipcRenderer.invoke('files:select-videos'),
  selectOutputFolder: () => ipcRenderer.invoke('folder:select-output'),
  showFolder: targetPath => ipcRenderer.invoke('folder:show', targetPath)
});
