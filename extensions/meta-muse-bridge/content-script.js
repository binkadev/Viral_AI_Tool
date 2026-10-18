"use strict";
// Historical composer selectors confirmed by the installed extension's live
// muse.ai heartbeat on 2026-10-18. Read only presence/usability, never content.
function status() {
  if(location.origin!=="https://muse.ai" || window.top!==window)return {composerReady:false,inspectionComplete:false};
  const root=document.querySelector("[data-hatch-composer-root]");
  const editor=root?.querySelector('[data-lexical-editor="true"], textarea, [data-hatch-composer-prehydration-input], [contenteditable="true"]');
  const usable=node=>{
    if(!node || node.closest('[hidden], [inert], [aria-hidden="true"]'))return false;
    const style=getComputedStyle(node);
    return style.display!=="none" && style.visibility!=="hidden" && style.visibility!=="collapse" && style.opacity!=="0" && node.getClientRects().length>0;
  };
  return {inspectionComplete:document.readyState!=="loading",composerReady:Boolean(root && editor && usable(root) && usable(editor) &&
    !editor.disabled && !editor.readOnly && editor.getAttribute("aria-disabled")!=="true" && editor.getAttribute("aria-readonly")!=="true" &&
    (editor.tagName==="TEXTAREA" || editor.isContentEditable))};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id===chrome.runtime.id && message?.type==="viral-ai:muse-status")reply(status());
  return false;
});
function connect() {
  try {
    const port=chrome.runtime.connect({name:"viral-ai-muse-tab"});
    port.onDisconnect.addListener(()=>{if(chrome.runtime.id)setTimeout(connect,1500);});
  } catch { /* Reloading the extension requires refreshing this tab. */ }
}
connect();
