"use strict";
const fs = require("fs");
const path = require("path");

// Executable discovery only; never inspect a browser's normal profile.
function discoverChromeBrowser({platform = process.platform, env = process.env, isFile = file => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}} = {}) {
  if (platform !== "win32") return null;
  const roots = [...new Set([env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA]
    .filter(value => typeof value === "string" && path.win32.isAbsolute(value)))];
  for (const root of roots) {
    const executable = path.win32.join(root, "Google/Chrome/Application/chrome.exe");
    if (isFile(executable)) return {id:"chrome", executable};
  }
  return null;
}

function publicBrowserAvailability(browser) {
  return {available: Boolean(browser && browser.id === "chrome"),
    browser: browser && browser.id === "chrome" ? browser.id : null};
}
module.exports = {discoverChromeBrowser, publicBrowserAvailability};
