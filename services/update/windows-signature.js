const path = require("path");
const { execFile } = require("child_process");

class WindowsSignatureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WindowsSignatureError";
    this.code = code;
    this.details = details;
  }
}

function signatureError(code, message, details) {
  return new WindowsSignatureError(code, message, details);
}

function normalizeSubject(value) {
  return String(value || "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .join(",")
    .toLowerCase();
}

function parseSignatureOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout || "").trim());
  } catch {
    throw signatureError(
      "UPDATE_SIGNATURE_CHECK_FAILED",
      "Windows signature output is invalid."
    );
  }

  const status = String(parsed?.Status || "").trim();
  const subject = String(parsed?.Subject || "").trim();
  const thumbprint = String(parsed?.Thumbprint || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const notAfter = parsed?.NotAfter && !Number.isNaN(Date.parse(parsed.NotAfter))
    ? new Date(parsed.NotAfter).toISOString()
    : null;

  if (!status || !subject || !/^[A-F0-9]{40,128}$/.test(thumbprint)) {
    throw signatureError(
      "UPDATE_SIGNATURE_INVALID",
      "Windows signature metadata is incomplete."
    );
  }

  return {
    status,
    subject,
    normalizedSubject: normalizeSubject(subject),
    thumbprint,
    notAfter
  };
}

function inspectAuthenticode(filePath, {
  execFileImpl = execFile,
  timeoutMs = 15000
} = {}) {
  const target = path.resolve(String(filePath || ""));
  if (process.platform !== "win32") {
    return Promise.reject(
      signatureError(
        "UPDATE_SIGNATURE_UNSUPPORTED",
        "Authenticode verification is only available on Windows."
      )
    );
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$target = $env:VIRAL_AI_SIGNATURE_TARGET",
    "if ([string]::IsNullOrWhiteSpace($target)) { throw 'Missing signature target.' }",
    "$sig = Get-AuthenticodeSignature -LiteralPath $target",
    "$cert = $sig.SignerCertificate",
    "$result = [PSCustomObject]@{",
    "  Status = [string]$sig.Status",
    "  Subject = if ($null -ne $cert) { [string]$cert.Subject } else { '' }",
    "  Thumbprint = if ($null -ne $cert) { [string]$cert.Thumbprint } else { '' }",
    "  NotAfter = if ($null -ne $cert) { $cert.NotAfter.ToUniversalTime().ToString('o') } else { $null }",
    "}",
    "$result | ConvertTo-Json -Compress"
  ].join("; ");

  const encoded = Buffer.from(script, "utf16le").toString("base64");

  return new Promise((resolve, reject) => {
    execFileImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded
      ],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 128 * 1024,
        env: {
          ...process.env,
          VIRAL_AI_SIGNATURE_TARGET: target
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(signatureError(
            "UPDATE_SIGNATURE_CHECK_FAILED",
            "Windows could not inspect the Authenticode signature.",
            {
              technicalMessage: String(error?.message || stderr || "").slice(0, 500)
            }
          ));
          return;
        }

        try {
          resolve(parseSignatureOutput(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

function assertValidSignature(signature, role) {
  if (signature?.status !== "Valid") {
    throw signatureError(
      "UPDATE_SIGNATURE_INVALID",
      role + " does not have a valid Windows Authenticode signature.",
      { status: signature?.status || null }
    );
  }

  if (
    signature.notAfter &&
    Date.parse(signature.notAfter) <= Date.now()
  ) {
    throw signatureError(
      "UPDATE_SIGNATURE_INVALID",
      role + " signing certificate is expired."
    );
  }
}

async function verifySamePublisher({
  currentExecutable,
  installerPath,
  inspect = inspectAuthenticode
}) {
  const [current, installer] = await Promise.all([
    inspect(currentExecutable),
    inspect(installerPath)
  ]);

  assertValidSignature(current, "Current application");
  assertValidSignature(installer, "Update installer");

  if (
    !current.normalizedSubject ||
    current.normalizedSubject !== installer.normalizedSubject
  ) {
    throw signatureError(
      "UPDATE_PUBLISHER_MISMATCH",
      "Update installer publisher does not match the installed application.",
      {
        currentPublisher: current.subject,
        updatePublisher: installer.subject
      }
    );
  }

  return {
    publisher: current.subject,
    currentThumbprint: current.thumbprint,
    installerThumbprint: installer.thumbprint,
    certificateChanged: current.thumbprint !== installer.thumbprint
  };
}

module.exports = {
  WindowsSignatureError,
  normalizeSubject,
  parseSignatureOutput,
  inspectAuthenticode,
  verifySamePublisher
};
