const fs = require("fs");
const path = require("path");

class LocalSpeechProvider {
  constructor({ userDataPath }) {
    this.mode = "local";
    this.userDataPath = userDataPath;
  }

  modelDirectory() {
    return path.join(this.userDataPath, "models", "speech");
  }

  modelManifestPath() {
    return path.join(this.modelDirectory(), "model.json");
  }

  status() {
    const directory = this.modelDirectory();
    const manifestPath = this.modelManifestPath();

    if (!fs.existsSync(manifestPath)) {
      return {
        mode: this.mode,
        ready: false,
        code: "LOCAL_MODEL_REQUIRED",
        modelInstalled: false,
        directory
      };
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const modelFile = typeof manifest.file === "string"
        ? path.join(directory, manifest.file)
        : null;

      if (!modelFile || !fs.existsSync(modelFile)) {
        return {
          mode: this.mode,
          ready: false,
          code: "LOCAL_MODEL_INCOMPLETE",
          modelInstalled: false,
          directory
        };
      }

      return {
        mode: this.mode,
        ready: true,
        code: "READY",
        modelInstalled: true,
        model: {
          id: String(manifest.id || "local-speech"),
          version: String(manifest.version || "1"),
          sizeBytes: fs.statSync(modelFile).size
        },
        directory
      };
    } catch {
      return {
        mode: this.mode,
        ready: false,
        code: "LOCAL_MODEL_INVALID",
        modelInstalled: false,
        directory
      };
    }
  }

  async transcribe() {
    const error = new Error("Local speech engine is not configured.");
    error.code = "LOCAL_ENGINE_NOT_CONFIGURED";
    throw error;
  }

  async cancel() {
    return false;
  }
}

module.exports = { LocalSpeechProvider };
