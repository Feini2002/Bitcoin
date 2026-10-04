'use strict';
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const protocol=require('../../js/research-protocol.js');
const {report}=require('../fixtures/research-test-fixtures.cjs');
const importer=require('../../scripts/research/import-yuqing-report.cjs');
for(const kind of Object.keys(protocol.modules)){
  assert.deepEqual(protocol.validate(report(kind)),[]);
  assert.match(protocol.prompt(kind),/prepare-research/);
  for(const m of protocol.modules[kind])assert.match(protocol.prompt(kind,m.id),/单模块复核/);
}
for(const mutate of [r=>r.report.sources[0].url='javascript:alert(1)',r=>r.report.sources.push(r.report.sources[0]),r=>r.report.events[0].sourceIds=['missing'],r=>r.report.events[0].occurredAt='2026-02-31T00:00:00Z',r=>r.report.catalysts[0].occurredAt='2026-02-31',r=>r.report.events[1].id='e1',r=>r.report.asOf='2027-01-01T00:00:00Z',r=>r.report.sources[0].accessedAt=null,r=>r.report.narratives[0].counterEvidence='',r=>r.report.scenarios[0].invalidation='']){
 const r=report();mutate(r);assert.ok(protocol.validate(r).length);assert.throws(()=>importer.normalizePayload(r));
}
const formal=report();formal.grounding.generator='codex';formal.report.title="Codex 正式研究 O'Brien";
const normalized=importer.normalizePayload(formal);assert.notEqual(normalized.grounding.devImport,true);assert.equal(normalized.report.costEstimate,undefined);
assert.equal(importer.parseArgs(['input.json']).dryRun,true);assert.equal(importer.parseArgs(['input.json']).remote,false);assert.throws(()=>importer.parseArgs(['--remote','--local']));
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE yuqing_reports(id TEXT PRIMARY KEY,kind TEXT,report_date TEXT,slot TEXT,trigger_type TEXT,generated_at TEXT,status TEXT,source_refs_json TEXT,grounding_json TEXT,market_snapshot_json TEXT,report_json TEXT,source_errors_json TEXT)');
db.exec(importer.toSql(normalized));assert.equal(JSON.parse(db.prepare('SELECT report_json FROM yuqing_reports').get().report_json).title,formal.report.title);
assert.throws(()=>db.exec(importer.toSql({...normalized,report:{...normalized.report,title:'replacement'}})),/UNIQUE/);
assert.equal(JSON.parse(db.prepare('SELECT report_json FROM yuqing_reports').get().report_json).title,formal.report.title);db.close();
console.log('PASS research schema, source/time integrity, module instructions, formal AI identity, SQL escaping and collision preservation');
