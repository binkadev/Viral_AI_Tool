"use strict";
const model=require("./model");
function register({ipcMain,trusted,service}) {
  for(const [action,method]of Object.entries({list:"view",enqueue:"enqueue",start:"start",cancel:"cancel"}))ipcMain.handle("publish:"+action,async(event,...args)=>{
    if(!trusted(event))return {ok:false,code:"UNAUTHORIZED"};
    if(args.length!==(action==="list"?0:1)||(action!=="list"&&!(action==="enqueue"?model.identifier(args[0]):model.itemId(args[0]))))return {ok:false,code:"INVALID_REQUEST"};
    const target=service();if(!target)return {ok:false,code:"UNAVAILABLE"};
    try{const value=await target[method](...args);return value?.ok===false?{ok:false,code:model.code(value)}:{ok:true,value};}catch(e){return {ok:false,code:model.code(e)};}
  });
}
module.exports={register};
