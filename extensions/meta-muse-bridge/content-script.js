'use strict';

const SELECTORS = Object.freeze({
  composerRoot: '[data-hatch-composer-root]',
  editor: '[data-lexical-editor="true"], [data-hatch-composer-root] textarea, [data-hatch-composer-prehydration-input], [data-hatch-composer-root] [contenteditable="true"]',
  stopButton: '[data-testid="hatch-composer-stop-button"]',
  actionSlot: '[data-hatch-composer-action-slot]',
  assistant: '[data-message-item][data-message-role="assistant"]',
  errorNotice: '[data-testid="assistant-response-error-notice"]'
});

const cancelledCommands = new Set();
let keepAlivePort = null;

function connectKeepAlive() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'viral-ai-muse-tab' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(connectKeepAlive, 1200);
    });
  } catch {
    setTimeout(connectKeepAlive, 1800);
  }
}
connectKeepAlive();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function composer() {
  return document.querySelector(SELECTORS.editor);
}

function status() {
  const editor = composer();
  const root = document.querySelector(SELECTORS.composerRoot);
  const composerReady = Boolean(editor && root);
  const accountNode = document.querySelector('[aria-label*="profile" i], [aria-label*="account" i], [data-testid*="profile" i]');
  return {
    loggedIn: composerReady,
    composerReady,
    accountLabel: accountNode ? String(accountNode.getAttribute('aria-label') || accountNode.textContent || '').trim().slice(0, 160) : '',
    url: location.href,
    title: document.title
  };
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

async function fillEditor(prompt) {
  const editor = composer();
  if (!editor) throw Object.assign(new Error('Muse composer is not ready.'), { code: 'COMPOSER_NOT_READY' });
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    setNativeValue(editor, prompt);
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('delete', false);
  const inserted = document.execCommand('insertText', false, prompt);
  if (!inserted || !String(editor.textContent || '').trim()) {
    editor.textContent = prompt;
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: prompt
    }));
  }
  await sleep(100);
}

function assistantNodes() {
  return Array.from(document.querySelectorAll(SELECTORS.assistant));
}

function unique(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function mediaFromNode(node) {
  if (!node) return { text: '', urls: [] };
  const urls = [];
  node.querySelectorAll('video').forEach(video => {
    if (video.currentSrc) urls.push(video.currentSrc);
    if (video.src) urls.push(video.src);
  });
  node.querySelectorAll('video source[src]').forEach(source => urls.push(source.src));
  node.querySelectorAll('a[href]').forEach(anchor => urls.push(anchor.href));
  node.querySelectorAll('[src]').forEach(element => {
    const src = element.src || element.getAttribute('src');
    if (src) urls.push(src);
  });
  const filtered = unique(urls).filter(url => {
    return /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url)
      || /muse\.ai\/files\//i.test(url)
      || /^blob:https:\/\/muse\.ai\//i.test(url);
  });
  return { text: String(node.innerText || '').trim().slice(0, 4000), urls: filtered };
}

function pageMediaFallback() {
  const urls = [];
  document.querySelectorAll('video').forEach(video => {
    if (video.currentSrc) urls.push(video.currentSrc);
    if (video.src) urls.push(video.src);
  });
  return unique(urls).filter(url => /^(?:blob:https:\/\/muse\.ai\/|https?:\/\/)/i.test(url));
}

async function sendPrompt(prompt) {
  await fillEditor(prompt);
  const actionButtons = Array.from(document.querySelectorAll(`${SELECTORS.actionSlot} button`)).filter(button => !button.disabled && button.offsetParent !== null);
  const sendButton = actionButtons[actionButtons.length - 1];
  if (sendButton) {
    sendButton.click();
  } else {
    const editor = composer();
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent('keydown', init));
    editor.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  for (let i = 0; i < 15; i += 1) {
    await sleep(250);
    const currentText = String(composer()?.textContent || composer()?.value || '').trim();
    const stopVisible = Boolean(document.querySelector(SELECTORS.stopButton));
    if (!currentText || stopVisible) return;
  }
  throw Object.assign(new Error('Muse did not accept the prompt.'), { code: 'PROMPT_NOT_SENT' });
}

function progress(commandId, payload) {
  try { chrome.runtime.sendMessage({ type: 'viral-ai:muse-progress', commandId, progress: payload }); } catch {}
}

async function generate(commandId, prompt, timeoutMs) {
  const before = assistantNodes().length;
  cancelledCommands.delete(commandId);
  progress(commandId, { phase: 'preparing', progress: 2 });
  await sendPrompt(prompt);
  progress(commandId, { phase: 'submitted', progress: 6 });

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(60000, Number(timeoutMs || 720000));
  let sawActivity = false;
  let lastProgressAt = 0;

  while (Date.now() < deadline) {
    if (cancelledCommands.has(commandId)) {
      document.querySelector(SELECTORS.stopButton)?.click();
      throw Object.assign(new Error('Muse generation was cancelled.'), { code: 'CANCELLED' });
    }

    const errorNode = document.querySelector(SELECTORS.errorNotice);
    if (errorNode) {
      const message = String(errorNode.textContent || 'Muse returned an error.').trim();
      throw Object.assign(new Error(message), { code: 'MUSE_RESPONSE_ERROR' });
    }

    const nodes = assistantNodes();
    const stopVisible = Boolean(document.querySelector(SELECTORS.stopButton));
    if (stopVisible || nodes.length > before) sawActivity = true;

    const newest = nodes.length > before ? nodes[nodes.length - 1] : null;
    const media = mediaFromNode(newest);
    const fallbackUrls = pageMediaFallback();
    const urls = unique([...media.urls, ...fallbackUrls]);

    if (urls.length && sawActivity && !stopVisible) {
      progress(commandId, { phase: 'generated', progress: 96 });
      return {
        mediaUrl: urls[0],
        allMediaUrls: urls.slice(0, 8),
        text: media.text,
        threadUrl: location.href
      };
    }

    const now = Date.now();
    if (now - lastProgressAt > 1500) {
      const elapsed = now - startedAt;
      const estimated = Math.min(92, 8 + Math.floor(elapsed / 5000) * 4);
      progress(commandId, { phase: sawActivity ? 'generating' : 'waiting', progress: estimated });
      lastProgressAt = now;
    }
    await sleep(700);
  }

  throw Object.assign(new Error('Muse generation timed out.'), { code: 'PROVIDER_TIMEOUT' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'viral-ai:muse-status') {
    sendResponse(status());
    return false;
  }
  if (message?.type === 'viral-ai:muse-cancel') {
    const target = String(message.targetCommandId || '');
    if (target) cancelledCommands.add(target);
    document.querySelector(SELECTORS.stopButton)?.click();
    sendResponse({ ok: true, cancelled: true });
    return false;
  }
  if (message?.type === 'viral-ai:muse-generate') {
    (async () => {
      try {
        if (!status().composerReady) throw Object.assign(new Error('Sign in to Muse before generating.'), { code: 'LOGIN_REQUIRED' });
        const result = await generate(String(message.commandId || ''), String(message.prompt || ''), Number(message.timeoutMs || 720000));
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({
          ok: false,
          error: {
            code: String(error?.code || 'META_MUSE_FAILED'),
            message: String(error?.message || error || 'Muse generation failed.').slice(0, 800)
          }
        });
      }
    })();
    return true;
  }
  return false;
});
