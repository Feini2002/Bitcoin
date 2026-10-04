const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
 const {TeamStore}=await import('../../scripts/agent-team/store.mjs'),root=path.resolve('.artifacts'),directory=path.join(root,'atomic-write-'+crypto.randomUUID()),store=new TeamStore(directory);fs.mkdirSync(directory,{recursive:true});store.owned=true;
 const rename=fs.renameSync;try{
  store.write('record.json',{original:true});
  let attempts=0;fs.renameSync=(from,to)=>{if(++attempts<=7)throw Object.assign(Error('temporary replacement lock'),{code:'EPERM'});return rename(from,to);};
  if(process.platform==='win32'){store.write('record.json',{new:true});assert.equal(attempts,8);assert.deepEqual(store.read('record.json'),{new:true});}
  fs.renameSync=()=>{throw Object.assign(Error('persistent replacement lock'),{code:'EPERM'});};const before=fs.readFileSync(store.file('record.json'),'utf8');await assert.rejects(async()=>store.write('record.json',{lost:true}),e=>e.code==='TEAM_STORAGE');assert.equal(fs.readFileSync(store.file('record.json'),'utf8'),before);assert.deepEqual(fs.readdirSync(directory),['record.json']);
  console.log('PASS Windows transient lock longer than former retry budget, bounded persistent failure preserves the original and removes only its own temporary file');
 }finally{fs.renameSync=rename;if(path.dirname(path.resolve(directory))!==root)throw Error('fixture target');fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
