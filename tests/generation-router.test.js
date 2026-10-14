"use strict";

const assert = require("assert");
const { chooseModel } = require("../services/generation/model-router");
const { estimateGenerationCost } = require("../services/generation/cost-estimator");

function run() {
  const local = chooseModel(
    { goal: "economy", mode: "text-to-video", resolution: "720p", durationSeconds: 5 },
    { availability: { local: true, runway: true } }
  );
  assert.strictEqual(local.model.id, "local:wan");
  assert.strictEqual(local.estimate.estimatedUsd, 0);

  const cheapCloud = chooseModel(
    { goal: "economy", mode: "text-to-video", resolution: "720p", durationSeconds: 5 },
    { availability: { local: false, runway: true } }
  );
  assert.strictEqual(cheapCloud.model.id, "runway:wan3");
  assert.strictEqual(cheapCloud.estimate.providerCredits, 50);
  assert.strictEqual(cheapCloud.estimate.estimatedUsd, 0.5);

  const audioBalanced = chooseModel(
    { goal: "balanced", mode: "text-to-video", resolution: "720p", durationSeconds: 5, withAudio: true },
    { availability: { local: false, runway: true } }
  );
  assert.strictEqual(audioBalanced.model.id, "runway:veo3.1_fast");
  assert.strictEqual(audioBalanced.estimate.providerCredits, 75);

  const seedance = estimateGenerationCost("runway:seedance2_5", {
    durationSeconds: 4,
    resolution: "720p",
    inputVideoSeconds: 0
  });
  assert.strictEqual(seedance.providerCredits, 120);
  assert.strictEqual(seedance.estimatedUsd, 1.2);

  const mini = estimateGenerationCost("runway:seedance2_mini", {
    durationSeconds: 2,
    resolution: "720p"
  });
  assert.strictEqual(mini.providerCredits, 64);

  assert.throws(
    () => chooseModel(
      { goal: "economy", mode: "text-to-video", resolution: "720p", durationSeconds: 30 },
      { availability: { local: false, runway: true } }
    ),
    error => error?.code === "NO_GENERATION_ROUTE"
  );

  console.log("generation-router.test.js: ok");
}

run();
