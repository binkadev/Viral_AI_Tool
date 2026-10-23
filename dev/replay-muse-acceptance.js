"use strict";
// Offline file only. Never opens an application, browser, bridge or job store.
const fs=require('node:fs'),replay=require('../extensions/meta-muse-bridge/acceptance-replay');
try {
 const file=process.argv[2],stat=fs.lstatSync(file);
 if(!stat.isFile() || stat.isSymbolicLink() || stat.size>replay.MAX_BYTES*6)throw Error('INVALID_TRACE');
 const input=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=replay.replay(input.trace||input);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch{process.stderr.write('Invalid or unsupported acceptance trace\n');process.exitCode=1;}
