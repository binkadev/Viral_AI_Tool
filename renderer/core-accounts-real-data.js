(function installCoreAccountsRealData() {
  "use strict";

  function locale() {
    try { return typeof state !== "undefined" && state?.locale === "en" ? "en" : "vi"; }
    catch { return "vi"; }
  }

  function esc(value) {
    try { return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? ""); }
    catch { return String(value ?? ""); }
  }

  function copy() {
    return locale() === "en"
      ? {
          title: "Account & security",
          desc: "Your real Cloud account and active desktop sessions.",
          account: "Cloud account",
          signedIn: "Signed in",
          signedOut: "Not signed in",
          signInBody: "Sign in to sync Cloud usage, billing and supported AI services.",
          signIn: "Sign in",
          email: "Email",
          plan: "Plan",
          usage: "Cloud minutes left",
          notSynced: "Not synced",
          sessions: "Devices & sessions",
          sessionsDesc: "Review devices that currently have access to this account.",
          refresh: "Refresh",
          loading: "Loading sessions…",
          none: "No session data is available yet.",
          current: "Current device",
          revoke: "Revoke",
          unsupported: "Social publishing integrations",
          unsupportedBody: "TikTok, YouTube, Instagram and Facebook are not connected to production account integrations yet. No social account is shown as connected unless a real provider connection exists."
        }
      : {
          title: "Tài khoản & bảo mật",
          desc: "Tài khoản Cloud thật và các phiên desktop đang hoạt động.",
          account: "Tài khoản Cloud",
          signedIn: "Đã đăng nhập",
          signedOut: "Chưa đăng nhập",
          signInBody: "Đăng nhập để đồng bộ Cloud usage, billing và các dịch vụ AI được hỗ trợ.",
          signIn: "Đăng nhập",
          email: "Email",
          plan: "Gói",
          usage: "Phút Cloud còn lại",
          notSynced: "Chưa đồng bộ",
          sessions: "Thiết bị & phiên đăng nhập",
          sessionsDesc: "Kiểm tra những thiết bị hiện đang có quyền truy cập tài khoản này.",
          refresh: "Làm mới",
          loading: "Đang tải phiên đăng nhập…",
          none: "Chưa có dữ liệu phiên đăng nhập.",
          current: "Thiết bị hiện tại",
          revoke: "Thu hồi",
          unsupported: "Kết nối mạng xã hội",
          unsupportedBody: "TikTok, YouTube, Instagram và Facebook hiện chưa được nối với tích hợp tài khoản production. Ứng dụng sẽ không hiển thị bất kỳ tài khoản mạng xã hội nào là đã kết nối khi chưa có kết nối provider thật."
        };
  }

  function page() {
    const c = copy();
    const auth = state?.cloud?.auth || null;
    const account = state?.cloud?.account || null;
    const user = account?.user || null;
    const quota = account?.quota || null;
    const sessions = Array.isArray(state?.cloud?.accountSessions) ? state.cloud.accountSessions : [];
    const authenticated = auth?.authenticated === true;
    const remaining = Number(quota?.remainingMinutes);
    const usage = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) + " min" : c.notSynced;

    const accountCard = authenticated
      ? '<section class="card card-pad core-real-account-card"><div class="eyebrow">' + esc(c.account) + '</div><h3>' + esc(user?.name || user?.displayName || user?.email || c.signedIn) + '</h3><p class="muted">' + esc(c.signedIn) + '</p><dl class="core-real-account-meta"><div><dt>' + esc(c.email) + '</dt><dd>' + esc(user?.email || "—") + '</dd></div><div><dt>' + esc(c.plan) + '</dt><dd>' + esc(user?.plan || auth?.plan || quota?.plan || "—") + '</dd></div><div><dt>' + esc(c.usage) + '</dt><dd>' + esc(usage) + '</dd></div></dl></section>'
      : '<section class="card card-pad core-real-account-card"><div class="eyebrow">' + esc(c.account) + '</div><h3>' + esc(c.signedOut) + '</h3><p class="muted">' + esc(c.signInBody) + '</p><button id="accountsSessionLogin" class="button primary" type="button">' + esc(c.signIn) + '</button></section>';

    const sessionRows = state?.cloud?.accountSessionsLoading
      ? '<div class="core-real-session-empty">' + esc(c.loading) + '</div>'
      : sessions.length
        ? sessions.map(session => '<div class="core-real-session-row"><div><b>' + esc(session.clientName || "Desktop") + '</b><span>' + esc(session.current ? c.current : (session.lastUsedAt || "")) + '</span></div>' + (session.current ? '<span class="core-real-session-current">' + esc(c.current) + '</span>' : '<button class="button ghost session-revoke" type="button" data-revoke-session="' + esc(session.id) + '">' + esc(c.revoke) + '</button>') + '</div>').join("")
        : '<div class="core-real-session-empty">' + esc(c.none) + '</div>';

    return '<div class="section-head"><div><h3>' + esc(c.title) + '</h3><p>' + esc(c.desc) + '</p></div></div><div class="core-real-account-grid">' + accountCard + '<section class="card card-pad core-real-session-card"><div class="core-real-account-head"><div><div class="eyebrow">' + esc(c.sessions) + '</div><p class="muted">' + esc(c.sessionsDesc) + '</p></div>' + (authenticated ? '<button id="accountSessionsRefresh" class="button ghost" type="button">' + esc(c.refresh) + '</button>' : '') + '</div><div class="core-real-session-list">' + sessionRows + '</div></section></div><section class="card card-pad core-social-disabled"><div class="eyebrow">' + esc(c.unsupported) + '</div><p class="muted">' + esc(c.unsupportedBody) + '</p></section>';
  }

  function install() {
    try {
      if (typeof pages === "undefined" || !pages) return false;
      pages.accounts = page;
      if (state?.page === "accounts" && typeof render === "function") render();
      document.documentElement.dataset.coreAccountsRealData = "enabled";
      return true;
    } catch { return false; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
  else install();
})();
