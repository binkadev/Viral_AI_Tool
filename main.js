const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  probeVideo,
  createThumbnail,
  preflightExport,
  renderVideo,
  cancelRender,
  cancelAllRenders,
  getActiveRenderCount,
  serializeProcessingError,
  assertVideoPath
} = require('./services/ffmpeg');
const speechModelManager = require('./services/speech/model-manager');
const {
  createProviders: createSpeechProviders,
  preflightSpeech,
  startSpeech,
  cancelSpeech,
  cancelAllSpeech,
  activeSpeechCount,
  serializeSpeechError
} = require('./services/speech');
const { createSessionStore } = require('./services/auth/session-store');
const { AuthClient } = require('./services/auth/auth-client');
const { createCloudConfigStore } = require('./services/cloud/config-store');

let mainWindow;
let sessionStore;
let cloudConfigStore;
let forceClose = false;
let closePromptOpen = false;
let uiLocale = 'vi';

function closeCopy() {
  if (uiLocale === 'en') {
    return {
      title: 'Work is still in progress',
      message: 'Viral AI Tool is still processing one or more items.',
      detail: 'Closing now will stop the active work. Your original videos will not be deleted.',
      keepOpen: 'Keep working',
      stopAndClose: 'Stop and close'
    };
  }

  return {
    title: 'Vẫn còn tiến trình đang chạy',
    message: 'Viral AI Tool vẫn đang xử lý một hoặc nhiều video.',
    detail: 'Nếu đóng ứng dụng lúc này, các tiến trình đang chạy sẽ dừng. Video gốc của bạn vẫn được giữ nguyên.',
    keepOpen: 'Tiếp tục xử lý',
    stopAndClose: 'Dừng và đóng'
  };
}

function getActiveWorkCount() {
  return getActiveRenderCount() +
    activeSpeechCount() +
    speechModelManager.activeDownloadCount();
}

function authClient() {
  const cloudConfig = cloudConfigStore?.read() || { backendUrl: '' };
  return new AuthClient({
    backendUrl: cloudConfig.backendUrl || '',
    appVersion: app.getVersion()
  });
}

async function refreshSessionIfNeeded({ force = false } = {}) {
  if (!sessionStore) return false;

  const status = sessionStore.status();
  if (!status.authenticated) return false;

  const needsRefresh = force || !status.accessReady || sessionStore.needsRefresh(60000);
  if (!needsRefresh) return true;

  const refreshToken = sessionStore.getRefreshToken();
  if (!refreshToken) {
    sessionStore.clear();
    return false;
  }

  try {
    const session = await authClient().refresh(refreshToken);
    sessionStore.setSession(session);
    return true;
  } catch (error) {
    if (["AUTH_REQUIRED", "AUTH_EXPIRED", "AUTH_INVALID_CREDENTIALS"].includes(error?.code)) {
      sessionStore.clear();
      return false;
    }
    throw error;
  }
}

function publicAuthError(error) {
  return {
    code: error?.code || "AUTH_REQUEST_FAILED",
    details: {}
  };
}

function speechProviders() {
  const cloudConfig = cloudConfigStore?.read() || {
    backendUrl: process.env.VIRAL_AI_CLOUD_URL || ''
  };

  return createSpeechProviders({
    userDataPath: app.getPath('userData'),
    tempPath: app.getPath('temp'),
    backendUrl: cloudConfig.backendUrl || '',
    getAccessToken: () => sessionStore?.getAccessToken() || null,
    appVersion: app.getVersion()
  });
}

async function testCloudConnection(backendUrl) {
  const validated = cloudConfigStore?.validateBackendUrl(backendUrl);
  if (!validated?.ok || !validated.backendUrl) {
    return {
      ok: false,
      code: validated?.code || 'CLOUD_NOT_CONFIGURED'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const url = new URL(validated.backendUrl);
    url.pathname = (url.pathname.replace(/\/+$/, '') + '/v1/speech/status').replace(/\/+/g, '/');

    try { await refreshSessionIfNeeded(); } catch {}

    const headers = {
      accept: 'application/json',
      'x-viral-ai-client': 'desktop',
      'x-viral-ai-version': app.getVersion()
    };

    const token = sessionStore?.getAccessToken();
    if (token) headers.authorization = 'Bearer ' + token;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: true,
        reachable: true,
        authenticated: false,
        code: 'CLOUD_AUTH_REQUIRED',
        status: response.status
      };
    }

    if (response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      return {
        ok: true,
        reachable: true,
        authenticated: Boolean(token),
        code: payload?.ready === false ? (payload.code || 'CLOUD_UNAVAILABLE') : 'READY',
        status: response.status,
        data: {
          quota: payload?.quota || null,
          limits: payload?.limits || null,
          retention: payload?.retention || null
        }
      };
    }

    return {
      ok: false,
      reachable: true,
      code: response.status >= 500 ? 'CLOUD_UNAVAILABLE' : 'CLOUD_REQUEST_FAILED',
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      code: error?.name === 'AbortError' ? 'CLOUD_TIMEOUT' : 'CLOUD_NETWORK'
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForWorkToStop(timeoutMs = 2500) {
  const started = Date.now();
  while (getActiveWorkCount() > 0 && Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#f4f7fc',
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

  mainWindow.on('close', async event => {
    if (forceClose || getActiveWorkCount() === 0) return;
    event.preventDefault();
    if (closePromptOpen) return;

    closePromptOpen = true;
    try {
      const copy = closeCopy();
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: copy.title,
        message: copy.message,
        detail: copy.detail,
        buttons: [copy.keepOpen, copy.stopAndClose],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });

      if (result.response === 1) {
        forceClose = true;
        cancelAllRenders();
        await cancelAllSpeech();
        speechModelManager.cancelAll();
        await waitForWorkToStop();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      }
    } finally {
      closePromptOpen = false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    forceClose = false;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.viralai.tool');
  sessionStore = createSessionStore({
    userDataPath: app.getPath('userData'),
    safeStorage
  });
  cloudConfigStore = createCloudConfigStore({
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged
  });
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

ipcMain.handle('auth:status', async () => {
  try {
    await refreshSessionIfNeeded();
  } catch (error) {
    console.error('[AuthRefreshStatus]', error?.code || error?.message);
  }

  return sessionStore?.status() || {
    authenticated: false,
    accessReady: false,
    refreshReady: false,
    userId: null,
    email: null,
    name: null,
    plan: null,
    secureStorage: false
  };
});

ipcMain.handle('auth:login', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    const session = await authClient().login({
      email: safePayload.email,
      password: safePayload.password
    });

    sessionStore.setSession(session);

    let account = null;
    try {
      account = await authClient().me(session.accessToken);
    } catch (error) {
      console.error('[AuthMeAfterLogin]', error?.code || error?.message);
    }

    return {
      ok: true,
      data: {
        status: sessionStore.status(),
        account
      }
    };
  } catch (error) {
    console.error('[AuthLogin]', error?.code || error?.message);
    return { ok: false, error: publicAuthError(error) };
  }
});

ipcMain.handle('auth:me', async () => {
  try {
    const ready = await refreshSessionIfNeeded();
    if (!ready) {
      return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };
    }

    const accessToken = sessionStore.getAccessToken();
    if (!accessToken) {
      return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };
    }

    const account = await authClient().me(accessToken);
    return {
      ok: true,
      data: {
        status: sessionStore.status(),
        account
      }
    };
  } catch (error) {
    console.error('[AuthMe]', error?.code || error?.message);
    return { ok: false, error: publicAuthError(error) };
  }
});

ipcMain.handle('auth:logout', async () => {
  const refreshToken = sessionStore?.getRefreshToken() || null;
  const accessToken = sessionStore?.getAccessToken() || null;
  let remotePending = false;

  try {
    if (refreshToken || accessToken) {
      const result = await authClient().logout(refreshToken, accessToken);
      remotePending = result?.remotePending === true;
    }
  } catch (error) {
    remotePending = true;
    console.error('[AuthLogout]', error?.code || error?.message);
  } finally {
    sessionStore?.clear();
  }

  return { ok: true, remotePending };
});

ipcMain.handle('cloud:config-get', async () => {
  return cloudConfigStore?.read() || {
    environment: 'development',
    backendUrl: '',
    source: 'unset',
    developerSettingsVisible: !app.isPackaged
  };
});

ipcMain.handle('cloud:config-save', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const result = cloudConfigStore?.write({
    environment: safePayload.environment,
    backendUrl: safePayload.backendUrl
  });

  return result || { ok: false, code: 'CLOUD_CONFIG_UNAVAILABLE' };
});

ipcMain.handle('cloud:config-clear', async () => {
  return cloudConfigStore?.clear() || { ok: false, code: 'CLOUD_CONFIG_UNAVAILABLE' };
});

ipcMain.handle('cloud:test-connection', async (_event, backendUrl) => {
  const configured = cloudConfigStore?.read();
  const target = typeof backendUrl === 'string' && backendUrl.trim()
    ? backendUrl.trim()
    : configured?.backendUrl || '';
  return testCloudConnection(target);
});

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

ipcMain.handle('video:preflight-export', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  try {
    return {
      ok: true,
      data: preflightExport({
        inputPath: safePayload.inputPath,
        outputDir: safePayload.outputDir
      })
    };
  } catch (error) {
    const serialized = serializeProcessingError(error);
    console.error('[ExportPreflight]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('video:render', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  try {
    const data = await renderVideo({
      jobId: safePayload.jobId,
      inputPath: safePayload.inputPath,
      outputDir: safePayload.outputDir,
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('video:render-progress', progress);
        }
      }
    });
    return { ok: true, data };
  } catch (error) {
    const serialized = serializeProcessingError(error);
    console.error('[VideoExport]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('video:cancel-render', async (_event, jobId) => {
  if (typeof jobId !== 'string' || !jobId.trim()) return { ok: false };
  return { ok: true, cancelled: cancelRender(jobId) };
});

ipcMain.handle('speech:model-catalog', async () => {
  return speechModelManager.catalog();
});

ipcMain.handle('speech:model-status', async (_event, modelId) => {
  try {
    return {
      ok: true,
      data: await speechModelManager.status(
        app.getPath('userData'),
        typeof modelId === 'string' ? modelId : undefined
      )
    };
  } catch (error) {
    const serialized = speechModelManager.serializeModelError(error);
    console.error('[SpeechModelStatus]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('speech:model-install', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  try {
    const data = await speechModelManager.install({
      jobId: safePayload.jobId,
      modelId: safePayload.modelId,
      userDataPath: app.getPath('userData'),
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('speech:model-progress', progress);
        }
      }
    });
    return { ok: true, data };
  } catch (error) {
    const serialized = speechModelManager.serializeModelError(error);
    console.error('[SpeechModelInstall]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('speech:model-cancel', async (_event, jobId) => {
  if (typeof jobId !== 'string' || !jobId.trim()) {
    return { ok: false, cancelled: false };
  }
  return { ok: true, cancelled: speechModelManager.cancel(jobId) };
});

ipcMain.handle('speech:model-remove', async (_event, modelId) => {
  try {
    if (activeSpeechCount() > 0) {
      return {
        ok: false,
        error: {
          code: 'MODEL_IN_USE',
          details: {}
        }
      };
    }

    const data = await speechModelManager.remove(
      app.getPath('userData'),
      typeof modelId === 'string' ? modelId : undefined
    );
    return { ok: true, data };
  } catch (error) {
    const serialized = speechModelManager.serializeModelError(error);
    console.error('[SpeechModelRemove]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('speech:provider-status', async () => {
  try { await refreshSessionIfNeeded(); } catch {}
  const providers = speechProviders();
  const [local, cloud] = await Promise.all([
    providers.local.status(),
    Promise.resolve(providers.cloud.status())
  ]);
  return { local, cloud };
});

ipcMain.handle('speech:preflight', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  try {
    if (safePayload.mode === 'cloud') await refreshSessionIfNeeded();
    const data = await preflightSpeech({
      inputPath: safePayload.inputPath,
      mode: safePayload.mode,
      consent: safePayload.consent === true,
      providers: speechProviders()
    });
    return { ok: true, data };
  } catch (error) {
    const serialized = serializeSpeechError(error);
    console.error('[SpeechPreflight]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('speech:start', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  try {
    if (safePayload.mode === 'cloud') await refreshSessionIfNeeded();
    const data = await startSpeech({
      jobId: safePayload.jobId,
      inputPath: safePayload.inputPath,
      mode: safePayload.mode,
      consent: safePayload.consent === true,
      language: typeof safePayload.language === 'string' ? safePayload.language : 'auto',
      providers: speechProviders(),
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('speech:progress', progress);
        }
      }
    });
    return { ok: true, data };
  } catch (error) {
    const serialized = serializeSpeechError(error);
    console.error('[SpeechRecognition]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('speech:cancel', async (_event, jobId) => {
  if (typeof jobId !== 'string' || !jobId.trim()) return { ok: false, cancelled: false };
  return { ok: true, cancelled: await cancelSpeech(jobId) };
});

ipcMain.handle('app:set-locale', async (_event, locale) => {
  if (locale === 'vi' || locale === 'en') uiLocale = locale;
  return uiLocale;
});

ipcMain.handle('file:show-in-folder', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim() || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(path.resolve(filePath));
  return true;
});

ipcMain.handle('file:status', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { exists: false, reason: 'invalid' };
  }

  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    return {
      exists: stat.isFile(),
      path: resolved,
      sizeBytes: stat.size,
      modifiedAt: stat.mtimeMs
    };
  } catch {
    return { exists: false, path: resolved, reason: 'missing' };
  }
});

ipcMain.handle('file:trash', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, reason: 'invalid' };
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, reason: 'missing' };
  }

  await shell.trashItem(resolved);
  return { ok: true };
});

ipcMain.handle('files:select-replacement-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn lại video',
    properties: ['openFile'],
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).slice(1).toUpperCase()
  };
});


ipcMain.handle('video:file-url', async (_event, inputPath) => {
  const safePath = assertVideoPath(inputPath);
  return pathToFileURL(safePath).href;
});
