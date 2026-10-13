"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { cachePaths } = require("../services/media/acquisition-manager");

const descriptor = {
  provider: "pexels",
  providerAssetId: "987",
  kind: "video",
  downloadUrl: "https://videos.pexels.com/video-files/987/hd.mp4",
  mime: "video/mp4"
};

(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "viral-ai-acquisition-path-"));
  try {
    const paths = cachePaths(temp, "project-source-1", descriptor);
    await fsp.mkdir(paths.directory, { recursive: true });
    await fsp.rm(paths.partialPath, { force: true });
    const handle = await fsp.open(paths.partialPath, "wx");
    await handle.write(Buffer.from("ok"));
    await handle.close();
    assert.strictEqual(fs.existsSync(paths.partialPath), true);
    assert.strictEqual(fs.readFileSync(paths.partialPath, "utf8"), "ok");
    console.log("Windows media cache path smoke test passed:", { length: paths.partialPath.length, root: path.parse(paths.partialPath).root });
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error("Windows media cache path smoke test failed:", {
    name: error?.name,
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    path: error?.path,
    message: error?.message
  });
  process.exitCode = 1;
});
