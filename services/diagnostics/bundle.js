function safeText(value, max = 160) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function safeBoolean(value) {
  return value === true;
}

function sanitizeLog(log, redact) {
  const apply = typeof redact === "function"
    ? value => redact(value)
    : value => String(value ?? "");

  const details = {};
  if (log?.details && typeof log.details === "object" && !Array.isArray(log.details)) {
    for (const [key, value] of Object.entries(log.details)) {
      if (/password|token|secret|authorization|cookie|api.?key|email|backend|url|path/i.test(key)) {
        continue;
      }
      details[String(key).slice(0, 80)] = apply(value);
    }
  }

  return {
    at: log?.at && !Number.isNaN(Date.parse(log.at))
      ? new Date(log.at).toISOString()
      : null,
    level: ["info", "warn", "error"].includes(log?.level)
      ? log.level
      : "info",
    event: apply(log?.event || "unknown").slice(0, 160),
    details
  };
}

function createDiagnosticBundle({
  release = {},
  runtime = {},
  logs = [],
  redact,
  exportedAt = new Date().toISOString()
} = {}) {
  return {
    schemaVersion: 1,
    exportedAt: new Date(exportedAt).toISOString(),
    product: {
      name: safeText(release.name, 120),
      version: safeText(release.version, 40),
      channel: safeText(release.channel, 40),
      commit: safeText(release.commit, 40),
      builtAt: release.builtAt && !Number.isNaN(Date.parse(release.builtAt))
        ? new Date(release.builtAt).toISOString()
        : null,
      platform: safeText(release.platform, 40),
      arch: safeText(release.arch, 40),
      packaged: safeBoolean(release.packaged),
      source: safeText(release.source, 80)
    },
    runtime: {
      platform: safeText(runtime.platform, 40),
      arch: safeText(runtime.arch, 40),
      windowsRelease: safeText(runtime.windowsRelease, 80),
      electron: safeText(runtime.electron, 40),
      chrome: safeText(runtime.chrome, 40),
      node: safeText(runtime.node, 40)
    },
    privacy: {
      redacted: true,
      accountDataIncluded: false,
      credentialsIncluded: false,
      cloudConfigurationIncluded: false,
      userMediaPathsIncluded: false
    },
    logs: (Array.isArray(logs) ? logs : [])
      .slice(-500)
      .map(item => sanitizeLog(item, redact))
  };
}

module.exports = {
  createDiagnosticBundle,
  sanitizeLog
};
