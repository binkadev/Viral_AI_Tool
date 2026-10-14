"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sync = fs.readFileSync(path.join(root, "renderer", "core-player-sync.js"), "utf8");
const rebind = fs.readFileSync(path.join(root, "renderer", "core-player-rebind.js"), "utf8");

assert(sync.includes("function playerStructureChanged(records)"), "player sync must filter DOM mutations before scheduling a scan");
assert(sync.includes("if (playerStructureChanged(records)) queue();"), "player sync observer must ignore its own clock/text mutations");
assert(!sync.includes("new MutationObserver(queue).observe(page"), "player sync must not rescan for every subtree mutation");
assert(sync.includes("if (node.textContent !== next) node.textContent = next;"), "player sync clock writes must be idempotent");

assert(rebind.includes("function mutationNeedsScan(records)"), "player rebind must filter DOM mutations before scheduling a scan");
assert(rebind.includes("if (mutationNeedsScan(records)) queue();"), "player rebind observer must ignore its own UI mutations");
assert(!rebind.includes("new MutationObserver(queue).observe(page"), "player rebind must not rescan for every subtree mutation");
assert(!rebind.includes("nudgeCorePlayer"), "player rebind must not create synthetic DOM mutations to wake observers");
assert(!rebind.includes('document.createComment("core-player-rebind")'), "player rebind must not append/remove marker nodes");
assert(rebind.includes("if (node.textContent !== next) node.textContent = next;"), "player rebind clock writes must be idempotent");
assert(rebind.includes('record.target instanceof HTMLVideoElement'), "attribute rescans must be restricted to the media element");

console.log("Core player mutation feedback-loop regression passed.");
