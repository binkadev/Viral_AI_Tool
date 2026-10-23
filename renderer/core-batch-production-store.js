(function attach(root, factory) {
  const api = factory(typeof module !== "undefined" && module.exports ? require("./core-batch-production-model") : root.ViralBatchProductionModel);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViralBatchProductionStore = api;
})(typeof window !== "undefined" ? window : globalThis, function (model) {
  "use strict";
  const KEY = "viral-ai-batch-production-v1";
  function create({storage, now = () => new Date().toISOString()}) {
    let value = {schemaVersion:1, current:null}, error = null;
    // One atomic setItem. A failed write never advances the durable authority.
    function write(input) {
      if (error) throw model.failure(error);
      const next = model.normalize(input);
      try {storage.setItem(KEY, JSON.stringify(next));}
      catch {error = "BATCH_STORAGE_FAILED"; throw model.failure(error);}
      value = next; return model.clone(value);
    }
    try {
      const raw = storage.getItem(KEY);
      if (raw !== null) {
        if (raw.length > 200000) throw Error();
        const original = model.normalize(JSON.parse(raw)), restored = model.restart(original, now());
        value = original;
        if (JSON.stringify(original) !== JSON.stringify(restored)) write(restored);
      }
    } catch {error = error || "BATCH_STORAGE_PROTECTED";}
    return {read:() => model.clone(value), write, error:() => error, protected:() => !!error};
  }
  return {KEY, create};
});
