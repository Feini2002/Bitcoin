'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
async function main(){
 const timers=new Map();let id=0,stall=true;const statuses=[];const bars=[];
 const ctx=vm.createContext({console,Date,Math,Map,Set,URLSearchParams,AbortController,document:{hidden:false},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:n=>timers.delete(n),setInterval:()=>++id,clearInterval:()=>{},getBitDataApiBase:()=> 'https://fixture.invalid',fetch:(_url,opts)=>stall?new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))):Promise.resolve({ok:true,headers:{get:()=>null},json:async()=>({schemaVersion:'test',quality:{status:'fail'},series:[],gap:{reason:'empty_test'}})})});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/orderflow/footprint-engine.js'),'utf8'),ctx,{timeout:1000});
 const stream=new ctx.FootprintEngine.FootprintStream({onStatus:s=>statuses.push(s),onBars:(b,m)=>bars.push(m)});
 const request=stream.pollOnce();assert.equal(stream.polling,true);const timeout=[...timers.values()].find(t=>t.ms===15000);assert.ok(timeout);timeout.fn();await request;
 assert.equal(stream.polling,false);assert.equal(stream.authoritative,false);assert.equal(bars.at(-1).gap.reason,'read_timeout');assert.match(statuses.at(-1),/超时/);
 stall=false;await stream.pollOnce();assert.equal(stream.polling,false);assert.equal(bars.at(-1).gap.reason,'empty_test');
 stall=true;const disposed=stream.pollOnce();const before=bars.length;stream.stop(true);await disposed;assert.equal(bars.length,before);assert.equal(stream.activeAbort,null);
 console.log('PASS footprint stalled read releases poll guard, shows timeout, permits next read and suppresses disposed callbacks');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
