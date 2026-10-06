// Import an explicitly prepared Chinese reader edition. Never calls a model or edits analysis.
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './agent-team/tools.mjs';
import {validateEdition} from './agent-team/reading-content.mjs';
const input=process.argv[2];if(!input)throw Error('请指定中文阅读稿JSON文件；格式见 docs/research/consumer-daily-frontend-implementation-2026-10-05.md');
const value=JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
if(!/^[a-f0-9-]{36}$/.test(value.reportId||''))throw Error('阅读稿没有有效的原报告身份');
const saved=JSON.parse(fs.readFileSync(path.resolve('.local/agent-team','report-'+value.reportId+'.json'),'utf8'));
if(saved.hash!==hash(saved.payload))throw Error('原报告内容校验失败');
validateEdition(value,saved.payload,saved.hash);
const directory=path.resolve('.local/reader-content');fs.mkdirSync(directory,{recursive:true});
const target=path.join(directory,value.reportId+'.json'),temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,target);
console.log('已保存所选报告的独立阅读稿。分析原件、研究设置和执行流程未修改。');
