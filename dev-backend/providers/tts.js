const openai = require("./openai-tts");

function selectedName() {
  return String(process.env.VIRAL_AI_TTS_PROVIDER || "openai").trim().toLowerCase();
}

function selectedProvider() {
  const name = selectedName();

  if (name === "openai") {
    return {
      name,
      isConfigured: openai.isConfigured,
      synthesize: openai.synthesize,
      config: openai.config,
      publicVoices: openai.publicVoices
    };
  }

  return {
    name,
    isConfigured: () => false,
    async synthesize() {
      const error = new Error("TTS provider is not configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    config: () => ({ model: "", baseUrl: "" }),
    publicVoices: () => []
  };
}

module.exports = selectedProvider();
