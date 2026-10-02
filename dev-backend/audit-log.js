const fs = require("fs");
const path = require("path");

const MAX_AUDIT_BYTES = 8 * 1024 * 1024;

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|token|secret|authorization|cookie/i.test(key)) continue;
      output[key] = sanitizeValue(item, depth + 1);
    }
    return output;
  }

  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + "…" : value;
  }

  if (["number", "boolean"].includes(typeof value) || value == null) return value;
  return String(value);
}

function createAuditLog(filePath) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(resolved);
      if (stat.size < MAX_AUDIT_BYTES) return;
      const archive = resolved.replace(/\.jsonl$/i, "") + "-" + Date.now() + ".jsonl";
      fs.renameSync(resolved, archive);
    } catch {}
  }

  function write(event, details = {}) {
    rotateIfNeeded();

    const record = {
      at: new Date().toISOString(),
      event: String(event || "unknown").slice(0, 120),
      ...sanitizeValue(details)
    };

    fs.appendFileSync(resolved, JSON.stringify(record) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });

    try { fs.chmodSync(resolved, 0o600); } catch {}
    return record;
  }

  return {
    path: resolved,
    write
  };
}

module.exports = {
  createAuditLog
};
