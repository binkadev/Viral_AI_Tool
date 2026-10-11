'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright-core');

const DEFAULT_APP_URL = 'https://muse.ai/';
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const SELECTORS = Object.freeze({
  composerRoot: '[data-hatch-composer-root]',
  editor: '[data-lexical-editor="true"], [data-hatch-composer-root] textarea, [data-hatch-composer-prehydration-input], [data-hatch-composer-root] [contenteditable="true"]',
  stopButton: '[data-testid="hatch-composer-stop-button"]',
  actionSlot: '[data-hatch-composer-action-slot]',
  assistant: '[data-message-item][data-message-role="assistant"]',
  errorNotice: '[data-testid="assistant-response-error-notice"]'
});

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function museError(code, message, details = {}) {
  const error = new Error(String(message || code || 'META_MUSE_FAILED'));
  error.code = String(code || 'META_MUSE_FAILED');
  error.details = details;
  return error;
}

function abortError() {
  const error = museError('CANCELLED', 'Muse generation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function safeText(value, max = 6000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function buildScenePrompt(request = {}) {
  const visual = safeText(request.visualIntent || request.prompt || request.query, 2400);
  const narration = safeText(request.narration, 1800);
  const aspect = ['16:9', '9:16', '1:1'].includes(String(request.aspectRatio || ''))
    ? String(request.aspectRatio)
    : '9:16';
  const seconds = Math.max(2, Math.min(30, Number(request.desiredDurationSec || 5)));
  const negatives = Array.isArray(request.negativeConstraints)
    ? request.negativeConstraints.map(item => safeText(item, 120)).filter(Boolean).slice(0, 8)
    : [];
  const lines = [
    'Generate the actual video clip in this chat for a short-form edited video.',
    visual ? 'Visual direction: ' + visual : '',
    narration ? 'Narration context only (do not render these words as text): ' + narration : '',
    'Target aspect ratio: ' + aspect + '.',
    'Target duration: about ' + seconds.toFixed(1).replace(/\.0$/, '') + ' seconds.',
    'No subtitles, captions, UI, logos, or text overlays.',
    negatives.length ? 'Avoid: ' + negatives.join(', ') + '.' : '',
    'Return/generate the video itself, not a written storyboard or explanation.'
  ].filter(Boolean);
  return lines.join('\n').slice(0, 6000);
}

function mediaExtension(url, contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('webm')) return '.webm';
  if (type.includes('mp4')) return '.mp4';
  try {
    const ext = path.extname(new URL(String(url || '')).pathname).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return ext;
  } catch {}
  return '.mp4';
}

class MetaMuseBrowser {
  constructor({ profileDir, appUrl = DEFAULT_APP_URL, headless = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!profileDir) throw new Error('Meta Muse browser profile directory is required.');
    this.profileDir = path.resolve(profileDir);
    this.appUrl = appUrl;
    this.headless = headless === true;
    this.timeoutMs = Math.max(60000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
    this.context = null;
    this.page = null;
    this.channel = null;
    this.queue = Promise.resolve();
  }

  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  isRunning() {
    return Boolean(this.context && this.page && !this.page.isClosed());
  }

  async launch() {
    if (this.isRunning()) return this.page;
    await fsp.mkdir(this.profileDir, { recursive: true });
    const errors = [];
    for (const channel of ['chrome', 'msedge']) {
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, {
          channel,
          headless: this.headless,
          viewport: { width: 1366, height: 900 },
          acceptDownloads: false,
          ignoreDefaultArgs: ['--enable-automation'],
          args: [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=Translate,OptimizationGuideModelDownloading'
          ]
        });
        this.channel = channel;
        break;
      } catch (error) {
        errors.push(String(error?.message || error));
        this.context = null;
      }
    }
    if (!this.context) {
      throw museError('BROWSER_UNAVAILABLE', 'Chrome or Edge could not be opened for Muse.', { errors });
    }
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
      this.channel = null;
    });
    const pages = this.context.pages();
    this.page = pages.find(page => page.url().startsWith('https://muse.ai')) || pages[0] || await this.context.newPage();
    this.page.setDefaultTimeout(60000);
    await this.gotoMuse();
    return this.page;
  }

  async gotoMuse() {
    const page = await this.requirePage();
    if (!page.url().startsWith('https://muse.ai')) {
      await page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    return page;
  }

  async requirePage() {
    if (!this.isRunning()) await this.launch();
    return this.page;
  }

  async authStatus() {
    if (!this.isRunning()) return { ok: false, status: 0 };
    try {
      return await this.page.evaluate(async () => {
        try {
          const response = await fetch('/api/auth/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            credentials: 'same-origin'
          });
          const payload = await response.json().catch(() => null);
          return {
            status: response.status,
            ok: Boolean(payload?.ok),
            viewerId: payload?.viewer_id || null
          };
        } catch (error) {
          return { status: 0, ok: false, error: String(error) };
        }
      });
    } catch (error) {
      return { status: 0, ok: false, error: String(error?.message || error) };
    }
  }

  async composerReady() {
    if (!this.isRunning()) return false;
    try {
      return await this.page.locator(SELECTORS.editor).first().isVisible({ timeout: 4000 });
    } catch {
      return false;
    }
  }

  async status({ launch = false } = {}) {
    if (launch && !this.isRunning()) await this.launch();
    if (!this.isRunning()) {
      return {
        browserRunning: false,
        loggedIn: false,
        composerReady: false,
        profileDir: this.profileDir,
        channel: null
      };
    }
    const auth = await this.authStatus();
    return {
      browserRunning: true,
      loggedIn: auth.ok === true,
      composerReady: await this.composerReady(),
      profileDir: this.profileDir,
      channel: this.channel,
      url: this.page.url(),
      viewerId: auth.viewerId || null
    };
  }

  async openForLogin() {
    const page = await this.launch();
    await page.bringToFront().catch(() => {});
    return this.status();
  }

  async ensureReady() {
    await this.gotoMuse();
    const auth = await this.authStatus();
    if (!auth.ok) throw museError('LOGIN_REQUIRED', 'Sign in to Muse in the opened browser first.');
    try {
      await this.page.locator(SELECTORS.editor).first().waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      throw museError('COMPOSER_NOT_READY', 'Muse composer is not ready.');
    }
  }

  async clearAndType(prompt) {
    const page = this.page;
    const editor = page.locator(SELECTORS.editor).first();
    await editor.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.keyboard.insertText(prompt);
    await sleep(120);
  }

  async composerText() {
    try {
      const editor = this.page.locator(SELECTORS.editor).first();
      const tag = await editor.evaluate(node => node.tagName);
      if (tag === 'TEXTAREA' || tag === 'INPUT') return await editor.inputValue();
      return await editor.innerText();
    } catch {
      return '';
    }
  }

  async latestAssistantMedia(afterCount = 0) {
    const assistant = this.page.locator(SELECTORS.assistant);
    const count = await assistant.count();
    if (count <= afterCount) return { count, text: '', urls: [] };
    const last = assistant.last();
    const result = await last.evaluate(node => {
      const urls = [...new Set(
        [...node.querySelectorAll('a[href], video[src], video source[src], source[src]')]
          .map(item => item.href || item.currentSrc || item.src || item.getAttribute?.('src'))
          .filter(Boolean)
      )];
      return {
        text: String(node.innerText || '').trim(),
        urls
      };
    }).catch(() => ({ text: '', urls: [] }));
    const videoUrls = result.urls.filter(url => {
      const value = String(url || '');
      return /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value) || /muse\.ai\/files\//i.test(value);
    });
    return { count, text: result.text, urls: videoUrls };
  }

  async generateVideo(request, { signal, onProgress } = {}) {
    return this.serial(async () => {
      throwIfAborted(signal);
      await this.ensureReady();
      const page = this.page;
      // A fresh home chat keeps one scene's generation from contaminating another scene.
      await page.goto(this.appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.ensureReady();
      const before = await page.locator(SELECTORS.assistant).count();
      const prompt = buildScenePrompt(request);
      if (!prompt) throw museError('INVALID_INPUT', 'Muse scene prompt is empty.');
      onProgress?.({ phase: 'preparing', progress: 2 });
      await this.clearAndType(prompt);
      throwIfAborted(signal);
      await page.keyboard.press('Enter');

      let sent = false;
      for (let index = 0; index < 12; index += 1) {
        await sleep(300, signal);
        const text = (await this.composerText()).trim();
        const stopCount = await page.locator(SELECTORS.stopButton).count();
        if (!text || stopCount > 0) { sent = true; break; }
      }
      if (!sent) {
        const send = page.locator(`${SELECTORS.actionSlot} button`).last();
        if (await send.count()) await send.click({ timeout: 5000 }).catch(() => {});
      }

      const startedAt = Date.now();
      const deadline = startedAt + this.timeoutMs;
      let sawStreaming = false;
      let stableSince = Date.now();
      let previousText = '';
      let latest = { text: '', urls: [] };
      onProgress?.({ phase: 'submitted', progress: 5 });

      while (Date.now() < deadline) {
        throwIfAborted(signal);
        const stopCount = await page.locator(SELECTORS.stopButton).count();
        if (stopCount > 0) sawStreaming = true;
        latest = await this.latestAssistantMedia(before);
        if (latest.text !== previousText) {
          previousText = latest.text;
          stableSince = Date.now();
        }
        if (await page.locator(SELECTORS.errorNotice).count()) {
          const message = await page.locator(SELECTORS.errorNotice).first().innerText().catch(() => 'Muse could not complete this request.');
          throw museError('PROVIDER_REJECTED', message);
        }
        const elapsed = Date.now() - startedAt;
        const estimated = Math.min(92, 7 + Math.floor(elapsed / 6000) * 3);
        onProgress?.({ phase: latest.urls.length ? 'finalizing' : 'generating', progress: estimated });
        const stableMs = Date.now() - stableSince;
        if (latest.urls.length && stopCount === 0 && ((sawStreaming && stableMs > 1200) || (!sawStreaming && stableMs > 2500))) break;
        await sleep(500, signal);
      }

      if (!latest.urls.length) {
        throw museError(Date.now() >= deadline ? 'PROVIDER_TIMEOUT' : 'MUSE_NO_VIDEO',
          Date.now() >= deadline ? 'Muse video generation timed out.' : 'Muse finished without a downloadable video.',
          { reply: latest.text.slice(0, 1000), threadUrl: page.url() });
      }
      onProgress?.({ phase: 'generated', progress: 94 });
      return {
        mediaUrl: latest.urls[0],
        threadUrl: page.url(),
        reply: latest.text
      };
    });
  }

  async downloadMedia(url, destinationPath, { signal, onProgress } = {}) {
    throwIfAborted(signal);
    if (!this.context) throw museError('BROWSER_NOT_RUNNING', 'Muse browser is not running.');
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
    const temp = destinationPath + '.part';
    await fsp.rm(temp, { force: true }).catch(() => {});
    onProgress?.({ phase: 'downloading', progress: 96 });
    try {
      if (String(url).startsWith('blob:')) {
        const payload = await this.page.evaluate(async mediaUrl => {
          const response = await fetch(mediaUrl);
          if (!response.ok) return { ok: false, status: response.status };
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = '';
          const chunk = 0x8000;
          for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
          }
          return { ok: true, mime: response.headers.get('content-type') || '', b64: btoa(binary) };
        }, String(url));
        if (!payload?.ok || !payload?.b64) throw museError('DOWNLOAD_FAILED', 'Could not download Muse media from the browser.');
        await fsp.writeFile(temp, Buffer.from(payload.b64, 'base64'));
        await fsp.rename(temp, destinationPath);
        return { path: destinationPath, contentType: payload.mime || '', extension: mediaExtension(url, payload.mime) };
      }

      const response = await this.context.request.get(String(url), { timeout: 120000, failOnStatusCode: false });
      if (!response.ok()) throw museError('DOWNLOAD_FAILED', 'Muse media download failed.', { status: response.status() });
      const body = await response.body();
      if (!body?.length) throw museError('DOWNLOAD_FAILED', 'Muse media download was empty.');
      await fsp.writeFile(temp, body);
      await fsp.rename(temp, destinationPath);
      const contentType = response.headers()['content-type'] || '';
      return { path: destinationPath, contentType, extension: mediaExtension(url, contentType) };
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async close() {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.channel = null;
    if (context) await context.close().catch(() => {});
  }
}

function createMetaMuseBrowser(options) {
  return new MetaMuseBrowser(options);
}

module.exports = {
  DEFAULT_APP_URL,
  SELECTORS,
  buildScenePrompt,
  mediaExtension,
  createMetaMuseBrowser,
  museError
};
