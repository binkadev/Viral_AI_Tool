"use strict";
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { identifier } = require("./generation-request");
const { failure } = require("./generation-job");

// Only non-secret, supported settings cross this boundary. No environment overrides.
class ProviderConfigStore {
  constructor(root) { this.root = root; }
  file(id) {
    if (!identifier(id)) throw failure("INVALID_REQUEST");
    return path.join(this.root, id + ".json");
  }
  read(id) {
    const file = this.file(id);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return null;
      throw failure("PROVIDER_CONFIG_ERROR");
    }
    if (!raw || raw.version !== 1 || typeof raw.enabled !== "boolean" ||
        Object.keys(raw).some(key => !["version", "enabled"].includes(key))) throw failure("PROVIDER_CONFIG_ERROR");
    return { enabled: raw.enabled };
  }
  write(id, config) {
    const file = this.file(id);
    if (!config || Object.getPrototypeOf(config) !== Object.prototype ||
        Object.keys(config).length !== 1 || typeof config.enabled !== "boolean") throw failure("INVALID_REQUEST");
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify({ version: 1, enabled: config.enabled }), {encoding: "utf8", flag: "wx", mode: 0o600});
      fs.renameSync(temp, file);
    } catch { throw failure("PROVIDER_CONFIG_ERROR"); }
    finally { try { fs.unlinkSync(temp); } catch {} }
    return { enabled: config.enabled };
  }
}
module.exports = { ProviderConfigStore };
