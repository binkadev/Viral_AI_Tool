"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function read(file) { return fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n"); }
function write(file, content) { fs.writeFileSync(path.join(root, file), content, "utf8"); }
function replaceAllRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error("Missing anchor: " + label);
  return source.split(before).join(after);
}

let projectTest = read("tests/core-project-persistence.test.js");
projectTest = replaceAllRequired(projectTest, "assert.strictEqual(snapshotModel.CURRENT_SCHEMA_VERSION, 2);", "assert.strictEqual(snapshotModel.CURRENT_SCHEMA_VERSION, 3);", "project schema constant");
projectTest = replaceAllRequired(projectTest, "assert.strictEqual(migrated.schemaVersion, 2);", "assert.strictEqual(migrated.schemaVersion, 3);", "legacy migration schema");
projectTest = replaceAllRequired(projectTest, "assert.strictEqual(upgradedV1.snapshot.schemaVersion, 2);", "assert.strictEqual(upgradedV1.snapshot.schemaVersion, 3);", "v1 migration schema");
projectTest = replaceAllRequired(projectTest, "assert.strictEqual(upgraded.snapshot.schemaVersion, 2);", "assert.strictEqual(upgraded.snapshot.schemaVersion, 3);", "v0 migration schema");
projectTest = replaceAllRequired(projectTest, "Core project snapshot v2, media ownership", "Core project snapshot v3, media and scene-plan ownership", "project test summary");
write("tests/core-project-persistence.test.js", projectTest);

let mediaTest = read("tests/core-media-library-model.test.js");
mediaTest = replaceAllRequired(
  mediaTest,
  "assert.strictEqual(liveSnapshot.migrated, false);",
  "assert.strictEqual(liveSnapshot.migrated, true, \"schema-v2 media fixture must migrate to schema v3 without interrupting live media work\");",
  "media v2 migration expectation"
);
mediaTest = replaceAllRequired(
  mediaTest,
  "persistence.includes('model.migrateSnapshot(raw, { restartSafeMedia: true })')",
  "persistence.includes('restartSafeMedia: true') && persistence.includes('restartSafeScenePlan: true')",
  "bootstrap restart-safe assertion"
);
write("tests/core-media-library-model.test.js", mediaTest);

const pkgPath = "package.json";
const pkg = JSON.parse(read(pkgPath));
pkg.scripts["test:core-scene-plan"] = "node tests/core-scene-plan-model.test.js";
pkg.scripts["test:core-scene-plan-persistence"] = "node tests/core-scene-plan-persistence.test.js";
const commercial = String(pkg.scripts["test:core-commercial"] || "");
if (!commercial.includes("test:core-scene-plan")) {
  pkg.scripts["test:core-commercial"] = commercial.replace(
    "npm run test:core-project-persistence",
    "npm run test:core-project-persistence && npm run test:core-scene-plan && npm run test:core-scene-plan-persistence"
  );
}
write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

let workflow = read(".github/workflows/scene-planner.yml");
workflow = replaceAllRequired(
  workflow,
  '      - "renderer/core-scene-plan-model.js"',
  '      - "renderer/core-scene-plan-model.js"\n      - "renderer/core-project-snapshot.js"\n      - "renderer/core-project-persistence.js"\n      - "renderer/index.html"',
  "scene planner workflow renderer paths"
);
workflow = replaceAllRequired(
  workflow,
  '      - "tests/core-scene-plan-model.test.js"',
  '      - "tests/core-scene-plan-model.test.js"\n      - "tests/core-scene-plan-persistence.test.js"\n      - "tests/core-project-persistence.test.js"',
  "scene planner workflow test paths"
);
workflow = replaceAllRequired(
  workflow,
  "      - name: Run Scene Planner domain regression\n        run: node tests/core-scene-plan-model.test.js",
  "      - name: Run Scene Planner domain regression\n        run: node tests/core-scene-plan-model.test.js\n\n      - name: Run Scene Planner persistence regression\n        run: node tests/core-scene-plan-persistence.test.js\n\n      - name: Run project persistence regression\n        run: node tests/core-project-persistence.test.js",
  "scene planner workflow steps"
);
write(".github/workflows/scene-planner.yml", workflow);

console.log("Scene Planner persistence regression updates applied.");
