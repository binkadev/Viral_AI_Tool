const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createDurableStateStore } = require("../state-store");
const { createAuditLog } = require("../audit-log");
const billing = require("../billing");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "viral-ai-state-test-"));
}

function testDurableState() {
  const root = tempDir();
  const statePath = path.join(root, "state.json");

  let store = createDurableStateStore(statePath);
  store.set("users", {
    "demo@example.test": {
      id: "user-1",
      quota: { usedMinutes: 42 }
    }
  });

  store = createDurableStateStore(statePath);
  assert.strictEqual(
    store.get("users")["demo@example.test"].quota.usedMinutes,
    42,
    "user state should survive a new store instance"
  );

  fs.writeFileSync(statePath, "{not-json", "utf8");
  store = createDurableStateStore(statePath);

  assert.strictEqual(store.recovery()?.code, "STATE_CORRUPT_RECOVERED");
  assert.deepStrictEqual(store.get("users"), {});
  assert(
    fs.readdirSync(root).some(name => name.includes(".corrupt-")),
    "corrupt state should be backed up"
  );

  fs.rmSync(root, { recursive: true, force: true });
}

function testJobReceiptPersistence() {
  const root = tempDir();
  const statePath = path.join(root, "state.json");

  let store = createDurableStateStore(statePath);
  const jobs = store.get("jobs", {});
  jobs.speech = {
    jobs: {
      "sp_1": {
        id: "sp_1",
        state: "processing",
        result: null,
        reservedMinutes: 2
      }
    },
    idempotency: {
      "user-1:client-job-1": "sp_1"
    }
  };
  store.set("jobs", jobs);

  store = createDurableStateStore(statePath);
  const restored = store.get("jobs", {}).speech;

  assert.strictEqual(restored.jobs.sp_1.state, "processing");
  assert.strictEqual(restored.jobs.sp_1.result, null);
  assert.strictEqual(restored.idempotency["user-1:client-job-1"], "sp_1");

  fs.rmSync(root, { recursive: true, force: true });
}

function testAuditSanitization() {
  const root = tempDir();
  const auditPath = path.join(root, "audit.jsonl");
  const audit = createAuditLog(auditPath);

  audit.write("auth.test", {
    userId: "user-1",
    password: "do-not-store",
    accessToken: "secret-token",
    nested: {
      authorization: "Bearer hidden",
      safe: "visible"
    }
  });

  const raw = fs.readFileSync(auditPath, "utf8");
  assert(raw.includes("user-1"));
  assert(raw.includes("visible"));
  assert(!raw.includes("do-not-store"));
  assert(!raw.includes("secret-token"));
  assert(!raw.includes("Bearer hidden"));

  fs.rmSync(root, { recursive: true, force: true });
}

function testBillingPersistence() {
  const root = tempDir();
  const statePath = path.join(root, "state.json");
  const store = createDurableStateStore(statePath);

  billing.configurePersistence({
    load: () => store.get("billing", {}),
    save: value => store.set("billing", value)
  });

  const checkout = billing.createCheckoutSession({
    userId: "user-1",
    currentPlanId: "creator",
    targetPlanId: "creator_pro",
    baseUrl: "http://127.0.0.1:3000"
  });

  billing.recordInvoice({
    userId: "user-1",
    planId: "creator_pro",
    amount: 2400,
    currency: "USD",
    status: "paid"
  });

  const rawState = fs.readFileSync(statePath, "utf8");
  assert(!rawState.includes(checkout.id), "raw checkout token must not be persisted");

  billing.configurePersistence({
    load: () => store.get("billing", {}),
    save: value => store.set("billing", value)
  });

  const restored = billing.consumeCheckoutSession(checkout.id);
  assert.strictEqual(restored.userId, "user-1");
  assert.strictEqual(restored.targetPlanId, "creator_pro");

  assert.throws(
    () => billing.consumeCheckoutSession(checkout.id),
    error => error?.code === "BILLING_SESSION_NOT_FOUND",
    "checkout session must be one-time"
  );

  const invoices = billing.listInvoices({
    id: "user-1",
    planId: "creator_pro",
    plan: "Creator Pro"
  }).invoices;

  assert(invoices.some(item => item.amount === 2400 && item.planId === "creator_pro"));

  fs.rmSync(root, { recursive: true, force: true });
}

function run() {
  testDurableState();
  testJobReceiptPersistence();
  testAuditSanitization();
  testBillingPersistence();
  console.log("Backend durable-state tests passed.");
}

run();
