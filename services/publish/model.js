"use strict";
const VERSION = 1, MAX_ITEMS = 100;
const ACTIVE = ["preparing", "uploading", "processing"];
const STATES = ["queued", ...ACTIVE, "published", "needs_attention", "uncertain", "cancelled"];
const ATTENTION = ["SOURCE_UNAVAILABLE", "SOURCE_CHANGED", "PROJECT_NOT_FOUND", "RENDER_NOT_CURRENT", "INVALID_SOURCE", "PUBLISHER_UNCONFIGURED", "REJECTED"];
const CODES = [...ATTENTION, "INVALID_REQUEST", "STORAGE_PROTECTED", "STORAGE_FAILED", "CAPACITY", "BUSY", "START_UNSAFE", "CANCEL_UNSAFE", "NOT_FOUND", "UNAUTHORIZED", "UNAVAILABLE", "OUTCOME_UNCERTAIN", "INTERRUPTED"];
const fail = code => Object.assign(Error(code), {code});
const clone = value => JSON.parse(JSON.stringify(value));
const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
// Registry identifiers can include legacy imported-source identities. They are
// bounded data, never filenames/commands supplied to the native source reader.
const identifier = value => text(value,512);
const itemId = value => typeof value === "string" && /^publish-item-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const operationId = value => typeof value === "string" && /^publish-operation-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const date = value => typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const code = error => CODES.includes(error?.code) ? error.code : "UNAVAILABLE";
const SOURCE_KEYS = ["projectId","projectName","renderJobId","renderInputSignature","outputPath","sizeBytes","modifiedAt","sha256","fileId"];
function source(value) {
  if (!exact(value,SOURCE_KEYS) || !identifier(value.projectId) || !text(value.projectName,512) || !identifier(value.renderJobId) || value.renderJobId.length > 128 ||
      typeof value.renderInputSignature !== "string" || !/^project-render-v1:[a-f0-9]{64}$/.test(value.renderInputSignature) || !text(value.outputPath,32767) || !/^(?:[a-z]:[\\/]|\/)/i.test(value.outputPath) || !/\.mp4$/i.test(value.outputPath) ||
      !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || !Number.isFinite(value.modifiedAt) || value.modifiedAt < 0 ||
      typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || !text(value.fileId,128) || !/^\d+:\d+:\d+(?:\.\d+)?$/.test(value.fileId)) throw fail("INVALID_SOURCE");
  return Object.fromEntries(SOURCE_KEYS.map(k=>[k,value[k]]));
}
// Project display-name changes do not authorize a duplicate of the same source.
const sourceKey = value => JSON.stringify(SOURCE_KEYS.filter(k=>k!=="projectName").map(k=>value[k]));
function normalize(value) {
  if (!exact(value,["schemaVersion","items"]) || value.schemaVersion !== VERSION || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) throw fail("STORAGE_PROTECTED");
  const ids=new Set(), operations=new Set(), sources=new Set();
  const items=value.items.map(item=>{
    if (!exact(item,["itemId","source","state","operationId","reason","createdAt","updatedAt"]) || !itemId(item.itemId) || ids.has(item.itemId) || !STATES.includes(item.state) || !date(item.createdAt) || !date(item.updatedAt)) throw fail("STORAGE_PROTECTED");
    const captured=source(item.source), key=sourceKey(captured);
    if (sources.has(key) || item.operationId !== null && (!operationId(item.operationId) || operations.has(item.operationId)) ||
        ["queued","cancelled"].includes(item.state) && item.operationId !== null ||
        [...ACTIVE,"published","uncertain"].includes(item.state) && item.operationId === null ||
        (item.state === "needs_attention" ? !ATTENTION.includes(item.reason) : item.state === "uncertain" ? !["OUTCOME_UNCERTAIN","INTERRUPTED"].includes(item.reason) : item.reason !== null)) throw fail("STORAGE_PROTECTED");
    ids.add(item.itemId);sources.add(key);if(item.operationId)operations.add(item.operationId);
    return {itemId:item.itemId,source:captured,state:item.state,operationId:item.operationId,reason:item.reason,createdAt:item.createdAt,updatedAt:item.updatedAt};
  });
  if (items.filter(item=>ACTIVE.includes(item.state)).length > 1) throw fail("STORAGE_PROTECTED");
  return {schemaVersion:VERSION,items};
}
const GRAPH = {queued:["preparing","needs_attention","cancelled"],preparing:["uploading","needs_attention","uncertain"],uploading:["processing","needs_attention","uncertain"],processing:["published","needs_attention","uncertain"]};
function transition(item, state, {now, operation = item.operationId, reason = null} = {}) {
  if (!GRAPH[item.state]?.includes(state) || item.operationId && operation !== item.operationId) throw fail("START_UNSAFE");
  return normalize({schemaVersion:VERSION,items:[{...item,state,operationId:operation,reason,updatedAt:now}]}).items[0];
}
function restart(value, now) {
  const next=normalize(value);
  next.items=next.items.map(item=>ACTIVE.includes(item.state)?transition(item,"uncertain",{now,reason:"INTERRUPTED"}):item);
  return normalize(next);
}
function counts(value) {return Object.fromEntries(STATES.map(s=>[s,value.items.filter(i=>i.state===s).length]));}
module.exports={VERSION,MAX_ITEMS,ACTIVE,STATES,ATTENTION,CODES,fail,code,clone,exact,identifier,itemId,source,sourceKey,normalize,transition,restart,counts};
