class CloudSpeechProvider {
  constructor({ backendUrl }) {
    this.mode = "cloud";
    this.backendUrl = typeof backendUrl === "string" ? backendUrl.trim() : "";
  }

  status() {
    if (!this.backendUrl) {
      return {
        mode: this.mode,
        ready: false,
        code: "CLOUD_NOT_CONFIGURED"
      };
    }

    let url;
    try {
      url = new URL(this.backendUrl);
    } catch {
      return {
        mode: this.mode,
        ready: false,
        code: "CLOUD_CONFIG_INVALID"
      };
    }

    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      return {
        mode: this.mode,
        ready: false,
        code: "CLOUD_HTTPS_REQUIRED"
      };
    }

    return {
      mode: this.mode,
      ready: true,
      code: "READY"
    };
  }

  async transcribe() {
    const error = new Error("Cloud speech backend is not connected.");
    error.code = "CLOUD_BACKEND_NOT_CONNECTED";
    throw error;
  }

  async cancel() {
    return false;
  }
}

module.exports = { CloudSpeechProvider };
