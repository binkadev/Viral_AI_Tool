(function attachProductionModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralProductionModel = api;
})(typeof window !== "undefined" ? window : globalThis, function productionModel() {
  "use strict";
  const mode = value => value === "auto" ? "auto" : "assisted";
  const usable = asset => !!asset && ["video", "image"].includes(asset.kind) &&
    asset.status === "ready" && asset.fileState === "available" && !!asset.localPath;
  const ordered = snapshot => [...(snapshot?.scenePlan?.scenes || [])].sort((a, b) => a.order - b.order);
  function classify(snapshot, scene, actionModel) {
    const slot = snapshot?.mediaAssembly?.slots?.find(s => s.sceneId === scene.id && s.role === "primary");
    const assets = new Map((snapshot?.media?.assets || []).map(a => [a.id, a]));
    const candidates = (slot?.candidateAssetIds || []).map(id => assets.get(id)).filter(usable);
    const selected = assets.get(slot?.selectedAssetId);
    const selectedUsable = usable(selected) && slot.candidateAssetIds.includes(selected.id);
    const plan = actionModel.buildSceneActionPlan(scene);
    const classification = slot?.selectedAssetId ? selectedUsable ? "selected-ready" : "attention-required" :
      candidates.length ? "candidates-ready" : plan.search.available || plan.generation.available ? "needs-sourcing" : "attention-required";
    return { sceneId: scene.id, classification, candidates, selected: selectedUsable ? selected : null, slot, plan,
      reason: classification === "attention-required" ? slot?.selectedAssetId ? "broken-selection" : "no-source" : null };
  }
  function summarize(snapshot, actionModel, records = new Map()) {
    const scenes = ordered(snapshot).map(scene => {
      const material = classify(snapshot, scene, actionModel), record = records.get(scene.id);
      // A manual review/selection supersedes an ephemeral provisional review.
      const review = record?.status === "review" && material.slot?.selectionSource !== "manual";
      const status = material.classification === "attention-required" ? "attention" : material.selected && !review ? "ready" : material.candidates.length &&
        (review || !record || record.status !== "attention") ? "review" : record?.status === "attention" ||
        material.classification === "attention-required" ? "attention" : "pending";
      return { sceneId: scene.id, status, reason: status === "attention" ? record?.reason || material.reason : null };
    });
    return { scenes, total: scenes.length, ready: scenes.filter(s => s.status === "ready").length,
      review: scenes.filter(s => s.status === "review").length, attention: scenes.filter(s => s.status === "attention").length };
  }
  function eligible(result, kind) {
    return !!result && result.kind === kind && typeof result.provider === "string" &&
      /^[a-z][a-z0-9_-]{0,63}$/.test(result.provider) && ["string", "number"].includes(typeof result.providerAssetId) &&
      !!String(result.providerAssetId).trim() && typeof result.acquisition?.ticket === "string" &&
      !!result.acquisition.ticket.trim() && result.acquisition.ticket.length <= 8192 && !/[\r\n]/.test(result.acquisition.ticket);
  }
  return { mode, usable, ordered, classify, summarize, eligible };
});
