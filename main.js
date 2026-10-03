const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');
const {
  probeVideo,
  createThumbnail,
  preflightExport,
  preflightLocalizedExport,
  renderVideo,
  renderLocalizedVideo,
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
const {
  createService: createTranslationService,
  activeTranslationCount,
  cancelAllTranslations,
  serializeTranslationError
} = require('./services/translation');
const {
  createService: createVoiceService,
  activeVoiceCount,
  cancelAllVoice,
  serializeVoiceError
} = require('./services/voice');
const { createSessionStore } = require('./services/auth/session-store');
const { AuthClient } = require('./services/auth/auth-client');
const { BillingClient } = require('./services/billing/billing-client');
const { createCloudConfigStore } = require('./services/cloud/config-store');
const {
  checkForUpdate,
  downloadVerifiedInstaller
} = require('./services/update/update-client');
const {
  verifySamePublisher
} = require('./services/update/windows-signature');
const { createDiagnosticLogger } = require('./services/diagnostics/logger');
const { createDiagnosticBundle } = require('./services/diagnostics/bundle');

let mainWindow;
let sessionStore;
let cloudConfigStore;
let forceClose = false;
let closePromptOpen = false;
let uiLocale = 'vi';
let lastVerifiedUpdate = null;
let diagnosticLogger = null;
let removeDiagnosticProcessHandlers = null;
let removeDiagnosticConsoleCapture = null;

function releaseInfo() {
  let metadata = {};

  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'release-info.json'), 'utf8')
    );
    if (raw && typeof raw === 'object') metadata = raw;
  } catch {}

  const allowedChannels = new Set(['development', 'preview', 'stable']);
  const channel = allowedChannels.has(String(metadata.channel || '').toLowerCase())
    ? String(metadata.channel).toLowerCase()
    : 'development';

  const commit = /^[a-f0-9]{7,40}$/i.test(String(metadata.commit || ''))
    ? String(metadata.commit).toLowerCase()
    : null;

  const builtAt = metadata.builtAt && !Number.isNaN(Date.parse(metadata.builtAt))
    ? new Date(metadata.builtAt).toISOString()
    : null;

  const safeHttpsUrl = value => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  };

  return {
    name: app.getName(),
    version: app.getVersion(),
    channel,
    commit,
    builtAt,
    source: String(metadata.source || (app.isPackaged ? 'package' : 'workspace')).slice(0, 80),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    updateManifestUrl: safeHttpsUrl(metadata.updateManifestUrl),
    releasePageUrl: safeHttpsUrl(metadata.releasePageUrl),
    cloudBackendUrl: safeHttpsUrl(metadata.cloudBackendUrl)
  };
}

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
    activeTranslationCount() +
    activeVoiceCount() +
    speechModelManager.activeDownloadCount();
}

function authClient() {
  const cloudConfig = cloudConfigStore?.read() || { backendUrl: '' };
  return new AuthClient({
    backendUrl: cloudConfig.backendUrl || '',
    appVersion: app.getVersion()
  });
}

function billingClient() {
  const cloudConfig = cloudConfigStore?.read() || { backendUrl: '' };
  return new BillingClient({
    backendUrl: cloudConfig.backendUrl || '',
    appVersion: app.getVersion()
  });
}

async function withBillingSession(action) {
  const ready = await refreshSessionIfNeeded();
  if (!ready) {
    const error = new Error('Authentication is required.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const accessToken = sessionStore?.getAccessToken();
  if (!accessToken) {
    const error = new Error('Authentication is required.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  return action(billingClient(), accessToken);
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

function publicBillingError(error) {
  return {
    code: error?.code || "BILLING_REQUEST_FAILED",
    details: error?.details && typeof error.details === "object" ? error.details : {}
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

function translationService() {
  const cloudConfig = cloudConfigStore?.read() || {
    backendUrl: process.env.VIRAL_AI_CLOUD_URL || ''
  };

  return createTranslationService({
    backendUrl: cloudConfig.backendUrl || '',
    getAccessToken: () => sessionStore?.getAccessToken() || null,
    appVersion: app.getVersion()
  });
}


function voiceService() {
  const cloudConfig = cloudConfigStore?.read() || {
    backendUrl: process.env.VIRAL_AI_CLOUD_URL || ''
  };

  return createVoiceService({
    backendUrl: cloudConfig.backendUrl || '',
    getAccessToken: () => sessionStore?.getAccessToken() || null,
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData')
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
    icon: path.join(__dirname, 'assets', 'icon.ico'),
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
        await cancelAllTranslations();
        await cancelAllVoice();
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

  diagnosticLogger = createDiagnosticLogger({
    userDataPath: app.getPath('userData'),
    tempPath: app.getPath('temp')
  });
  removeDiagnosticProcessHandlers = diagnosticLogger.installProcessHandlers();
  removeDiagnosticConsoleCapture = diagnosticLogger.installConsoleCapture(console);
  diagnosticLogger.info('app.started', {
    release: releaseInfo(),
    electron: process.versions.electron,
    node: process.versions.node
  });

  sessionStore = createSessionStore({
    userDataPath: app.getPath('userData'),
    safeStorage
  });
  const release = releaseInfo();
  cloudConfigStore = createCloudConfigStore({
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
    releaseBackendUrl: release.cloudBackendUrl || '',
    releaseEnvironment: release.channel === 'stable' ? 'production' : 'development'
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try { diagnosticLogger?.info('app.stopping', { release: releaseInfo() }); } catch {}
  try { removeDiagnosticProcessHandlers?.(); } catch {}
  try { removeDiagnosticConsoleCapture?.(); } catch {}
  removeDiagnosticProcessHandlers = null;
  removeDiagnosticConsoleCapture = null;
});

ipcMain.handle('app:version-info', () => releaseInfo());

ipcMain.handle('diagnostics:open-folder', async () => {
  if (!diagnosticLogger?.logsDir) {
    return { ok: false, error: { code: 'DIAGNOSTICS_UNAVAILABLE', details: {} } };
  }

  const openError = await shell.openPath(diagnosticLogger.logsDir);
  return openError
    ? { ok: false, error: { code: 'DIAGNOSTICS_OPEN_FAILED', details: {} } }
    : { ok: true };
});

ipcMain.handle('diagnostics:export', async () => {
  if (!diagnosticLogger) {
    return { ok: false, error: { code: 'DIAGNOSTICS_UNAVAILABLE', details: {} } };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suggestedName = 'viral-ai-diagnostics-' + stamp + '.json';

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Viral AI Tool diagnostics',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: true, data: { cancelled: true } };
  }

  try {
    const release = releaseInfo();
    const logs = diagnosticLogger.readRecent(500);

    const bundle = createDiagnosticBundle({
      release,
      runtime: {
        platform: process.platform,
        arch: process.arch,
        windowsRelease: process.platform === 'win32' ? os.release() : null,
        electron: process.versions.electron || null,
        chrome: process.versions.chrome || null,
        node: process.versions.node || null
      },
      logs,
      redact: diagnosticLogger.redact
    });

    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    try { fs.chmodSync(result.filePath, 0o600); } catch {}

    diagnosticLogger.info('diagnostics.exported', {
      logCount: logs.length,
      bundleVersion: bundle.schemaVersion
    });

    return {
      ok: true,
      data: {
        cancelled: false,
        fileName: path.basename(result.filePath),
        logCount: logs.length
      }
    };
  } catch (error) {
    diagnosticLogger.error('diagnostics.export_failed', {
      name: error?.name,
      message: error?.message
    });
    return {
      ok: false,
      error: { code: 'DIAGNOSTICS_EXPORT_FAILED', details: {} }
    };
  }
});

ipcMain.handle('app:check-update', async () => {
  const current = releaseInfo();

  if (!current.updateManifestUrl) {
    return {
      ok: false,
      error: { code: 'UPDATE_NOT_CONFIGURED', details: {} }
    };
  }

  try {
    const result = await checkForUpdate({
      current,
      manifestUrl: current.updateManifestUrl,
      allowPreview: current.channel === 'preview',
      allowLocalhost: !app.isPackaged
    });

    return {
      ok: true,
      data: result
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error?.code || 'UPDATE_REQUEST_FAILED',
        details: error?.details && typeof error.details === 'object'
          ? { status: error.details.status || null }
          : {}
      }
    };
  }
});

ipcMain.handle('app:download-update', async () => {
  const current = releaseInfo();

  if (!current.updateManifestUrl) {
    return {
      ok: false,
      error: { code: 'UPDATE_NOT_CONFIGURED', details: {} }
    };
  }

  try {
    const result = await downloadVerifiedInstaller({
      current,
      manifestUrl: current.updateManifestUrl,
      outputDir: path.join(app.getPath('userData'), 'updates'),
      allowPreview: current.channel === 'preview',
      allowLocalhost: !app.isPackaged
    });

    lastVerifiedUpdate = {
      filePath: result.filePath,
      version: result.version,
      fileName: result.fileName,
      sha256: result.sha256,
      sizeBytes: result.sizeBytes
    };

    return {
      ok: true,
      data: {
        version: result.version,
        fileName: result.fileName,
        sizeBytes: result.sizeBytes
      }
    };
  } catch (error) {
    console.error('[UpdateDownload]', error?.code || error?.message);
    lastVerifiedUpdate = null;
    return {
      ok: false,
      error: {
        code: error?.code || 'UPDATE_DOWNLOAD_FAILED',
        details: error?.details && typeof error.details === 'object'
          ? { status: error.details.status || null }
          : {}
      }
    };
  }
});

ipcMain.handle('app:launch-update', async () => {
  if (getActiveWorkCount() > 0) {
    return {
      ok: false,
      error: {
        code: 'UPDATE_WORK_IN_PROGRESS',
        details: { activeWorkCount: getActiveWorkCount() }
      }
    };
  }

  const record = lastVerifiedUpdate;
  if (!record?.filePath) {
    return { ok: false, error: { code: 'UPDATE_NOT_DOWNLOADED', details: {} } };
  }

  const root = path.resolve(path.join(app.getPath('userData'), 'updates'));
  const target = path.resolve(record.filePath);

  if (
    target !== path.join(root, path.basename(target)) ||
    path.extname(target).toLowerCase() !== '.exe' ||
    !fs.existsSync(target)
  ) {
    lastVerifiedUpdate = null;
    return { ok: false, error: { code: 'UPDATE_INSTALLER_INVALID', details: {} } };
  }

  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size !== Number(record.sizeBytes || 0)) {
      lastVerifiedUpdate = null;
      return { ok: false, error: { code: 'UPDATE_SIZE_MISMATCH', details: {} } };
    }

    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(target))
      .digest('hex');

    const expected = String(record.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || digest !== expected) {
      lastVerifiedUpdate = null;
      try { fs.rmSync(target, { force: true }); } catch {}
      return { ok: false, error: { code: 'UPDATE_CHECKSUM_MISMATCH', details: {} } };
    }
  } catch {
    lastVerifiedUpdate = null;
    return { ok: false, error: { code: 'UPDATE_INSTALLER_INVALID', details: {} } };
  }

  if (
    app.isPackaged &&
    process.platform === 'win32' &&
    releaseInfo().channel === 'stable'
  ) {
    try {
      await verifySamePublisher({
        currentExecutable: process.execPath,
        installerPath: target
      });
    } catch (error) {
      console.error('[UpdateSignature]', error?.code || error?.message);
      return {
        ok: false,
        error: {
          code: error?.code || 'UPDATE_SIGNATURE_CHECK_FAILED',
          details: {}
        }
      };
    }
  }

  const launchError = await shell.openPath(target);
  if (launchError) {
    return {
      ok: false,
      error: { code: 'UPDATE_INSTALLER_LAUNCH_FAILED', details: {} }
    };
  }

  forceClose = true;
  setTimeout(() => {
    try { app.quit(); } catch {}
  }, 700);

  return {
    ok: true,
    data: {
      version: record.version,
      fileName: record.fileName,
      appWillQuit: true
    }
  };
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
    let verifiedAt = null;
    try {
      account = await authClient().me(session.accessToken);
      if (account) verifiedAt = sessionStore.setAccountSnapshot(account);
    } catch (error) {
      console.error('[AuthMeAfterLogin]', error?.code || error?.message);
    }

    return {
      ok: true,
      data: {
        status: sessionStore.status(),
        account,
        offline: false,
        verifiedAt
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
    const verifiedAt = sessionStore.setAccountSnapshot(account);

    return {
      ok: true,
      data: {
        status: sessionStore.status(),
        account,
        offline: false,
        verifiedAt
      }
    };
  } catch (error) {
    console.error('[AuthMe]', error?.code || error?.message);

    const offlineCodes = new Set([
      'AUTH_NETWORK',
      'AUTH_TIMEOUT',
      'AUTH_SERVICE_UNAVAILABLE'
    ]);

    if (offlineCodes.has(error?.code)) {
      const cached = sessionStore?.getAccountSnapshot?.();
      const status = sessionStore?.status();

      if (cached?.account && status?.authenticated) {
        return {
          ok: true,
          data: {
            status,
            account: cached.account,
            offline: true,
            verifiedAt: cached.verifiedAt || null
          }
        };
      }
    }

    return { ok: false, error: publicAuthError(error) };
  }
});

ipcMain.handle('auth:sessions', async () => {
  try {
    const ready = await refreshSessionIfNeeded();
    if (!ready) return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };

    const accessToken = sessionStore?.getAccessToken();
    if (!accessToken) return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };

    const data = await authClient().sessions(accessToken);
    return { ok: true, data };
  } catch (error) {
    console.error('[AuthSessions]', error?.code || error?.message);
    return { ok: false, error: publicAuthError(error) };
  }
});

ipcMain.handle('auth:revoke-session', async (_event, sessionId) => {
  try {
    const ready = await refreshSessionIfNeeded();
    if (!ready) return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };

    const accessToken = sessionStore?.getAccessToken();
    if (!accessToken) return { ok: false, error: { code: 'AUTH_REQUIRED', details: {} } };

    const data = await authClient().revokeSession(sessionId, accessToken);
    if (data?.currentSessionRevoked) sessionStore?.clear();

    return {
      ok: true,
      data,
      localSessionCleared: data?.currentSessionRevoked === true
    };
  } catch (error) {
    console.error('[AuthRevokeSession]', error?.code || error?.message);
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

ipcMain.handle('billing:catalog', async () => {
  try {
    const data = await withBillingSession((client, token) => client.catalog(token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingCatalog]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:invoices', async () => {
  try {
    const data = await withBillingSession((client, token) => client.invoices(token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingInvoices]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:checkout', async (_event, planId) => {
  try {
    const data = await withBillingSession((client, token) => client.checkout(planId, token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingCheckout]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:plan-change', async (_event, planId) => {
  try {
    const data = await withBillingSession((client, token) => client.changePlan(planId, token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingPlanChange]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:cancel', async () => {
  try {
    const data = await withBillingSession((client, token) => client.cancel(token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingCancel]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:resume', async () => {
  try {
    const data = await withBillingSession((client, token) => client.resume(token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingResume]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('billing:portal', async () => {
  try {
    const data = await withBillingSession((client, token) => client.portal(token));
    return { ok: true, data };
  } catch (error) {
    console.error('[BillingPortal]', error?.code || error?.message);
    return { ok: false, error: publicBillingError(error) };
  }
});

ipcMain.handle('app:open-external', async (_event, rawUrl) => {
  try {
    const target = new URL(String(rawUrl || '').trim());
    const localHttp = target.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(target.hostname);
    const allowed = target.protocol === 'https:' || localHttp;

    if (!allowed) return { ok: false, code: 'EXTERNAL_URL_NOT_ALLOWED' };

    await shell.openExternal(target.toString());
    return { ok: true };
  } catch {
    return { ok: false, code: 'EXTERNAL_URL_INVALID' };
  }
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
  const before = cloudConfigStore?.read() || null;

  const previewValidation = cloudConfigStore?.validateBackendUrl(safePayload.backendUrl);
  if (!previewValidation?.ok) return previewValidation;

  const nextEnvironment = safePayload.environment === 'production' ? 'production' : 'development';
  if (previewValidation.backendUrl && nextEnvironment === 'production') {
    const parsed = new URL(previewValidation.backendUrl);
    if (parsed.protocol !== 'https:') return { ok: false, code: 'CLOUD_HTTPS_REQUIRED' };
  }

  const endpointWillChange =
    (before?.backendUrl || '') !== (previewValidation.backendUrl || '') ||
    (before?.environment || 'development') !== nextEnvironment;

  let previousSessionRemotePending = false;

  if (endpointWillChange && before?.backendUrl) {
    const refreshToken = sessionStore?.getRefreshToken() || null;
    const accessToken = sessionStore?.getAccessToken() || null;

    if (refreshToken || accessToken) {
      try {
        const oldClient = new AuthClient({
          backendUrl: before.backendUrl,
          appVersion: app.getVersion()
        });
        const logoutResult = await oldClient.logout(refreshToken, accessToken);
        previousSessionRemotePending = logoutResult?.remotePending === true;
      } catch {
        previousSessionRemotePending = true;
      }
    }
  }

  const result = cloudConfigStore?.write({
    environment: nextEnvironment,
    backendUrl: previewValidation.backendUrl
  });

  if (result?.ok) {
    if (endpointWillChange) sessionStore?.clear();

    return {
      ...result,
      sessionCleared: endpointWillChange,
      previousSessionRemotePending
    };
  }

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

ipcMain.handle('video:preflight-localized-export', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    return {
      ok: true,
      data: preflightLocalizedExport({
        inputPath: safePayload.inputPath,
        outputDir: safePayload.outputDir,
        voiceSegments: Array.isArray(safePayload.voiceSegments) ? safePayload.voiceSegments : [],
        subtitleSegments: Array.isArray(safePayload.subtitleSegments) ? safePayload.subtitleSegments : [],
        allowedAudioRoot: path.join(app.getPath('userData'), 'voice-cache'),
        burnSubtitles: safePayload.burnSubtitles !== false
      })
    };
  } catch (error) {
    const serialized = serializeProcessingError(error);
    console.error('[LocalizedExportPreflight]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('video:render-localized', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    const data = await renderLocalizedVideo({
      jobId: safePayload.jobId,
      inputPath: safePayload.inputPath,
      outputDir: safePayload.outputDir,
      voiceSegments: Array.isArray(safePayload.voiceSegments) ? safePayload.voiceSegments : [],
      subtitleSegments: Array.isArray(safePayload.subtitleSegments) ? safePayload.subtitleSegments : [],
      allowedAudioRoot: path.join(app.getPath('userData'), 'voice-cache'),
      burnSubtitles: safePayload.burnSubtitles !== false,
      mixOriginalAudio: safePayload.mixOriginalAudio !== false,
      originalAudioVolume: Number.isFinite(Number(safePayload.originalAudioVolume))
        ? Number(safePayload.originalAudioVolume)
        : 0.12,
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('video:render-progress', progress);
        }
      }
    });

    return { ok: true, data };
  } catch (error) {
    const serialized = serializeProcessingError(error);
    console.error('[LocalizedVideoExport]', serialized.code, serialized.technicalMessage);

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

ipcMain.handle('translation:status', async () => {
  try {
    await refreshSessionIfNeeded();
    return await translationService().status();
  } catch (error) {
    const serialized = serializeTranslationError(error);
    console.error('[TranslationStatus]', serialized.code, serialized.technicalMessage);
    return { ready: false, code: serialized.code };
  }
});

ipcMain.handle('translation:start', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    await refreshSessionIfNeeded();

    const data = await translationService().start({
      jobId: safePayload.jobId,
      sourceLanguage: typeof safePayload.sourceLanguage === 'string' ? safePayload.sourceLanguage : 'auto',
      targetLanguage: safePayload.targetLanguage,
      preserveTone: safePayload.preserveTone !== false,
      segments: Array.isArray(safePayload.segments) ? safePayload.segments : [],
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('translation:progress', progress);
        }
      }
    });

    return { ok: true, data };
  } catch (error) {
    const serialized = serializeTranslationError(error);
    console.error('[Translation]', serialized.code, serialized.technicalMessage);
    return {
      ok: false,
      error: {
        code: serialized.code,
        details: serialized.details
      }
    };
  }
});

ipcMain.handle('translation:cancel', async (_event, jobId) => {
  if (typeof jobId !== 'string' || !jobId.trim()) return { ok: false, cancelled: false };

  try {
    return {
      ok: true,
      cancelled: await translationService().cancel(jobId)
    };
  } catch (error) {
    const serialized = serializeTranslationError(error);
    console.error('[TranslationCancel]', serialized.code, serialized.technicalMessage);
    return { ok: false, cancelled: false, error: { code: serialized.code } };
  }
});

ipcMain.handle('voice:status', async () => {
  try {
    await refreshSessionIfNeeded();
    return await voiceService().status();
  } catch (error) {
    const serialized = serializeVoiceError(error);
    console.error('[VoiceStatus]', serialized.code, serialized.technicalMessage);
    return { ready: false, code: serialized.code, catalog: [] };
  }
});

ipcMain.handle('voice:catalog', async () => {
  try {
    await refreshSessionIfNeeded();
    return { ok: true, data: await voiceService().catalog() };
  } catch (error) {
    const serialized = serializeVoiceError(error);
    console.error('[VoiceCatalog]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('voice:preview', async (_event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    await refreshSessionIfNeeded();

    const data = await voiceService().preview({
      voiceId: safePayload.voiceId,
      text: safePayload.text,
      language: safePayload.language
    });

    return { ok: true, data };
  } catch (error) {
    const serialized = serializeVoiceError(error);
    console.error('[VoicePreview]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('voice:start', async (event, payload) => {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  try {
    await refreshSessionIfNeeded();

    const data = await voiceService().start({
      jobId: safePayload.jobId,
      language: safePayload.language,
      assignments: safePayload.assignments,
      segments: Array.isArray(safePayload.segments) ? safePayload.segments : [],
      onProgress: progress => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('voice:progress', progress);
        }
      }
    });

    return { ok: true, data };
  } catch (error) {
    const serialized = serializeVoiceError(error);
    console.error('[VoiceGeneration]', serialized.code, serialized.technicalMessage);
    return { ok: false, error: { code: serialized.code, details: serialized.details } };
  }
});

ipcMain.handle('voice:cancel', async (_event, jobId) => {
  if (typeof jobId !== 'string' || !jobId.trim()) return { ok: false, cancelled: false };

  try {
    return { ok: true, cancelled: await voiceService().cancel(jobId) };
  } catch (error) {
    const serialized = serializeVoiceError(error);
    console.error('[VoiceCancel]', serialized.code, serialized.technicalMessage);
    return { ok: false, cancelled: false, error: { code: serialized.code } };
  }
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
