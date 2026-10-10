'use strict';

const openai = require('./openai-script-provider');
const devTemplate = require('./dev-template-script-provider');

function selectProvider() {
  if (openai.isConfigured()) return openai;
  if (devTemplate.isConfigured()) return devTemplate;
  return openai;
}

async function isConfigured() {
  const provider = selectProvider();
  return Boolean(await provider.isConfigured());
}

async function generateScript(input) {
  return selectProvider().generateScript(input);
}

module.exports = {
  get id() {
    return selectProvider().id;
  },
  isConfigured,
  generateScript,
  selectProvider
};
