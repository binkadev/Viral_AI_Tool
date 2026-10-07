(function installCoreCommandPalette(){
  "use strict";

  const root=document.documentElement;
  let activeIndex=0;
  let options=[];
  let dialog=null;
  let input=null;
  let list=null;

  function locale(){
    try{return typeof state!=="undefined"&&state?.locale==="en"?"en":"vi"}catch{return root.lang==="en"?"en":"vi"}
  }
  function tr(key,vars){
    try{return window.I18N?.t?.(locale(),key,vars)??key}catch{return key}
  }
  function copy(){
    const quick=tr("app.searchAnything");
    return{
      trigger:quick,
      placeholder:quick+"…",
      title:quick,
      inputLabel:tr("app.search"),
      hint:tr("common.choose")
    };
  }
  function trigger(){return document.querySelector(".command-palette")}
  function navOptions(){
    return Array.from(document.querySelectorAll("#nav .nav-item[data-page]"))
      .filter(node=>node instanceof HTMLButtonElement&&!node.hidden)
      .map(node=>{
        const labelNode=node.querySelector("span:not(.nav-icon)");
        const label=String(labelNode?.textContent||node.textContent||"").replace(/\s+/g," ").trim();
        return{page:String(node.dataset.page||""),label,node};
      })
      .filter(item=>item.page&&item.label);
  }
  function ensureDialog(){
    if(dialog&&document.body.contains(dialog))return;
    dialog=document.createElement("div");
    dialog.className="core-command-backdrop";
    dialog.hidden=true;
    dialog.setAttribute("aria-hidden","true");
    dialog.innerHTML='<section class="core-command-dialog" role="dialog" aria-modal="true" aria-labelledby="coreCommandTitle">'+
      '<header class="core-command-head"><div><span class="core-command-kicker">⌘</span><strong id="coreCommandTitle"></strong></div><kbd>Esc</kbd></header>'+
      '<label class="core-command-search"><span aria-hidden="true">⌕</span><input type="text" role="combobox" aria-autocomplete="list" aria-controls="coreCommandList" aria-expanded="false" autocomplete="off" spellcheck="false" /></label>'+
      '<div id="coreCommandList" class="core-command-list" role="listbox"></div>'+
      '<footer class="core-command-footer"><span>↑ ↓</span><span class="core-command-nav-hint"></span><span>↵</span></footer>'+
    '</section>';
    document.body.appendChild(dialog);
    input=dialog.querySelector("input");
    list=dialog.querySelector(".core-command-list");
    dialog.addEventListener("mousedown",event=>{if(event.target===dialog)close()});
    input.addEventListener("input",()=>renderOptions(input.value));
    input.addEventListener("keydown",onInputKeydown);
    list.addEventListener("mousemove",event=>{
      const row=event.target.closest("[data-command-index]");
      if(!row)return;
      const next=Number(row.dataset.commandIndex);
      if(Number.isInteger(next)){activeIndex=next;paintActive()}
    });
    list.addEventListener("click",event=>{
      const row=event.target.closest("[data-command-index]");
      if(!row)return;
      activate(Number(row.dataset.commandIndex));
    });
  }
  function renderOptions(query=""){
    ensureDialog();
    const normalizedQuery=String(query||"").trim();
    options=navOptions().filter(item=>item.label.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()));
    activeIndex=Math.min(activeIndex,Math.max(0,options.length-1));
    if(!options.length){
      input.removeAttribute("aria-activedescendant");
      list.innerHTML='<div class="core-command-empty">'+escapeHtml(tr("file.missingToast",{name:normalizedQuery||tr("app.search")}))+'</div>';
      return;
    }
    list.innerHTML=options.map((item,index)=>'<button id="coreCommandOption-'+index+'" class="core-command-option" type="button" role="option" aria-selected="'+(index===activeIndex?'true':'false')+'" data-command-index="'+index+'"><span class="core-command-option-icon" aria-hidden="true">'+(item.node.querySelector(".nav-icon")?.textContent||"•")+'</span><span>'+escapeHtml(item.label)+'</span><kbd>↵</kbd></button>').join("");
    paintActive();
  }
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
  function paintActive(){
    if(!list)return;
    let activeId="";
    list.querySelectorAll("[data-command-index]").forEach((row,index)=>{
      const active=index===activeIndex;
      row.classList.toggle("is-active",active);
      row.setAttribute("aria-selected",active?"true":"false");
      if(active){activeId=row.id;row.scrollIntoView({block:"nearest"})}
    });
    if(input){
      if(activeId)input.setAttribute("aria-activedescendant",activeId);
      else input.removeAttribute("aria-activedescendant");
    }
  }
  function activate(index){
    const item=options[index];
    if(!item)return;
    close();
    requestAnimationFrame(()=>item.node.click());
  }
  function onInputKeydown(event){
    if(event.key==="ArrowDown"){event.preventDefault();if(options.length){activeIndex=(activeIndex+1)%options.length;paintActive()}}
    else if(event.key==="ArrowUp"){event.preventDefault();if(options.length){activeIndex=(activeIndex-1+options.length)%options.length;paintActive()}}
    else if(event.key==="Enter"){event.preventDefault();activate(activeIndex)}
    else if(event.key==="Escape"){event.preventDefault();close()}
    else if(event.key==="Tab"){event.preventDefault();input.focus({preventScroll:true})}
  }
  function syncCopy(){
    const c=copy();
    const button=trigger();
    if(button){
      const label=button.querySelector(".command-copy");
      if(label)label.textContent=c.trigger;
      button.setAttribute("aria-label",c.title);
      button.setAttribute("aria-haspopup","dialog");
      button.setAttribute("aria-expanded",dialog&&!dialog.hidden?"true":"false");
    }
    if(dialog){
      const title=dialog.querySelector("#coreCommandTitle");
      const hint=dialog.querySelector(".core-command-nav-hint");
      if(title)title.textContent=c.title;
      if(hint)hint.textContent=c.hint;
      if(input){
        input.placeholder=c.placeholder;
        input.setAttribute("aria-label",c.inputLabel);
      }
    }
  }
  function open(){
    ensureDialog();syncCopy();activeIndex=0;input.value="";renderOptions("");
    dialog.hidden=false;dialog.setAttribute("aria-hidden","false");input.setAttribute("aria-expanded","true");root.dataset.commandPalette="open";syncCopy();
    requestAnimationFrame(()=>input.focus({preventScroll:true}));
  }
  function close(){
    if(!dialog||dialog.hidden)return;
    dialog.hidden=true;dialog.setAttribute("aria-hidden","true");input?.setAttribute("aria-expanded","false");input?.removeAttribute("aria-activedescendant");delete root.dataset.commandPalette;syncCopy();trigger()?.focus({preventScroll:true});
  }
  function start(){
    ensureDialog();syncCopy();
    trigger()?.addEventListener("click",open);
    document.addEventListener("keydown",event=>{
      if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==="k"){event.preventDefault();dialog&&!dialog.hidden?close():open()}
      else if(event.key==="Escape"&&dialog&&!dialog.hidden){event.preventDefault();close()}
    });
    const nav=document.getElementById("nav");
    if(nav)new MutationObserver(()=>{syncCopy();if(dialog&&!dialog.hidden)renderOptions(input?.value||"")}).observe(nav,{childList:true,subtree:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
