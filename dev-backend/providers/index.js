const openai = require("./openai-transcription");

function selectedName() {
  return String(process.env.VIRAL_AI_SPEECH_PROVIDER || "openai").trim().toLowerCase();
}

function selectedProvider() {
  const name = selectedName();

  if (name === "openai") {
    return {
      name,
      isConfigured: openai.isConfigured,
      transcribe: openai.transcribe,
      config: openai.config
    };
  }

  return {
    name,
    isConfigured: () => false,
    async transcribe() {
      const error = new Error("Speech provider is not configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    config: () => ({ model: "", baseUrl: "" })
  };
}

module.exports = selectedProvider();
