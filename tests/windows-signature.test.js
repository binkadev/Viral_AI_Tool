const assert = require("assert");

const {
  normalizeSubject,
  parseSignatureOutput,
  verifySamePublisher
} = require("../services/update/windows-signature");

function validSignature({
  subject = "CN=Viral AI Tool, O=Viral AI Tool",
  thumbprint = "A".repeat(40),
  notAfter = "2030-01-01T00:00:00.000Z"
} = {}) {
  return {
    status: "Valid",
    subject,
    normalizedSubject: normalizeSubject(subject),
    thumbprint,
    notAfter
  };
}

async function run() {
  assert.strictEqual(
    normalizeSubject(" CN=Viral AI Tool,  O=Viral AI Tool "),
    "cn=viral ai tool,o=viral ai tool"
  );

  const parsed = parseSignatureOutput(JSON.stringify({
    Status: "Valid",
    Subject: "CN=Viral AI Tool, O=Viral AI Tool",
    Thumbprint: "ab cd ".repeat(10),
    NotAfter: "2030-01-01T00:00:00Z"
  }));

  assert.strictEqual(parsed.status, "Valid");
  assert.strictEqual(parsed.thumbprint, "ABCD".repeat(10));
  assert.strictEqual(parsed.notAfter, "2030-01-01T00:00:00.000Z");

  const current = validSignature({ thumbprint: "A".repeat(40) });
  const renewed = validSignature({ thumbprint: "B".repeat(40) });

  const samePublisher = await verifySamePublisher({
    currentExecutable: "current.exe",
    installerPath: "update.exe",
    inspect: async file => file === "current.exe" ? current : renewed
  });

  assert.strictEqual(samePublisher.publisher, current.subject);
  assert.strictEqual(samePublisher.certificateChanged, true);

  await assert.rejects(
    () => verifySamePublisher({
      currentExecutable: "current.exe",
      installerPath: "update.exe",
      inspect: async file => file === "current.exe"
        ? current
        : validSignature({ subject: "CN=Different Publisher, O=Other Company" })
    }),
    error => error?.code === "UPDATE_PUBLISHER_MISMATCH"
  );

  await assert.rejects(
    () => verifySamePublisher({
      currentExecutable: "current.exe",
      installerPath: "update.exe",
      inspect: async file => file === "current.exe"
        ? current
        : { ...renewed, status: "HashMismatch" }
    }),
    error => error?.code === "UPDATE_SIGNATURE_INVALID"
  );

  const timestamped = await verifySamePublisher({
    currentExecutable: "current.exe",
    installerPath: "update.exe",
    inspect: async file => file === "current.exe"
      ? current
      : validSignature({ notAfter: "2020-01-01T00:00:00.000Z" })
  });
  assert.strictEqual(timestamped.publisher, current.subject);

  assert.throws(
    () => parseSignatureOutput("not-json"),
    error => error?.code === "UPDATE_SIGNATURE_CHECK_FAILED"
  );

  console.log("Windows update signature tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
