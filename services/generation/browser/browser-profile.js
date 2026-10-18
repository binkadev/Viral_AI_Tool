"use strict";
const fs = require("fs");
const path = require("path");

function profilePath(userDataPath, browserId) {
  if (!path.isAbsolute(userDataPath) || browserId !== "chrome") {
    throw new Error("BROWSER_PROFILE_UNAVAILABLE");
  }
  return path.join(path.resolve(userDataPath), "browser-sessions", "muse", browserId);
}

function prepareProfile(userDataPath, browserId) {
  const target = profilePath(userDataPath, browserId);
  fs.mkdirSync(userDataPath, {recursive:true});
  let current = path.resolve(userDataPath);
  // Reject redirects at every dedicated-profile segment before using it.
  for (const segment of ["browser-sessions", "muse", browserId]) {
    current = path.join(current, segment);
    try {
      const entry = fs.lstatSync(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("BROWSER_PROFILE_UNAVAILABLE");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    fs.mkdirSync(current, {recursive:true});
  }
  return target;
}
module.exports = {profilePath, prepareProfile};
