"use strict";

const fs = require("fs");
const path = require("path");
const target = path.join(__dirname, "..", "renderer", "core-editor-assets.js");
let source = fs.readFileSync(target, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) throw new Error(label + " anchor must exist exactly once");
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  '      source: "Nguồn",\n      creator: "Tác giả",',
  '      sourceProvider: "Nguồn",\n      creator: "Tác giả",',
  "Vietnamese provider-source copy"
);
replaceOnce(
  '      source: "Source",\n      creator: "Creator",',
  '      sourceProvider: "Source",\n      creator: "Creator",',
  "English provider-source copy"
);
replaceOnce(
  '    const favoriteCount = countAssets(asset => asset?.favorite === true);\n\n    body.querySelectorAll("[data-dynamic-assets-section]").forEach(node => node.remove());',
  '    const favoriteCount = countAssets(asset => asset?.favorite === true);\n    const signature = [locale(), videoCount, imageCount, audioCount, generatedVideo, generatedImages, generatedAudio, favoriteCount].join("|");\n    if (body.dataset.dynamicAssetsSignature === signature) return;\n    body.dataset.dynamicAssetsSignature = signature;\n\n    body.querySelectorAll("[data-dynamic-assets-section]").forEach(node => node.remove());',
  "stable rail signature"
);
replaceOnce(
  '[t("source"), safeText(result?.provider)]',
  '[t("sourceProvider"), safeText(result?.provider)]',
  "provider-source preview label"
);
replaceOnce(
  '    } finally {\n      if (activeSearchRequestId === id) activeSearchRequestId = null;\n      if (submit instanceof HTMLButtonElement) {\n        submit.disabled = false;\n        submit.textContent = t("search");\n      }\n    }',
  '    } finally {\n      if (activeSearchRequestId === id) activeSearchRequestId = null;\n      if (submit instanceof HTMLButtonElement && !activeSearchRequestId) {\n        submit.disabled = false;\n        submit.textContent = t("search");\n      }\n    }',
  "search cancellation race"
);

fs.writeFileSync(target, source, "utf8");
console.log("Media browser UI hardening patch applied.");
