"use strict";
const fs = require("fs");
const path = require("path");
const { failure, TRANSITIONS } = require("./generation-job");
const { normalizeRequest } = require("./generation-request");
const { getModel } = require("./model-catalog");
const { estimateGenerationCost } = require("./cost-estimator");
class GenerationStore {
  constructor(root) { this.root = root; this.file = path.join(root, "jobs.json"); }
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.jobs)) throw failure("STORE_UNAVAILABLE");
      const ids = new Set();
      return data.jobs.map(j => {
        const model = getModel(j.modelId);
        if (!/^[a-f0-9-]{36}$/.test(j.id) || ids.has(j.id) || !Object.hasOwn(TRANSITIONS, j.status) || !model ||
            !Number.isFinite(Date.parse(j.createdAt)) || !Number.isFinite(Date.parse(j.updatedAt))) throw failure("STORE_UNAVAILABLE");
        ids.add(j.id);
        const request = normalizeRequest(j.request);
        return { version: 1, id: j.id, status: j.status, request, modelId: model.id, provider: model.provider,
          estimate: estimateGenerationCost(model.id, request), retryOf: /^[a-f0-9-]{36}$/.test(j.retryOf) ? j.retryOf : null,
          createdAt: j.createdAt, updatedAt: j.updatedAt,
          errorCode: ["GENERATION_FAILED", "RECOVERY_REQUIRED", "ASSET_UNAVAILABLE"].includes(j.errorCode) ? j.errorCode : null,
          asset: j.asset && /^[a-f0-9-]{36}\.mp4$/.test(j.asset.fileName) ? { fileName: j.asset.fileName } : null };
      });
    } catch (e) { if (e.code === "ENOENT") return []; throw failure("STORE_UNAVAILABLE"); }
  }
  save(jobs) {
    let fd;
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fd = fs.openSync(this.file + ".tmp", "w", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, jobs }));
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(this.file + ".tmp", this.file);
    } catch { throw failure("STORE_UNAVAILABLE"); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
module.exports = { GenerationStore };
