'use strict';

const statusEl = document.getElementById('status');
const profileInput = document.getElementById('profileLabel');
const tabsEl = document.getElementById('tabs');
const saveButton = document.getElementById('save');
const openButton = document.getElementById('open');
const reconnectButton = document.getElementById('reconnect');

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

function message(payload) {
  return chrome.runtime.sendMessage(payload);
}

async function refresh() {
  try {
    const state = await message({ type: 'viral-ai:bridge-state' });
    profileInput.value = state?.profileLabel || '';
    statusEl.className = 'status ' + (state?.connected ? 'ok' : 'warn');
    statusEl.textContent = state?.connected
      ? `Đã nối Viral AI Tool · cổng ${state.bridgePort}`
      : 'Chưa thấy Viral AI Tool đang chạy';
    const tabs = Array.isArray(state?.tabs) ? state.tabs : [];
    tabsEl.innerHTML = tabs.length
      ? tabs.map(tab => `<div class="tab"><i class="${tab.composerReady ? 'ready' : ''}"></i><div><b>${esc(tab.title || 'Muse')}</b><small>${esc(tab.composerReady ? 'Sẵn sàng tạo video' : 'Mở tab và đăng nhập Muse')}</small></div></div>`).join('')
      : '<div class="empty">Chưa có tab muse.ai trong profile này.</div>';
  } catch (error) {
    statusEl.className = 'status warn';
    statusEl.textContent = 'Bridge extension chưa sẵn sàng';
  }
}

saveButton.addEventListener('click', async () => {
  const value = profileInput.value.trim();
  if (!value) return;
  await message({ type: 'viral-ai:set-profile-label', profileLabel: value });
  await refresh();
});

openButton.addEventListener('click', async () => {
  await message({ type: 'viral-ai:open-muse' });
  window.close();
});

reconnectButton.addEventListener('click', async () => {
  statusEl.textContent = 'Đang kết nối lại…';
  await message({ type: 'viral-ai:reconnect' });
  setTimeout(refresh, 600);
});

refresh();
