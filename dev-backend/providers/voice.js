const openai = require("./openai-voice");

function selectedName() {
  return String(process.env.VIRAL_AI_VOICE_PROVIDER || "openai").trim().toLowerCase();
}

function selectedProvider() {
  const name = selectedName();

  if (name === "openai") {
    return {
      name,
      isConfigured: openai.isConfigured,
      synthesize: openai.synthesize,
      publicCatalog: openai.publicCatalog,
      config: openai.config
    };
  }

  return {
    name,
    isConfigured: () => false,
    publicCatalog: () => [],
    async synthesize() {
      const error = new Error("Voice provider is not configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    config: () => ({ model: "", baseUrl: "" })
  };
}

module.exports = selectedProvider();
