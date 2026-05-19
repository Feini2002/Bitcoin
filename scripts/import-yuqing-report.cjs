#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_DB = "yuqing";
const DAILY_EVENT_KIND = "daily_event";

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/import-yuqing-report.cjs <report.json> --remote",
      "  node scripts/import-yuqing-report.cjs --sample-codex-daily --remote",
      "",
      "Options:",
      "  --remote                 Write to remote Cloudflare D1",
      "  --local                  Write to local D1",
      "  --database=<name>        D1 database name, default yuqing",
      "  --dry-run                Print normalized payload without writing",
      "  --sample-codex-daily     Import a Codex D1 connectivity sample, not a Worker-prompt report",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const opts = {
    database: DEFAULT_DB,
    remote: false,
    local: false,
    dryRun: false,
    sampleCodexDaily: false,
    inputPath: "",
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--remote") {
      opts.remote = true;
    } else if (arg === "--local") {
      opts.local = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--sample-codex-daily") {
      opts.sampleCodexDaily = true;
    } else if (arg.startsWith("--database=")) {
      opts.database = arg.slice("--database=".length).trim() || DEFAULT_DB;
    } else if (!arg.startsWith("--") && !opts.inputPath) {
      opts.inputPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.remote && !opts.local) opts.remote = true;
  if (opts.remote && opts.local) throw new Error("Choose only one of --remote or --local");
  return opts;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function bjtDateKey(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new Error(`Invalid generatedAt: ${iso}`);
  const d = new Date(t + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function reportId(kind, generatedAt) {
  const stamp = String(generatedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "").slice(0, 16);
  return `${kind}:${stamp}:${crypto.randomUUID().slice(0, 8)}`;
}

function sqlString(value) {
  if (value == null) return "''";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function safeJson(value, fallback) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch (_) {
    return JSON.stringify(fallback);
  }
}

function windowsCmdArg(value) {
  const s = String(value);
  if (!/[()\[\]{}^=;!'+,`~\s&|<>"]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function sampleCodexDailyReport() {
  const generatedAt = new Date().toISOString();
  const reportDate = bjtDateKey(generatedAt);
  const codexSourceRef = {
    type: "dev_import",
    id: "codex-dev-import",
    label: "Codex 连通性测试",
    source: "Codex",
    category: "Dev",
    url: "",
  };
  const costEstimate = {
    currency: "CNY",
    generator: "codex",
    devImport: true,
    searchQueries: 0,
    billableSearchUnits: 0,
    searchCostUsd: 0,
    searchCostCny: 0,
    totalCostUsd: 0,
    totalCostCny: 0,
    note: "Codex 手动测试导入，不计入 Gemini API 费用。",
  };
  const quality = {
    factCount: 6,
    sourceCoverage: 42,
    usedSearch: false,
    ingestRows: 0,
    caveat: "Codex 连通性测试记录，仅用于开发期验证 D1 写入、历史列表与前端展示；不代表事件一览 Worker prompt 的正式日报内容。",
  };
  return {
    kind: DAILY_EVENT_KIND,
    reportDate,
    slot: "Codex测试",
    triggerType: "codex_dev",
    generatedAt,
    status: "ready",
    sourceRefs: [
      codexSourceRef,
      { type: "route", label: "事件一览", href: "#/news", route: "news" },
      { type: "route", label: "舆情分析", href: "#/news-analysis", route: "news-analysis" },
    ],
    grounding: {
      devImport: true,
      generator: "codex",
      generatedBy: "Codex 连通性测试",
      factCount: quality.factCount,
      itemIdsSample: ["codex:dev:archive", "codex:dev:d1", "codex:dev:frontend"],
      ingest: {
        capturedAt: generatedAt,
        insertedRows: 0,
        attemptedItems: 0,
        candidateItems: 0,
        ingestErrors: [],
        source: "codex_dev_import",
      },
      quality,
      costEstimate,
    },
    marketSnapshot: {
      devImport: true,
      generator: "codex",
      capturedAt: generatedAt,
      sources: {
        codex: {
          ok: true,
          label: "Codex 连通性测试",
          updatedAt: generatedAt,
          note: "未调用 Gemini；未写入实时行情抓取结果。",
        },
      },
      realMarketData: {},
    },
    report: {
      title: "Codex 连通性测试 · 非日报样本",
      subtitle: "开发期 D1 导入链路验证，不代表 Worker prompt 产出",
      marketTemperature: {
        score: 50,
        label: "测试中性",
        regime: "开发验证",
        crossAsset: "未采集实时跨资产行情",
        anomaly: "无",
        suggestion: "仅用于验证记录链路，正式判断仍以 Worker/Gemini 生成记录或按 Worker prompt 手动整理的 JSON 为准。",
        summary: "这是一条 Codex 手动导入的 D1 连通性样例，用来确认写入、历史侧边栏和前端读取链路可以闭环；它不是事件一览日报内容。",
        assets: [
          {
            name: "Codex Dev Import",
            symbol: "CODEX",
            price: 0,
            changePct: 0,
            change3dPct: 0,
            change7dPct: 0,
            source: "codex_dev",
            ok: true,
          },
        ],
      },
      macroTrend: "开发阶段如果要验证事件一览页面链路，可以用 Codex 连通性样例确认 D1 读写；如果要生成日报内容，应另行准备符合 Worker prompt 的结构化 JSON 再导入。",
      topStory: {
        category: "开发验证",
        title: "Codex D1 连通性样例写入",
        occurredAt: reportDate,
        duration: "本轮测试",
        sourceName: "Codex",
        fact: "本记录由本地脚本写入 yuqing_reports，并在标题、slot、grounding 与来源中标记为 Codex 连通性测试；它不包含 Worker prompt 要求的新闻搜索与结构化分析。",
        structure: {
          trigger: "前端历史侧边栏已有 D1 记录，但开发期需要低成本生成更多样本。",
          conflict: "正式 Worker 链路会调用 Gemini；开发验证阶段不希望每次试 UI 和结构都产生 API 成本。",
          divergence: "Codex 连通性样例只用于验证展示结构，不能替代正式自动日报或按 Worker prompt 手动整理的日报。",
        },
        impacts: [
          { asset: "前端", logic: "刷新事件一览后应能在历史报告中看到 Codex 连通性测试记录。" },
          { asset: "D1", logic: "写入路径保持 yuqing_reports 表结构不变，不新增公网导入接口。" },
          { asset: "费用", logic: "本记录 searchCostCny 与 totalCostCny 均为 0，明确区别于 Gemini 任务。" },
        ],
        nextWatch: "确认记录在「全部 / 近30天 / 近七天」中可见，并检查主页面是否能打开该报告。",
      },
      topStories: [
        {
          category: "开发验证",
          title: "Codex D1 连通性样例写入",
          occurredAt: reportDate,
          duration: "本轮测试",
          sourceName: "Codex",
          fact: "本记录由本地脚本写入 yuqing_reports，并在标题、slot、grounding 与来源中标记为 Codex 连通性测试；它不包含 Worker prompt 要求的新闻搜索与结构化分析。",
          structure: {
            trigger: "前端历史侧边栏已有 D1 记录，但开发期需要低成本生成更多样本。",
            conflict: "正式 Worker 链路会调用 Gemini；开发验证阶段不希望每次试 UI 和结构都产生 API 成本。",
            divergence: "Codex 连通性样例只用于验证展示结构，不能替代正式自动日报或按 Worker prompt 手动整理的日报。",
          },
          impacts: [
            { asset: "前端", logic: "刷新事件一览后应能在历史报告中看到 Codex 连通性测试记录。" },
            { asset: "D1", logic: "写入路径保持 yuqing_reports 表结构不变，不新增公网导入接口。" },
            { asset: "费用", logic: "本记录 searchCostCny 与 totalCostCny 均为 0，明确区别于 Gemini 任务。" },
          ],
          nextWatch: "确认记录在「全部 / 近30天 / 近七天」中可见，并检查主页面是否能打开该报告。",
        },
      ],
      dynamicBriefs: [
        {
          category: "链路",
          time: "当前",
          title: "本地脚本直接导入远程 D1",
          body: "脚本按 Worker 的 yuqing_reports 字段写入，不改 Cloudflare Worker，也不新增线上管理接口。",
          analysis: "适合作为开发期低成本样本通道；后期删除脚本即可收口。",
          watch: "如果后续要让 Codex 写真实日报，应把同一结构保存为 JSON 后再导入。",
          sourceName: "Codex",
        },
        {
          category: "展示",
          time: "当前",
          title: "历史记录点名 Codex 连通性测试",
          body: "报告标题为 Codex 连通性测试 · 非日报样本，slot 为 Codex测试，费用估算为 0。",
          analysis: "用户在侧边栏记录中能直接区分 Codex dev 记录与 Gemini/Worker 正式记录。",
          watch: "正式记录仍保留原 Worker/Gemini 标记与费用估算。",
          sourceName: "Codex",
        },
      ],
      aiIntel: [
        {
          title: "Codex dev import：低成本验证报告结构",
          date: reportDate,
          rating: "开发测试",
          coreFact: "Codex 生成结构化 JSON，再由本地脚本写入 D1。",
          actionableValue: "可以在 prompt、卡片结构和历史列表逻辑未稳定前，减少 Gemini API 消耗。",
          applicationScenario: "手动触发、低频测试、前端联调、D1 字段兼容性检查。",
          sourceName: "Codex",
        },
      ],
      githubTools: [
        {
          title: "本地 D1 导入脚本",
          repo: "scripts/import-yuqing-report.cjs",
          target: "Bit Trading Desk",
          date: reportDate,
          whyUseful: "不暴露线上写入口，能把 Codex 生成的日报样本写入 yuqing_reports。",
          howToUse: "准备符合 Worker prompt 的 JSON 后执行脚本；内置 sample 只用于生成一条 Codex 连通性样例。",
          rating: "Dev-only",
          sourceName: "Local script",
          sourceUrl: "",
        },
      ],
      trendRead: {
        title: "总编辑收束",
        verdict: "本轮不是市场结论，而是一次 Codex dev 导入链路验证：重点看 D1 写入、历史侧边栏筛选和前端报告打开是否连通。",
        closingRead: [
          "正式 Worker/Gemini 链路保持不变；Codex 只作为开发期手动生成样本的低成本旁路。",
          "记录已经在 title、slot、grounding、sourceRefs 与 costEstimate 里标记为 Codex 连通性测试，方便和正式报告区分。",
        ],
        searchFindings: [
          {
            title: "费用归零",
            finding: "本记录未调用 Gemini，搜索和综合估算费用均写 0。",
            relation: "区别于正式 Gemini 任务",
            sourceName: "Codex",
            sourceUrl: "",
          },
        ],
        watchline: [
          {
            title: "刷新事件一览",
            why: "确认历史侧边栏出现 Codex 连通性测试记录，且可打开为主报告。",
            sourceHint: "事件一览 / 历史报告与费用",
          },
        ],
        uncertainty: "该记录不包含实时市场事实采集，不应作为交易判断输入。",
        methodology: {
          usesGoogleSearch: false,
          inputOnly: true,
          mode: "Codex dev import + D1 schema validation",
          promptVersion: "codex-dev-import-v1",
        },
      },
      sources: [
        {
          name: "Codex",
          type: "dev_import",
          reliability: "开发测试",
          count: 1,
          url: "",
        },
      ],
      quality,
      costEstimate,
    },
    sourceErrors: [
      {
        code: "codexDevImport",
        text: "Codex 连通性测试记录，仅用于开发期验证，不构成正式日报或投资建议。",
      },
    ],
  };
}

function readPayload(opts) {
  if (opts.sampleCodexDaily) return sampleCodexDailyReport();
  if (!opts.inputPath) throw new Error("Missing report.json path or --sample-codex-daily");
  const fullPath = path.resolve(process.cwd(), opts.inputPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function normalizePayload(input) {
  const generatedAt = String(input.generatedAt || new Date().toISOString());
  const kind = String(input.kind || DAILY_EVENT_KIND);
  if (kind !== DAILY_EVENT_KIND && kind !== "sentiment_analysis") {
    throw new Error(`Unsupported kind: ${kind}`);
  }
  const report = input.report && typeof input.report === "object" ? input.report : null;
  if (!report) throw new Error("Payload must include report object");
  const isCodexDev =
    input.triggerType === "codex_dev" ||
    (input.grounding && input.grounding.generator === "codex") ||
    /codex/i.test(String(report.title || ""));
  const costEstimate =
    input.costEstimate ||
    (input.grounding && input.grounding.costEstimate) ||
    report.costEstimate ||
    (isCodexDev
      ? {
          currency: "CNY",
          generator: "codex",
          devImport: true,
          searchQueries: 0,
          billableSearchUnits: 0,
          searchCostUsd: 0,
          searchCostCny: 0,
          totalCostUsd: 0,
          totalCostCny: 0,
        }
      : null);
  const grounding = {
    ...(input.grounding && typeof input.grounding === "object" ? input.grounding : {}),
  };
  if (costEstimate && !grounding.costEstimate) grounding.costEstimate = costEstimate;
  if (isCodexDev) {
    grounding.devImport = true;
    grounding.generator = "codex";
    grounding.generatedBy = grounding.generatedBy || "Codex 测试生成";
  }
  return {
    id: String(input.id || reportId(kind, generatedAt)),
    kind,
    reportDate: String(input.reportDate || bjtDateKey(generatedAt)),
    slot: String(input.slot || (isCodexDev ? "Codex测试" : "manual")),
    triggerType: String(input.triggerType || (isCodexDev ? "codex_dev" : "manual")),
    generatedAt,
    status: String(input.status || "ready"),
    sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs : [],
    grounding,
    marketSnapshot: input.marketSnapshot && typeof input.marketSnapshot === "object" ? input.marketSnapshot : {},
    report: {
      ...report,
      title: String(report.title || (isCodexDev ? "Codex 测试生成 · 事件日报" : "事件日报")),
      costEstimate: report.costEstimate || costEstimate || undefined,
    },
    sourceErrors: Array.isArray(input.sourceErrors) ? input.sourceErrors : [],
  };
}

function toSql(payload) {
  const values = [
    payload.id,
    payload.kind,
    payload.reportDate,
    payload.slot,
    payload.triggerType,
    payload.generatedAt,
    payload.status,
    safeJson(payload.sourceRefs, []),
    safeJson(payload.grounding, {}),
    safeJson(payload.marketSnapshot, {}),
    safeJson(payload.report, {}),
    safeJson(payload.sourceErrors, []),
  ].map(sqlString);
  return [
    "INSERT OR REPLACE INTO yuqing_reports",
    "(id, kind, report_date, slot, trigger_type, generated_at, status, source_refs_json, grounding_json, market_snapshot_json, report_json, source_errors_json)",
    `VALUES (${values.join(", ")});`,
  ].join("\n");
}

function runWrangler(sql, opts) {
  const tmp = path.join(os.tmpdir(), `yuqing-import-${Date.now()}-${process.pid}.sql`);
  fs.writeFileSync(tmp, sql, "utf8");
  try {
    const args = ["wrangler", "d1", "execute", opts.database, opts.remote ? "--remote" : "--local", "--file", tmp];
    const res =
      process.platform === "win32"
        ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["npx", ...args].map(windowsCmdArg).join(" ")], {
            cwd: process.cwd(),
            stdio: "inherit",
          })
        : spawnSync("npx", args, { cwd: process.cwd(), stdio: "inherit" });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`wrangler exited with status ${res.status}`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  const payload = normalizePayload(readPayload(opts));
  if (opts.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  runWrangler(toSql(payload), opts);
  console.log(`Imported ${payload.kind} report ${payload.id} into ${opts.database} (${opts.remote ? "remote" : "local"}).`);
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
}
