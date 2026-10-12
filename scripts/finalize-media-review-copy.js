"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, value) => fs.writeFileSync(path.join(root, file), value, "utf8");

function replaceOnce(content, needle, replacement, label) {
  const index = content.indexOf(needle);
  if (index < 0) throw new Error(`Missing anchor: ${label}`);
  if (content.indexOf(needle, index + needle.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + needle.length);
}

let discovery = read("renderer/core-media-discovery.js");
discovery = replaceOnce(
  discovery,
  '<div><span class="core-media-kicker">MEDIA</span><h2 id="core-media-discovery-title"></h2><p data-media-desc></p></div>',
  '<div><span class="core-media-kicker" data-media-kicker></span><h2 id="core-media-discovery-title"></h2><p data-media-desc></p></div>',
  "localized media kicker"
);
discovery = replaceOnce(
  discovery,
  '    const desc = drawer.querySelector("[data-media-desc]");\n',
  '    const desc = drawer.querySelector("[data-media-desc]");\n    const kicker = drawer.querySelector("[data-media-kicker]");\n',
  "media kicker query"
);
discovery = replaceOnce(
  discovery,
  '    if (desc) desc.textContent = t("discoveryDesc");\n',
  '    if (desc) desc.textContent = t("discoveryDesc");\n    if (kicker) kicker.textContent = t("media");\n',
  "media kicker localized copy"
);
discovery = replaceOnce(
  discovery,
  ': \'<span>MEDIA</span>\') + \'</div>\' +',
  ': \'<span>\' + esc(t("media")) + \'</span>\') + \'</div>\' +',
  "localized media placeholder"
);
write("renderer/core-media-discovery.js", discovery);

let docs = read("docs/PRODUCTION_BACKEND.md");
docs = replaceOnce(
  docs,
  'OPENAI_API_KEY=<server-side API key>\n```',
  'OPENAI_API_KEY=<server-side API key>\nPEXELS_API_KEY=<server-side Pexels key, optional when Pixabay is configured>\nPIXABAY_API_KEY=<server-side Pixabay key, optional when Pexels is configured>\n```',
  "compose media provider credentials"
);
docs = replaceOnce(
  docs,
  'VIRAL_AI_OPENAI_TTS_MODEL=gpt-4o-mini-tts\n```',
  'VIRAL_AI_OPENAI_TTS_MODEL=gpt-4o-mini-tts\nPEXELS_API_KEY=<server-side Pexels key, optional when Pixabay is configured>\nPIXABAY_API_KEY=<server-side Pixabay key, optional when Pexels is configured>\n```',
  "railway media provider credentials"
);
docs = replaceOnce(
  docs,
  'After the first owner account has been created and login has been verified, remove `VIRAL_AI_BOOTSTRAP_PASSWORD` from the deployment environment. Existing accounts are loaded from SQLite on future boots and do not require bootstrap secrets.\n',
  'After the first owner account has been created and login has been verified, remove `VIRAL_AI_BOOTSTRAP_PASSWORD` from the deployment environment. Existing accounts are loaded from SQLite on future boots and do not require bootstrap secrets.\n\nOnline **Find media** requires at least one server-side stock provider credential: `PEXELS_API_KEY` or `PIXABAY_API_KEY`. Keep these keys only in the backend deployment environment; never place them in the Electron app or renderer. If neither is configured, editing/local media remains available but online discovery intentionally reports that media sources are unavailable.\n',
  "production media provider guidance"
);
write("docs/PRODUCTION_BACKEND.md", docs);

console.log("Localized remaining media labels and documented production provider credentials.");
