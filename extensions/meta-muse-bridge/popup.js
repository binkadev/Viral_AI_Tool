"use strict";
const locale=chrome.i18n.getUILanguage().startsWith("vi")?"vi":"en",copy=window.MuseStrings[locale];
document.documentElement.lang=locale;document.title=copy.title;
document.querySelectorAll("[data-copy]").forEach(e=>{e.textContent=copy[e.dataset.copy];});
const status=document.getElementById("status"),profile=document.getElementById("profile");
let pending=false;
async function action(type,extra={}) {
  if(pending)return;pending=true;document.querySelectorAll("button").forEach(e=>{e.disabled=true;});
  try {
    const result=await chrome.runtime.sendMessage({type,...extra});
    if(!result?.ok)throw Error();
    if(type==="viral-ai:set-profile-label")status.textContent=copy.saved;
    else {
      const state=await chrome.runtime.sendMessage({type:"viral-ai:bridge-state"});
      if(!state?.ok)throw Error();profile.value=state.profileLabel||"";
      status.textContent=state.connected?copy.connected:copy.offline;
    }
  } catch {status.textContent=copy.failed;}
  finally {pending=false;document.querySelectorAll("button").forEach(e=>{e.disabled=false;});}
}
document.getElementById("profile-form").addEventListener("submit",e=>{e.preventDefault();action("viral-ai:set-profile-label",{profileLabel:profile.value});});
document.getElementById("open").addEventListener("click",()=>action("viral-ai:open-muse"));
document.getElementById("refresh").addEventListener("click",()=>action("viral-ai:reconnect"));
action("viral-ai:bridge-state");
