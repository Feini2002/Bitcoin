import fs from 'node:fs';
import path from 'node:path';
import {createRun,createTask,pendingRoles,receiveOutput,cancelRun,failRun,resumeFailedRun,exportSession,restoreSession,validateSnapshot} from '../../js/research-v2/index.mjs';
import {authStatus,runCodexTask} from '../research/codex-provider.mjs';
export function researchBridge(){
  const directory=path.resolve('.artifacts/research-team');const jobs=new Map();let active=null;
  const persist=job=>{fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,job.run.runId+'.json');const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(exportSession(job.run)));fs.renameSync(temp,file);};
  const summary=run=>({runId:run.runId,question:run.snapshot.question,createdAt:run.createdAt,completedAt:run.completedAt,status:run.status,mode:run.mode,failure:run.failure,revision:run.audit.length,tasks:run.tasks.map(t=>({taskId:t.taskId,role:t.role,stage:t.stage,receivedAt:t.receipt?.receivedAt||null}))});
  async function execute(job){
    let firstFailure=null;
    const deadline=setTimeout(()=>{cancelRun(job.run,'run_deadline_40_minutes');job.controller.abort();},2400000);
    try{
      while(!['complete','cancelled','failed'].includes(job.run.status)){
        const roles=pendingRoles(job.run);
        for(let i=0;i<roles.length;i+=2){
          const results=await Promise.allSettled(roles.slice(i,i+2).map(async role=>{
            try{
            const task=createTask(job.run,role);persist(job);
            const result=await runCodexTask(task,{signal:job.controller.signal,timeoutMs:task.stage==='synthesis'?900000:480000,onEvent:event=>{
              job.run.audit.push({at:new Date().toISOString(),event:'provider_progress',taskId:task.taskId,detail:event});persist(job);
            }});
            receiveOutput(job.run,task.taskId,result.output,result.provenance);persist(job);
            }catch(error){if(!firstFailure)firstFailure=error;job.controller.abort();throw error;}
          }));
          const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
        }
      }
    }catch(error){job.controller.abort();if(job.run.status!=='cancelled')failRun(job.run,firstFailure||error);persist(job);}
    finally{clearTimeout(deadline);if(active===job.run.runId)active=null;persist(job);}
  }
  async function readBody(req){
    const chunks=[];let bytes=0;req.setTimeout(15000,()=>req.destroy());
    try{for await(const part of req){bytes+=part.length;if(bytes>12*1024*1024)throw Error('request_too_large');chunks.push(part);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    finally{req.setTimeout(0);}
  }
  function load(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('invalid_run_id');const existing=jobs.get(id);if(existing)return existing;
    const file=path.join(directory,id+'.json');if(!fs.existsSync(file))throw Error('run_not_found');const run=restoreSession(JSON.parse(fs.readFileSync(file,'utf8')));
    if(!['complete','failed','cancelled'].includes(run.status)){failRun(run,'本机服务已重启，原运行无法续接；输入与已收到结果保留。');persist({run});}
    return {run,controller:null};}
  function list(){if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>{try{return summary(load(name.slice(0,-5)).run);}catch{return null;}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);}
  return {name:'local-codex-research',configureServer(server){
    server.httpServer?.once('close',()=>{for(const job of jobs.values())if(job.controller&&!['complete','failed','cancelled'].includes(job.run.status)){cancelRun(job.run,'development_server_closed');job.controller.abort();persist(job);}});
    server.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/local-research/'))return next();
      const send=(data,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));};
      try{
        const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))return send({error:'loopback_only'},403);
        const allowed='http://'+host;const origin=req.headers.origin;
        if(origin&&origin!==allowed)return send({error:'same_origin_only'},403);
        if(req.method!=='GET'&&(!origin||!String(req.headers['content-type']).startsWith('application/json')))return send({error:'same_origin_json_required'},403);
        if(req.method==='GET'&&url.pathname==='/api/local-research/status')return send({...await authStatus(),activeRunId:active});
        if(req.method==='GET'&&url.pathname==='/api/local-research/runs')return send({runs:list()});
        const match=/^\/api\/local-research\/runs\/([a-f0-9-]{36})(\/summary|\/cancel|\/retry)?$/.exec(url.pathname);
        if(match&&req.method==='GET'&&(!match[2]||match[2]==='/summary')){const job=load(match[1]);return send(match[2]==='/summary'?summary(job.run):exportSession(job.run));}
        if(match&&match[2]==='/cancel'&&req.method==='POST'){
          const job=jobs.get(match[1]);if(!job?.controller)return send({error:'no_active_local_process'},409);
          cancelRun(job.run);job.controller.abort();persist(job);return send(summary(job.run));
        }
        if(match&&match[2]==='/retry'&&req.method==='POST'){
          if(active)return send({error:'已有研究正在运行，请先查看或取消',runId:active},409);
          const auth=await authStatus();if(!auth.available)return send({error:auth.message,auth:auth.auth},409);
          await readBody(req);if(active)return send({error:'已有研究正在运行，请先查看或取消',runId:active},409);
          const previous=load(match[1]);if(previous.run.mode!=='codex_cli'||previous.run.status!=='failed')return send({error:'只能续跑失败的本地 Codex 研究'},409);
          const archive=path.join(directory,'archives');fs.mkdirSync(archive,{recursive:true});fs.writeFileSync(path.join(archive,previous.run.runId+'.failed.'+Date.now()+'.json'),JSON.stringify(exportSession(previous.run)),{flag:'wx'});
          const run=resumeFailedRun(previous.run),job={run,controller:new AbortController()};jobs.set(run.runId,job);active=run.runId;persist(job);void execute(job);return send(summary(run),202);
        }
        if(req.method==='POST'&&url.pathname==='/api/local-research/runs'){
          if(active)return send({error:'已有研究正在运行，请先查看或取消',runId:active},409);
          const auth=await authStatus();if(!auth.available)return send({error:auth.message,auth:auth.auth},409);
          const body=await readBody(req);validateSnapshot(body.snapshot);
          if(active)return send({error:'已有研究正在运行，请先查看或取消',runId:active},409);
          const run=createRun(body.snapshot,{mode:'codex_cli'}),job={run,controller:new AbortController()};jobs.set(run.runId,job);active=run.runId;persist(job);void execute(job);return send(summary(run),202);
        }
        return send({error:'unsupported_local_research_route'},404);
      }catch(error){send({error:error.message},400);}
    });
  }};
}
