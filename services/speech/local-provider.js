const modelManager = require("./model-manager");

function runtimeAvailable() {
  try {
    require.resolve("sherpa-onnx-node");
    return true;
  } catch {
    return false;
  }
}

class LocalSpeechProvider {
  constructor({ userDataPath }) {
    this.mode = "local";
    this.userDataPath = userDataPath;
  }

  async status() {
    const modelStatus = await modelManager.status(this.userDataPath);

    if (!modelStatus.ready) {
      const code = modelStatus.state === "invalid"
        ? "LOCAL_MODEL_INVALID"
        : modelStatus.state === "partial" || modelStatus.state === "downloading"
          ? "LOCAL_MODEL_INCOMPLETE"
          : "LOCAL_MODEL_REQUIRED";

      return {
        mode: this.mode,
        ready: false,
        code,
        modelInstalled: false,
        modelStatus
      };
    }

    if (!runtimeAvailable()) {
      return {
        mode: this.mode,
        ready: false,
        code: "LOCAL_RUNTIME_REQUIRED",
        modelInstalled: true,
        modelStatus
      };
    }

    return {
      mode: this.mode,
      ready: true,
      code: "READY",
      modelInstalled: true,
      modelStatus
    };
  }

  async transcribe() {
    const status = await this.status();

    if (!status.modelInstalled) {
      const error = new Error("Local speech model is not installed.");
      error.code = status.code;
      throw error;
    }

    if (!status.ready) {
      const error = new Error("Local speech runtime is not configured.");
      error.code = status.code;
      throw error;
    }

    const error = new Error("Local speech adapter is not connected yet.");
    error.code = "LOCAL_ADAPTER_NOT_CONFIGURED";
    throw error;
  }

  async cancel() {
    return false;
  }
}

module.exports = { LocalSpeechProvider };
