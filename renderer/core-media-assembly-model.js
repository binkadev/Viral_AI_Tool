(function attachMediaAssembly(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralCoreMediaAssemblyModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createMediaAssemblyModel() {
  "use strict";
  const MEDIA_ASSEMBLY_SCHEMA_VERSION = 1;
  const MAX_CANDIDATES_PER_SLOT = 64;
  const validId = value => typeof value === "string" && value.length > 0 && value.length <= 512;
  const source = value => value === "auto" || value === "manual";
  function timestamp(value, fallback = 0) {
    const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    return new Date(Number.isFinite(time) && Math.abs(time) <= 8640000000000000 ? time : fallback).toISOString();
  }
  function emptyAssembly() { return { schemaVersion: MEDIA_ASSEMBLY_SCHEMA_VERSION, slots: [] }; }
  function slotId(sceneId, role = "primary") {
    return validId(sceneId) && role === "primary" ? "scene:" + sceneId + ":primary" : null;
  }
  function contextIds({ scenes = [], assets = [] } = {}) {
    return { scenes: new Set(scenes.filter(s => validId(s?.id)).map(s => s.id)),
      assets: new Set(assets.filter(a => validId(a?.id) && ["video", "image"].includes(a.kind)).map(a => a.id)) };
  }
  function normalizeAssembly(input, context = {}) {
    const result = emptyAssembly(), ids = contextIds(context), seen = new Set();
    if (input?.schemaVersion !== MEDIA_ASSEMBLY_SCHEMA_VERSION) return result;
    for (const raw of Array.isArray(input.slots) ? input.slots : []) {
      if (!raw || raw.role !== "primary" || !ids.scenes.has(raw.sceneId) || seen.has(raw.sceneId)) continue;
      seen.add(raw.sceneId);
      const candidates = [], unique = new Set();
      for (const id of Array.isArray(raw.candidateAssetIds) ? raw.candidateAssetIds : []) {
        if (candidates.length >= MAX_CANDIDATES_PER_SLOT) break;
        if (!ids.assets.has(id) || unique.has(id)) continue;
        unique.add(id); candidates.push(id);
      }
      const selected = unique.has(raw.selectedAssetId) && source(raw.selectionSource) ? raw.selectedAssetId : null;
      const createdAt = timestamp(raw.createdAt);
      result.slots.push({ id: slotId(raw.sceneId), sceneId: raw.sceneId, role: "primary",
        candidateAssetIds: candidates, selectedAssetId: selected, selectionSource: selected ? raw.selectionSource : null,
        createdAt, updatedAt: timestamp(raw.updatedAt, Date.parse(createdAt)) });
    }
    return result;
  }
  function sceneSlot(assembly, sceneId) {
    // Return a detached value; consumers cannot mutate a caller-owned slot.
    const slot = assembly?.slots?.find(s => s.sceneId === sceneId && s.role === "primary");
    return slot ? { ...slot, candidateAssetIds: [...slot.candidateAssetIds] } : null;
  }
  function addCandidate(assembly, sceneId, assetId, options = {}) {
    const next = normalizeAssembly(assembly, options), ids = contextIds(options);
    if (!ids.scenes.has(sceneId) || !ids.assets.has(assetId)) return next;
    let slot = next.slots.find(s => s.sceneId === sceneId);
    if (slot?.candidateAssetIds.includes(assetId) || slot?.candidateAssetIds.length >= MAX_CANDIDATES_PER_SLOT) return next;
    const now = timestamp(options.now);
    if (!slot) {
      slot = { id: slotId(sceneId), sceneId, role: "primary", candidateAssetIds: [], selectedAssetId: null,
        selectionSource: null, createdAt: now, updatedAt: now };
      next.slots.push(slot);
    }
    slot.candidateAssetIds.push(assetId); slot.updatedAt = now;
    if (options.selectIfEmpty === true && !slot.selectedAssetId && source(options.selectionSource)) {
      slot.selectedAssetId = assetId; slot.selectionSource = options.selectionSource;
    }
    return next;
  }
  function selectCandidate(assembly, sceneId, assetId, options = {}) {
    const next = normalizeAssembly(assembly, options), slot = next.slots.find(s => s.sceneId === sceneId);
    if (!slot?.candidateAssetIds.includes(assetId) || !source(options.selectionSource) ||
        slot.selectedAssetId === assetId && slot.selectionSource === options.selectionSource) return next;
    slot.selectedAssetId = assetId; slot.selectionSource = options.selectionSource; slot.updatedAt = timestamp(options.now);
    return next;
  }
  function clearSelection(assembly, sceneId, options = {}) {
    const next = normalizeAssembly(assembly, options), slot = next.slots.find(s => s.sceneId === sceneId);
    if (slot?.selectedAssetId) {
      slot.selectedAssetId = null; slot.selectionSource = null; slot.updatedAt = timestamp(options.now);
    }
    return next;
  }
  function removeCandidate(assembly, sceneId, assetId, options = {}) {
    const next = normalizeAssembly(assembly, options), slot = next.slots.find(s => s.sceneId === sceneId);
    if (!slot?.candidateAssetIds.includes(assetId)) return next;
    slot.candidateAssetIds = slot.candidateAssetIds.filter(id => id !== assetId); slot.updatedAt = timestamp(options.now);
    if (slot.selectedAssetId === assetId) { slot.selectedAssetId = null; slot.selectionSource = null; }
    return next;
  }
  function removeAssetReferences(assembly, assetId, options = {}) {
    let next = normalizeAssembly(assembly, options);
    for (const slot of next.slots) next = removeCandidate(next, slot.sceneId, assetId, options);
    return next;
  }
  return { MEDIA_ASSEMBLY_SCHEMA_VERSION, MAX_CANDIDATES_PER_SLOT, emptyAssembly, normalizeAssembly,
    slotId, sceneSlot, addCandidate, removeCandidate, selectCandidate, clearSelection, removeAssetReferences,
    reconcileAssembly: normalizeAssembly };
});
