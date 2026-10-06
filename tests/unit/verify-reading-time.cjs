const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const scope={};vm.createContext(scope);vm.runInContext(fs.readFileSync('js/research-desk.js','utf8')+'\nglobalThis.format=ResearchDesk.time;',scope);
const ms=1791138600000,iso=new Date(ms).toISOString();
assert.equal(scope.format(ms),scope.format(iso));assert.match(scope.format(ms),/2026\/10\/05 02:30/);
assert.equal(scope.format('2026-10-04'),'2026-10-04 · 仅日期');assert.equal(scope.format('2026-10-04T17:00:00Z','date'),'2026-10-04 · 仅日期');
assert.match(scope.format('2026-10-04T17:00:00Z'),/2026\/10\/05 01:00/);
for(const v of [null,undefined,'','nonsense',true,{},Infinity,'2026-02-30'])assert.equal(scope.format(v),'时间未明确',String(v));
assert.match(scope.format(0),/1970\/01\/01 08:00/);console.log('PASS A01 numeric/ISO/date precision/unknown/Beijing boundary; no invented occurrence clock');
