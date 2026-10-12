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
replaceOnce('    sourceButtonNode.dataset.sourceAsset = "true";', '    sourceButtonNode.setAttribute("data-source-asset", "");', "source marker");
replaceOnce('    transcriptButton.dataset.transcriptAsset = "true";', '    transcriptButton.setAttribute("data-transcript-asset", "");', "transcript marker");
fs.writeFileSync(target, source, "utf8");
console.log("Media layout markers patched.");
