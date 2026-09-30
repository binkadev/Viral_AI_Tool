const openai = require("./openai-translation");

function selectedName() {
  return String(process.env.VIRAL_AI_TRANSLATION_PROVIDER || "openai").trim().toLowerCase();
}

function selectedProvider() {
  const name = selectedName();

  if (name === "openai") {
    return {
      name,
      isConfigured: openai.isConfigured,
      translate: openai.translate,
      config: openai.config
    };
  }

  return {
    name,
    isConfigured: () => false,
    async translate() {
      const error = new Error("Translation provider is not configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    config: () => ({ model: "", baseUrl: "" })
  };
}

module.exports = selectedProvider();
