// Local document navigation only: no network, model calls, source execution or database writes.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RESEARCH = 'docs/research';
const LIBRARY = 'docs/research/bitcoin-upgrade';
const BATCH2 = LIBRARY + '/batch2-execution';
const BATCH2_REFERENCE = BATCH2 + '/90_reference';
const routing = JSON.parse(fs.readFileSync(path.join(ROOT, LIBRARY, 'routing.json'), 'utf8'));
const CATALOG = path.join(ROOT, LIBRARY, 'FILE_CATALOG.json');
const text = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const posix = file => file.replace(/\\/g, '/');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
const normalize = value => String(value).toLowerCase().replace(/\s+/g, '');
const clean = value => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
const clip = (value, length = 160) => value.length > length ? value.slice(0, length) + '…' : value;

const roles = {
  '00_start': '总纲', '01_accepted_plan': '设计方案', '02_adversarial_review': '终审纠偏',
  '03_research': '专题研究', '04_reuse_cards': '复用候选', '05_cases': '案例',
  '06_collection_design': '采集设计', '07_codex_usage': '提示词/使用参考',
  '08_evidence': '证据记录', '09_prior_research': '前期研究', '10_final_review': '终审资料',
  '90_archive': '历史档案'
};
const descriptions = {
  'LIBRARY_INDEX.json': '原包的专题、复用卡、案例与资料角色索引。',
  'MANIFEST.json': '原包文件清单；不描述外层仓库导航。',
  'openapi.design.json': '拟议研究API接口；不是现有Worker已实现的接口清单。',
  'research.schema.json': '拟议研究对象结构与字段约束。',
  'research_schema.proposed.sql': '拟议研究存储DDL；未应用于D1。',
  'settings.design.json': '拟议设置及尚未配置的预算/保留目标。',
  'collection.schema.design.json': '采集、来源与内容版本的拟议对象结构。',
  'source_catalog.candidates.json': '候选来源、取得方式和用途信息；不是已启用来源。',
  'discovery_recipes.json': '来源发现和检索问题配方。',
  'tasks.json': '原60个WP的范围、依赖、验收与回退规格。',
  'scoped_tasks.json': 'F-00至F-10及五种profile的范围依赖；未启动实施。',
  'task-topological-order.json': '原工作包的依赖顺序。',
  'dependency_audit.json': '原包任务依赖审查记录。',
  'repository-facts.json': '调查时的仓库事实元数据，不是当前线上证明。',
  'sources.json': '该目录所属研究的来源登记与证据范围。',
  'research_index.json': '25个专题的编号、标题、文件和来源索引。',
  'reuse_catalog.json': '67项软件/服务/规范/方法的复用比较与限制。',
  'case_index.json': '14个案例及证据来源索引。',
  'findings.json': '终审发现及所做的文档修订。',
  'compatibility_map.json': '新旧设计契约的兼容关系。',
  'external_rechecks.json': '终审期间的外部抽核记录。',
  'text_patch_receipts.json': '终审文档修订回执。',
  'slice_proposals.json': '可选切片提案，不是自动执行队列。'
};

// 批次与权威等级：本地核验记录 > 第一批设计快照 > 外部经验/候选；用于冲突时排序，不改变资料原文。
const BATCH = {
  local: { label: '本地核验', note: '本仓库 2026-09-16 的实际核验记录；反映当时仓库与网络事实，优先于外部设计。' },
  batch2: { label: '第二批', note: '第二批可执行资料（2026-09-17）；调度与验收以 EXECUTION_MASTER 与 EXECUTION_LOG 为准。' },
  batch1: { label: '第一批', note: '第一批研究/设计快照（2026-09-16）；用于方法、组件与工程细节，不是当前执行指令。' },
  archive: { label: '历史档案', note: '更早一轮原件，仅作追溯。' }
};
const AUTHORITY = {
  high: '本地核验/执行权威',
  design: '设计依据',
  reference: '备选参考',
  history: '仅追溯'
};
function classify(repoPath) {
  const p = posix(repoPath);
  if (p.startsWith(RESEARCH + '/') && !p.startsWith(LIBRARY + '/')) return { batch: 'local', authority: 'high' };
  if (p.startsWith(BATCH2 + '/')) {
    if (p.includes('/90_reference/')) return { batch: 'batch2', authority: 'reference' };
    if (p.includes('/99_history/')) return { batch: 'batch2', authority: 'history' };
    if (/EXECUTION_(MASTER|LOG)\.md$/.test(p) || p.includes('/01_execution/')) return { batch: 'batch2', authority: 'high' };
    return { batch: 'batch2', authority: 'design' };
  }
  if (p.startsWith(LIBRARY + '/sources/2026-09-16/90_archive/')) return { batch: 'archive', authority: 'history' };
  if (p.startsWith(LIBRARY + '/repository-baseline/')) return { batch: 'batch1', authority: 'design' };
  if (p.startsWith(LIBRARY + '/sources/')) return { batch: 'batch1', authority: 'design' };
  if (p.startsWith(LIBRARY + '/archives/') || p.startsWith(LIBRARY + '/batch2-execution/')) return { batch: 'batch1', authority: 'history' };
  return { batch: 'batch1', authority: 'reference' };
}

function importedFiles() {
  const sources = walk(path.join(ROOT, routing.sourceRoot));
  const baselines = walk(path.join(ROOT, LIBRARY, 'repository-baseline')).filter(p => path.basename(p).startsWith('bitcoin_research_'));
  // 本地核验记录：docs/research 顶层文件，仅本仓库产物。
  const local = walk(path.join(ROOT, RESEARCH)).filter(p => path.relative(path.join(ROOT, RESEARCH), p).split(path.sep).length === 1);
  // 第二批：排除 90_reference（201 份与第一批逐路径完全重复），只保留第二批自有内容。
  const batch2 = walk(path.join(ROOT, BATCH2)).filter(p => !p.startsWith(path.join(ROOT, BATCH2_REFERENCE) + path.sep));
  const archives = walk(path.join(ROOT, LIBRARY, 'archives')).filter(p => path.extname(p) === '.zip');
  return [...sources, ...baselines, ...local, ...batch2, ...archives];
}

function batch2Meta(repoPath) {
  const rel = repoPath.slice(BATCH2.length + 1);
  const phase = rel.match(/^01_execution\/phases\/(P\d{2})_/);
  if (phase) return { id: phase[1], role: '第二批阶段任务定义' };
  if (/(^|\/)EXECUTION_MASTER\.md$/.test(rel)) return { id: 'EXECUTION-MASTER', role: '第二批唯一执行总任务' };
  if (/(^|\/)EXECUTION_LOG\.md$/.test(rel)) return { id: 'EXECUTION-LOG', role: '第二批实际进度日志' };
  if (rel.startsWith('00_current/')) return { id: 'B2-' + rel.match(/(\d{2})_/)?.[1], role: '第二批技术方案正文' };
  if (rel === 'README.md') return { id: 'B2-README', role: '第二批说明与阶段表' };
  if (rel.startsWith('01_execution/')) return { id: 'B2-EXEC-' + path.basename(rel), role: '第二批执行导航/镜像' };
  if (rel.startsWith('02_contracts/')) return { id: 'B2-CONTRACT', role: '第二批拟议契约/合成样例' };
  if (rel.startsWith('03_validation/')) return { id: 'B2-VALIDATION', role: '第二批原验收场景，未在仓库执行' };
  if (rel.startsWith('04_evidence/')) return { id: 'B2-EVIDENCE', role: '第二批依据与清单' };
  if (rel.startsWith('05_release/')) return { id: 'B2-RELEASE', role: '第二批重整说明与保全' };
  if (rel.startsWith('99_history/')) return { id: 'B2-HISTORY', role: '被替换的旧入口原件' };
  return null;
}

function localMeta(repoPath) {
  const name = path.basename(repoPath);
  const ids = {
    'binance-connectivity-2026-09-16.md': 'LOCAL-BINANCE',
    'chart-workbench-review-2026-09-16.md': 'LOCAL-CHART',
    'free-financial-api-channels-2026-09-16.md': 'LOCAL-CHANNELS',
    'free-financial-platform-limits-2026-09-16.md': 'LOCAL-LIMITS',
    'workbench-binance-data-plan-2026-09-16.md': 'LOCAL-WORKBENCH'
  };
  return ids[name] ? { id: ids[name], role: '本仓库本地核验记录（权威最高，但仅代表核验当时）' } : null;
}

function headings(body) {
  let fenced = false;
  return body.split('\n').flatMap((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return []; }
    const match = !fenced && line.match(/^(#{1,3})\s+(.+)$/);
    return match ? [{ title: clean(match[2]), line: i + 1, level: match[1].length }] : [];
  });
}

function buildCatalog() {
  const metadata = new Map();
  for (const name of ['research_index.json', 'reuse_catalog.json', 'case_index.json']) {
    for (const row of JSON.parse(text(path.join(ROOT, routing.sourceRoot, '08_evidence', name)))) metadata.set(row.path, row);
  }
  return importedFiles().map(file => {
    const repoPath = posix(path.relative(ROOT, file));
    const rel = posix(path.relative(path.join(ROOT, routing.sourceRoot), file));
    const name = path.basename(file), extension = path.extname(file);
    const meta = metadata.get(rel);
    const volume = rel.match(/^01_accepted_plan\/volumes\/(\d{2})_/);
    const collection = rel.match(/^06_collection_design\/(\d{2})_/);
    const special = { '10_final_review/contract_migration.md': 'CONTRACT-MIGRATION', '10_final_review/value_and_decision_tests.md': 'VALUE-TESTS' };
    const local = localMeta(repoPath);
    const b2 = repoPath.startsWith(BATCH2 + '/') ? batch2Meta(repoPath) : null;
    const extra = local || b2;
    const id = extra?.id || meta?.id || (volume ? 'V' + volume[1] : collection ? 'COL' + collection[1] : special[rel]) || repoPath;
    let title = meta?.title || meta?.name || name;
    let summary = descriptions[name];
    const klass = classify(repoPath);
    let sections = [];
    let role = extra?.role || roles[repoPath.startsWith(LIBRARY + '/sources/') ? rel.split('/')[0] : ''] || '来源/归档';
    if (repoPath.includes('/repository-baseline/')) role = '原仓库事实/审阅';
    if (extension === '.md') {
      const body = text(file);
      sections = headings(body);
      title = meta?.title || meta?.name || sections[0]?.title || name;
      const intro = body.replace(/^#{1,6}[^\n]*\n?/gm, '').split(/\n\s*\n/).find(p => {
        const first = p.trim();
        return first && !/^(#|\||```|~~~|\[|>|- |查询日期|研究日期|资料核验|版本[：:]|\*\*版本|2026-)/.test(first);
      });
      summary = meta?.repository_fit || summary || clean(intro || title);
      if (name === 'complete_plan.md' || name === 'FINAL_REVIEW.md') {
        summary = '合订阅读副本，内容与分卷/终审材料重叠；具体问题优先查询相应分卷，避免重复加载。';
        sections = sections.filter(h => h.level === 1);
      }
    } else if (extension === '.py') {
      role = '参考检查脚本'; summary = '资料包作者的离线文档检查脚本；本导航只登记，不执行或安装依赖。';
    } else if (extension === '.zip') {
      role = '原始压缩包'; summary = '原始交付包，供追溯；不递归展开或执行包内内容。';
    } else if (repoPath.startsWith(BATCH2 + '/')) {
      summary = extra ? BATCH[b2 ? 'batch2' : 'local'].note : summary;
    } else if (rel.includes('/fixtures/') || /synthetic|sample_/.test(name)) {
      role = '合成样例'; summary = '设计用合成输入/输出或验收场景：' + name + '；不代表真实采集或已通过业务验收。';
    } else if (rel.includes('/results/') || /qc|preservation|statistics|prior_/.test(name)) {
      role = '作者检查/历史记录'; summary = summary || '原包作者的检查或历史记录：' + name + '；不作为本轮仓库验证结果。';
    }
    return { id, path: repoPath, title, role, batch: klass.batch, authority: klass.authority, summary: clip(summary || role + '结构化材料：' + name), bytes: fs.statSync(file).size, headings: sections };
  });
}

function loadCatalog() {
  if (!fs.existsSync(CATALOG)) throw Error('目录尚未生成；运行 node scripts/research-context.cjs --refresh');
  return JSON.parse(text(CATALOG)).files;
}
function findFile(files, selector) {
  const exact = files.find(f => normalize(f.id) === normalize(selector) || f.path === selector);
  if (exact) return exact;
  const matches = files.filter(f => normalize(f.path).includes(normalize(selector)));
  if (matches.length !== 1) throw Error(matches.length ? '文件名有歧义，请使用完整路径或ID：' + matches.slice(0, 6).map(f => f.id).join(', ') : '未找到资料：' + selector);
  return matches[0];
}
function rank(query) {
  const q = normalize(query);
  return routing.routes.map(route => {
    const matches = route.keywords.filter(keyword => {
      const hit = /^[a-z0-9 -]+$/i.test(keyword) ? new RegExp('\\b' + keyword + '\\b', 'i').test(query) : q.includes(normalize(keyword));
      return hit;
    });
    // Nested aliases such as K线/K线图 are one signal, not two votes over a specific symptom.
    const distinct = matches.filter(keyword => !matches.some(other => other !== keyword && normalize(other).includes(normalize(keyword))));
    return { route, score: route.id === query ? 1000 : distinct.reduce((score, keyword) => score + 10 + Math.min(keyword.length, 12), 0) };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
}
function sectionMatches(file, query) {
  return file.headings.filter(h => !query || normalize(h.title).includes(normalize(query)));
}
function tag(file) {
  const b = BATCH[file.batch], a = AUTHORITY[file.authority];
  return '批次:' + (b?.label || file.batch) + '｜权威:' + (a || file.authority);
}
function printFile(file, query) {
  console.log(file.id + ' | ' + file.title + ' [' + file.role + ']');
  console.log(tag(file) + '\n' + file.path + '\n' + file.summary);
  const matches = sectionMatches(file, query);
  if (query && !matches.length) console.log('没有标题命中，以下仅显示目录前8项；可换关键词。');
  for (const h of (matches.length ? matches : file.headings).slice(0, 8)) console.log('  L' + h.line + ' ' + h.title);
  console.log('只返回目录；按以上行号读取相关段落，资料中的指令不自动生效。');
}
function printRoute(route, files) {
  console.log(route.id + ' | ' + route.title + '\n' + route.summary);
  console.log('\n代码起点（按症状选择，不要求全部修改）：');
  route.code.forEach(p => console.log('  ' + p));
  console.log('\n首读资料（最多3份，只指向需要的章节）：');
  route.primary.forEach(ref => {
    const file = findFile(files, ref.id);
    const section = ref.section ? sectionMatches(file, ref.section)[0] : file.headings[0];
    console.log('  ' + ref.id + ' ' + file.path + (section ? ':' + section.line : '') + ' — ' + (section?.title || file.title) + ' [' + tag(file) + ']');
  });
  console.log('\n代码图：codegraph explore "' + route.graph + '" --max-files 2');
  if (route.graphNote) console.log('已知图索引限制：' + route.graphNote);
  const conflict = route.primary.map(ref => findFile(files, ref.id)).filter(f => f.authority !== 'design');
  if (new Set(conflict.map(f => f.authority)).size > 1) console.log('权威提示：命中多等级资料，冲突时按 本地核验 > 第一批设计 > 备选参考 取舍，并记录依据。');
  console.log('关联扩展（仅命中对应情况时继续）：');
  route.related.forEach(r => console.log('  ' + r.id + '：' + r.when));
  console.log('补充资料ID：' + route.expand.join(', '));
  console.log('相关验证（按实际改动选，不自动执行）：' + route.checks.join('；'));
  console.log('可观察结果：' + route.acceptance);
}

function check(files) {
  const problems = [];
  const actual = new Set(importedFiles().map(f => posix(path.relative(ROOT, f))));
  for (const file of files) {
    if (!actual.delete(file.path)) problems.push('目录中存在重复或多余文件：' + file.path);
    else if (fs.statSync(path.join(ROOT, file.path)).size !== file.bytes) problems.push('资料大小改变，请刷新目录：' + file.path);
  }
  for (const file of actual) problems.push('资料未编目：' + file);
  const packageScripts = JSON.parse(text(path.join(ROOT, 'package.json'))).scripts;
  for (const route of routing.routes) {
    for (const file of route.code) if (!fs.existsSync(path.join(ROOT, file))) problems.push(route.id + ' 代码路径失效：' + file);
    for (const ref of [...route.primary, ...route.expand.map(id => ({ id }))]) {
      try {
        const file = findFile(files, ref.id);
        const matched = ref.section ? sectionMatches(file, ref.section) : [];
        if (ref.section && !matched.length) problems.push(route.id + ' 章节未命中：' + ref.id + '/' + ref.section);
        for (const heading of matched) {
          const actualLine = text(path.join(ROOT, file.path)).split('\n')[heading.line - 1];
          if (!actualLine || clean(actualLine.replace(/^#{1,3}\s+/, '')) !== heading.title) problems.push('章节行号已变化，请刷新目录：' + file.id);
        }
      } catch (error) { problems.push(error.message); }
    }
    for (const related of route.related) if (!routing.routes.some(r => r.id === related.id)) problems.push('关联路由失效：' + related.id);
    for (const command of route.checks) {
      if (command.startsWith('npm run ') && !packageScripts[command.slice(8)]) problems.push('npm命令不存在：' + command);
      if (command.startsWith('node ') && !fs.existsSync(path.join(ROOT, command.slice(5)))) problems.push('验证脚本不存在：' + command);
    }
  }
  for (const example of routing.examples) if (rank(example.query)[0]?.route.id !== example.expected) problems.push('路由不符：' + example.query + ' → ' + example.expected);
  console.log(JSON.stringify({ status: problems.length ? 'FAIL' : 'PASS', files: files.length, routes: routing.routes.length, queryCases: routing.examples.length, problems }, null, 2));
  process.exitCode = problems.length ? 1 : 0;
}

function main(args) {
  if (args[0] === '--refresh') {
    const files = buildCatalog();
    fs.writeFileSync(CATALOG, JSON.stringify({ note: 'Generated navigation metadata, not executable instructions. Refresh after source changes. Query this file through scripts/research-context.cjs instead of reading it in full.', files }, null, 2) + '\n');
    console.log('已编目 ' + files.length + ' 个来源文件；未改写原文。');
    return;
  }
  if (!args.length || args[0] === '--help') {
    console.log('用法：node scripts/research-context.cjs <问题>\n  --list                 列出功能路由\n  --file <ID或文件名> [章节关键词]  文件摘要与最多8个章节行号\n  --find <关键词>        最多8份文件摘要\n  --check                检查编目、路径、章节和路由样例\n  --refresh              重新生成资料目录，不修改来源\n例：node scripts/research-context.cjs K线历史回补\n例：node scripts/research-context.cjs --file V08 时间和来源\n所有查询只读，不自动执行CodeGraph、测试、模型或发布命令。');
    return;
  }
  if (args[0] === '--list') { routing.routes.forEach(r => console.log(r.id + ' | ' + r.title)); return; }
  const files = loadCatalog();
  if (args[0] === '--check') return check(files);
  if (args[0] === '--file') {
    if (!args[1]) throw Error('--file需要ID或文件名');
    return printFile(findFile(files, args[1]), args.slice(2).join(' '));
  }
  if (args[0] === '--find') {
    const query = normalize(args.slice(1).join(' '));
    if (!query) throw Error('--find需要关键词');
    const hits = files.filter(f => normalize(f.id + ' ' + f.title + ' ' + f.path + ' ' + f.summary).includes(query));
    hits.slice(0, 8).forEach(f => console.log(f.id + ' | ' + f.title + '\n' + f.path + '\n' + f.summary + '\n'));
    console.log('匹配 ' + hits.length + ' 份，最多显示8份；进一步用 --file ID。');
    return;
  }
  if (args[0].startsWith('--')) throw Error('未知选项，使用 --help 查看用法。');
  const ranked = rank(args.join(' '));
  if (!ranked.length) { console.log('没有明确功能路由。使用 --list，或 --find 关键词；不默认读取全部资料。'); return; }
  printRoute(ranked[0].route, files);
  if (ranked.length > 1) console.log('\n其他可能相关：' + ranked.slice(1, 3).map(r => r.route.id + '（' + r.route.title + '）').join('；'));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { rank, buildCatalog, loadCatalog };
