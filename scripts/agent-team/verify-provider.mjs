import fs from 'node:fs';
import {authStatus,runStructured} from '../research/codex-provider.mjs';
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
try{
  const auth=await authStatus({signal:controller.signal});console.log(JSON.stringify({phase:'authentication',...auth}));if(!auth.available)throw Error('ChatGPT subscription authentication unavailable');
  const result=await runStructured('这是接口能力验收，不是市场报告。请只输出 {"status":"ready","explanation":"结构化输出可用"}，不要使用任何工具。',{type:'object',properties:{status:{type:'string',enum:['ready']},explanation:{type:'string'}},required:['status','explanation'],additionalProperties:false},{signal:controller.signal,timeoutMs:170000,onEvent:e=>console.log(JSON.stringify({phase:e.event||e.type,pid:e.pid,itemType:e.itemType,cleanup:e.cleanup}))});
  fs.mkdirSync('.artifacts/agent-team',{recursive:true});fs.writeFileSync('.artifacts/agent-team/provider-capability.json',JSON.stringify({checkedAt:new Date().toISOString(),...result},null,2));console.log(JSON.stringify({phase:'PASS',output:result.output,provenance:result.provenance}));
}finally{clearTimeout(timer);}
