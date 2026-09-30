const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  probeVideo,
  createThumbnail,
  renderVideo,
  cancelRender,
  assertVideoPath
} = require('./services/ffmpeg');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#09090d',
    title: 'Viral AI Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.viralai.tool');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('files:select-videos', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn video nguồn',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled) return [];
  return result.filePaths.map(filePath => ({
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).slice(1).toUpperCase()
  }));
});

ipcMain.handle('folder:select-output', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục xuất video',
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('folder:show', async (_event, targetPath) => {
  if (!targetPath) return false;
  const error = await shell.openPath(targetPath);
  return !error;
});


ipcMain.handle('video:probe', async (_event, inputPath) => {
  return probeVideo(inputPath);
});

ipcMain.handle('video:thumbnail', async (_event, inputPath) => {
  return createThumbnail(inputPath, app.getPath('temp'));
});

ipcMain.handle('video:render', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  return renderVideo({
    jobId: safePayload.jobId,
    inputPath: safePayload.inputPath,
    outputDir: safePayload.outputDir,
    onProgress: progress => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('video:render-progress', progress);
      }
    }
  });
});

ipcMain.handle('video:cancel-render', async (_event, jobId) => {
  return cancelRender(jobId);
});

ipcMain.handle('file:show-in-folder', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim() || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(path.resolve(filePath));
  return true;
});


ipcMain.handle('video:file-url', async (_event, inputPath) => {
  const safePath = assertVideoPath(inputPath);
  return pathToFileURL(safePath).href;
});
