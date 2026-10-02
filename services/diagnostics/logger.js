const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 3;

function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message || value.name || "Error";
  try { return JSON.stringify(value); } catch { return String(value); }
}

function createRedactor({ userDataPath, tempPath } = {}) {
  const roots = [
    os.homedir(),
    userDataPath,
    tempPath
  ]
    .filter(Boolean)
    .map(item => path.resolve(String(item)))
    .sort((a, b) => b.length - a.length);

  return function redact(input) {
    let text = safeString(input);

    for (const root of roots) {
      if (!root) continue;
      const expression = new RegExp(
        root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      text = text.replace(
        expression,
        root === path.resolve(os.homedir()) ? "<HOME>" : "<APP_DATA>"
      );
    }

    const replacements = [
      [/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <REDACTED>"],
      [/(access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1$2<REDACTED>"],
      [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<REDACTED_API_KEY>"],
      [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "<REDACTED_TOKEN>"],
      [/([?&](?:token|key|secret|signature|code)=)[^&#\s]+/gi, "$1<REDACTED>"]
    ];

    for (const [pattern, replacement] of replacements) {
      text = text.replace(pattern, replacement);
    }

    if (text.length > 8000) {
      text = text.slice(0, 8000) + "…<TRUNCATED>";
    }

    return text;
  };
}

function createDiagnosticLogger({
  userDataPath,
  tempPath,
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = DEFAULT_MAX_FILES
}) {
  const logsDir = path.join(path.resolve(userDataPath), "logs");
  const logPath = path.join(logsDir, "app.jsonl");
  const redact = createRedactor({ userDataPath, tempPath });

  fs.mkdirSync(logsDir, { recursive: true });

  function rotateIfNeeded() {
    let size = 0;
    try { size = fs.statSync(logPath).size; } catch {}
    if (size < maxBytes) return;

    for (let index = maxFiles - 1; index >= 1; index--) {
      const from = index === 1 ? logPath : logPath + "." + (index - 1);
      const to = logPath + "." + index;
      try {
        if (fs.existsSync(to)) fs.rmSync(to, { force: true });
        if (fs.existsSync(from)) fs.renameSync(from, to);
      } catch {}
    }
  }

  function write(level, event, details = {}) {
    rotateIfNeeded();

    const safeDetails = {};
    if (details && typeof details === "object" && !Array.isArray(details)) {
      for (const [key, value] of Object.entries(details)) {
        if (/password|token|secret|authorization|cookie|api.?key/i.test(key)) continue;
        safeDetails[key] = redact(value);
      }
    } else {
      safeDetails.message = redact(details);
    }

    const record = {
      at: new Date().toISOString(),
      level: ["info", "warn", "error"].includes(level) ? level : "info",
      event: redact(event).slice(0, 160),
      details: safeDetails
    };

    try {
      fs.appendFileSync(logPath, JSON.stringify(record) + "\n", {
        encoding: "utf8",
        mode: 0o600
      });
      try { fs.chmodSync(logPath, 0o600); } catch {}
    } catch {}

    return record;
  }

  function readRecent(limit = 300) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit || 300)));
    const files = [];

    for (let index = maxFiles - 1; index >= 1; index--) {
      files.push(logPath + "." + index);
    }
    files.push(logPath);

    const lines = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            lines.push({
              at: item.at || null,
              level: item.level || "info",
              event: redact(item.event || "unknown"),
              details: Object.fromEntries(
                Object.entries(item.details || {}).map(([key, value]) => [key, redact(value)])
              )
            });
          } catch {}
        }
      } catch {}
    }

    return lines.slice(-safeLimit);
  }

  function installProcessHandlers() {
    const uncaught = error => {
      write("error", "process.uncaught_exception", {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
    };

    const rejected = reason => {
      write("error", "process.unhandled_rejection", {
        message: reason?.message || String(reason),
        stack: reason?.stack || null
      });
    };

    process.on("uncaughtExceptionMonitor", uncaught);
    process.on("unhandledRejection", rejected);

    return () => {
      process.off("uncaughtExceptionMonitor", uncaught);
      process.off("unhandledRejection", rejected);
    };
  }

  return {
    logPath,
    logsDir,
    redact,
    info(event, details) { return write("info", event, details); },
    warn(event, details) { return write("warn", event, details); },
    error(event, details) { return write("error", event, details); },
    readRecent,
    installProcessHandlers
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  createRedactor,
  createDiagnosticLogger
};
