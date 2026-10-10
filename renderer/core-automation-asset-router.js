(function attachAutomationAssetRouter(root, factory) {
  const assetModel = (typeof module !== "undefined" && module.exports)
    ? require("./core-automation-asset-model")
    : root?.ViralAutomationAssetModel;
  const api = factory(assetModel);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralAutomationAssetRouter = api;
})(typeof window !== "undefined" ? window : globalThis, function createAutomationAssetRouter(assetModel) {
  "use strict";

  const NORMALIZED_CODES = new Set([
    "INVALID_INPUT",
    "PROVIDER_NOT_CONFIGURED",
    "AUTH_REQUIRED",
    "QUOTA_EXCEEDED",
    "RATE_LIMITED",
    "NETWORK_ERROR",
    "PROVIDER_TIMEOUT",
    "PROVIDER_REJECTED",
    "NO_RESULTS",
    "UNSUPPORTED_REQUEST",
    "DOWNLOAD_FAILED",
    "FILE_INVALID",
    "CANCELLED",
    "STALE_INPUT",
    "DUPLICATE_ACTIVE",
    "MATERIALIZATION_UNAVAILABLE",
    "UNKNOWN"
  ]);

  function normalizedError(code, message, details = {}) {
    const safeCode = NORMALIZED_CODES.has(String(code || "").toUpperCase())
      ? String(code).toUpperCase()
      : "UNKNOWN";
    const error = new Error(String(message || safeCode));
    error.code = safeCode;
    error.details = {
      provider: details.provider ? String(details.provider) : null,
      retryable: details.retryable === true,
      phase: details.phase ? String(details.phase) : null
    };
    return error;
  }

  function mapProviderError(error, providerId, phase = "search") {
    if (error?.code && NORMALIZED_CODES.has(String(error.code).toUpperCase())) {
      return normalizedError(error.code, error.message, {
        provider: providerId,
        retryable: error?.details?.retryable === true,
        phase
      });
    }
    const status = Number(error?.status || error?.statusCode || 0);
    if (status === 401 || status === 403) return normalizedError("AUTH_REQUIRED", "Provider authentication is required.", { provider: providerId, phase });
    if (status === 429) return normalizedError("RATE_LIMITED", "Provider rate limit reached.", { provider: providerId, retryable: true, phase });
    if (status === 402) return normalizedError("QUOTA_EXCEEDED", "Provider quota is not sufficient.", { provider: providerId, phase });
    const name = String(error?.name || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    if (name === "aborterror" || /aborted|cancelled|canceled/.test(message)) return normalizedError("CANCELLED", "Asset routing was cancelled.", { provider: providerId, retryable: true, phase });
    if (/timeout/.test(message)) return normalizedError("PROVIDER_TIMEOUT", "Provider request timed out.", { provider: providerId, retryable: true, phase });
    if (/network|fetch|connection|offline|socket/.test(message)) return normalizedError("NETWORK_ERROR", "Provider network request failed.", { provider: providerId, retryable: true, phase });
    return normalizedError("PROVIDER_REJECTED", "Provider request failed.", { provider: providerId, retryable: true, phase });
  }

  function normalizeCapabilities(provider = {}) {
    const source = provider.capabilities || {};
    const list = value => new Set((Array.isArray(value) ? value : []).map(item => String(item).toLowerCase()));
    return {
      strategies: list(source.strategies),
      mediaTypes: list(source.mediaTypes),
      aspects: list(source.aspects)
    };
  }

  function providerSupports(provider, request) {
    const caps = normalizeCapabilities(provider);
    if (caps.strategies.size && !caps.strategies.has(String(request.strategy).toLowerCase())) return false;
    if (caps.mediaTypes.size && !caps.mediaTypes.has(String(request.mediaType).toLowerCase())) return false;
    if (caps.aspects.size && !caps.aspects.has(String(request.aspectRatio).toLowerCase())) return false;
    return true;
  }

  async function configured(provider) {
    if (typeof provider?.isConfigured !== "function") return true;
    try { return (await provider.isConfigured()) === true; }
    catch { return false; }
  }

  function candidateRank(candidate, request) {
    const desired = Number(request.desiredDurationSec || 0);
    const duration = Number(candidate.durationSec || 0);
    const durationDistance = desired > 0 && duration > 0 ? Math.abs(desired - duration) : desired;
    return Number(candidate.score || 0) * 1000 - durationDistance;
  }

  function normalizeCandidates(rawCandidates, providerId, request) {
    return (Array.isArray(rawCandidates) ? rawCandidates : [])
      .map(candidate => assetModel?.normalizeCandidate?.(candidate, providerId))
      .filter(Boolean)
      .filter(candidate => assetModel?.candidateMatchesRequest?.(candidate, request))
      .sort((a, b) => candidateRank(b, request) - candidateRank(a, request));
  }

  function throwIfAborted(signal, providerId = null, phase = null) {
    if (signal?.aborted) throw normalizedError("CANCELLED", "Asset routing was cancelled.", { provider: providerId, retryable: true, phase });
  }

  function createRouter({ providers = [], priority = [] } = {}) {
    const providerMap = new Map();
    const active = new Map();

    function register(provider) {
      const id = String(provider?.id || "").trim();
      if (!id) throw normalizedError("INVALID_INPUT", "Asset provider id is required.");
      providerMap.set(id, provider);
      return provider;
    }

    providers.forEach(register);

    function orderedProviders() {
      const explicit = (Array.isArray(priority) ? priority : []).map(String);
      const seen = new Set();
      const ordered = [];
      for (const id of explicit) {
        const provider = providerMap.get(id);
        if (provider && !seen.has(id)) {
          seen.add(id);
          ordered.push(provider);
        }
      }
      for (const [id, provider] of providerMap) {
        if (!seen.has(id)) ordered.push(provider);
      }
      return ordered;
    }

    async function execute(rawRequest, ctx = {}) {
      const validated = assetModel?.validateAssetRequest?.(rawRequest);
      if (!validated?.ok) {
        throw normalizedError("INVALID_INPUT", validated?.errors?.[0]?.code || "Asset request is invalid.", { phase: "validation" });
      }
      const request = validated.value;
      const signal = ctx.signal;
      throwIfAborted(signal, null, "validation");

      const compatible = orderedProviders().filter(provider => providerSupports(provider, request));
      if (!compatible.length) throw normalizedError("UNSUPPORTED_REQUEST", "No asset provider supports this request.", { phase: "routing" });

      let configuredCount = 0;
      let attemptedCount = 0;
      let hadEmptyResults = false;
      let lastRetryable = null;

      for (const provider of compatible) {
        const providerId = String(provider.id);
        throwIfAborted(signal, providerId, "configuration");
        if (!(await configured(provider))) continue;
        configuredCount += 1;
        if (typeof provider.search !== "function" && typeof provider.generate !== "function") continue;
        attemptedCount += 1;

        try {
          ctx.onProgress?.({ phase: "searching", provider: providerId, requestId: request.id });
          const rawCandidates = typeof provider.search === "function"
            ? await provider.search(request, { signal, requestId: request.id })
            : await provider.generate(request, { signal, requestId: request.id });
          throwIfAborted(signal, providerId, "search");
          const candidates = normalizeCandidates(rawCandidates, providerId, request);
          if (!candidates.length) {
            hadEmptyResults = true;
            continue;
          }

          const selected = candidates[0];
          if (typeof provider.materialize !== "function") {
            return { request, provider: providerId, candidates, selected, asset: null, materializationRequired: true };
          }

          ctx.onProgress?.({ phase: "materializing", provider: providerId, requestId: request.id, candidateId: selected.id });
          const rawAsset = await provider.materialize(selected, { signal, request });
          throwIfAborted(signal, providerId, "materialize");
          const asset = assetModel?.normalizeAssetRef?.({ ...rawAsset, provider: providerId, providerAssetId: selected.providerAssetId }, request);
          if (!asset) throw normalizedError("FILE_INVALID", "Provider materialized an invalid asset.", { provider: providerId, phase: "materialize" });
          return { request, provider: providerId, candidates, selected, asset, materializationRequired: false };
        } catch (error) {
          const mapped = mapProviderError(error, providerId, "provider");
          if (mapped.code === "CANCELLED") throw mapped;
          if (mapped.details?.retryable) {
            lastRetryable = mapped;
            continue;
          }
          throw mapped;
        }
      }

      if (!configuredCount) throw normalizedError("PROVIDER_NOT_CONFIGURED", "No compatible asset provider is configured.", { phase: "configuration" });
      if (hadEmptyResults || attemptedCount) throw lastRetryable || normalizedError("NO_RESULTS", "No provider returned a usable asset.", { phase: "search" });
      throw normalizedError("UNSUPPORTED_REQUEST", "No configured provider can execute this request.", { phase: "routing" });
    }

    async function resolve(rawRequest, ctx = {}) {
      const validated = assetModel?.validateAssetRequest?.(rawRequest);
      if (!validated?.ok) throw normalizedError("INVALID_INPUT", validated?.errors?.[0]?.code || "Asset request is invalid.", { phase: "validation" });
      const key = validated.value.requestSignature;
      if (active.has(key)) throw normalizedError("DUPLICATE_ACTIVE", "An identical asset request is already running.", { phase: "routing" });
      const promise = execute(validated.value, ctx);
      active.set(key, promise);
      try { return await promise; }
      finally { active.delete(key); }
    }

    function status() {
      return {
        providers: orderedProviders().map(provider => ({ id: String(provider.id), capabilities: normalizeCapabilities(provider) })),
        activeRequestSignatures: [...active.keys()]
      };
    }

    return { register, resolve, status, providerSupports };
  }

  return {
    NORMALIZED_CODES,
    normalizedError,
    mapProviderError,
    normalizeCapabilities,
    providerSupports,
    normalizeCandidates,
    createRouter
  };
});