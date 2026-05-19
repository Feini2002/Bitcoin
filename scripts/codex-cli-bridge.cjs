#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ORIGIN = "https://yuqing.feiniwork.com";
const TASK_ENDPOINT = "/api/yuqing/codex/bridge-task";
const USER_AGENT = "bit-trading-desk-codex-cli-bridge/0.2";
const ALLOWED_KINDS = new Set(["daily_event", "sentiment_analysis"]);
const DEFAULT_ENV_FILE = ".codex-bridge.env";
const DEFAULT_RUN_DIR = ".codex-bridge";
const DEFAULT_SCHEMA_DIR = path.join("scripts", "codex-schemas");
const DEFAULT_PROMPT_FILE_LIMIT = 6000;
const DEFAULT_PROMPT_BUNDLE_LIMIT = 36000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const REQUIRED_REPORT_SECTIONS = {
  daily_event: ["title", "marketTemperature", "macroTrend", "topStories", "dynamicBriefs", "aiIntel", "githubTools", "trendRead", "sources", "quality"],
  sentiment_analysis: [
    "title",
    "upstreamDaily",
    "marketState",
    "riskRadar",
    "opportunityScanner",
    "eventCalendar",
    "aiIntel",
    "trendRead",
    "incrementalSearch",
    "settingsSnapshot",
    "quality",
  ],
};

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/codex-cli-bridge.cjs --once --origin=https://yuqing.feiniwork.com",
      "  node scripts/codex-cli-bridge.cjs --poll --interval-ms=2000",
      "  node scripts/codex-cli-bridge.cjs --dry-run --sample-kind=daily_event",
      "",
      "Options:",
      "  --origin=<url>           Worker origin, default from YUQING_BRIDGE_ORIGIN or https://yuqing.feiniwork.com",
      "  --token=<token>          Bearer token, default from YUQING_BRIDGE_TOKEN",
      "  --env-file=<path>        Local env file, default .codex-bridge.env when present",
      "  --workspace=<path>       Workspace passed to codex exec -C, default current directory",
      "  --codex-bin=<cmd>        Codex binary, default codex.cmd on Windows, codex elsewhere",
      "  --schema-dir=<path>      JSON schema directory, default scripts/codex-schemas",
      "  --prompt-file-limit=<n>  Max chars per local prompt/schema file, default 6000",
      "  --once                   Fetch at most one task and exit",
      "  --poll                   Keep polling the fixed bridge endpoint",
      "  --interval-ms=<ms>       Poll interval, default 2000",
      "  --timeout-ms=<ms>        codex exec timeout, default 900000",
      "  --dry-run                Print normalized task/result without running codex or posting back",
      "  --sample-kind=<kind>     Dry-run without Worker using daily_event or sentiment_analysis",
      "  --help, -h               Show help",
      "",
      `Fixed endpoint: ${TASK_ENDPOINT}`,
    ].join("\n"),
  );
}

function loadEnvFile(filePath) {
  const target = String(filePath || "").trim();
  if (!target || !fs.existsSync(target)) return false;
  const text = fs.readFileSync(target, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
  return true;
}

function preloadDefaultEnv(argv) {
  const explicit = argv.find((arg) => arg.startsWith("--env-file="));
  const file = explicit ? explicit.slice("--env-file=".length).trim() : path.join(process.cwd(), DEFAULT_ENV_FILE);
  loadEnvFile(file);
}

function parseArgs(argv) {
  preloadDefaultEnv(argv);
  const opts = {
    origin: process.env.YUQING_BRIDGE_ORIGIN || DEFAULT_ORIGIN,
    token: process.env.YUQING_BRIDGE_TOKEN || process.env.CODEX_BRIDGE_TOKEN || "",
    workspace: process.env.YUQING_BRIDGE_WORKSPACE || process.cwd(),
    codexBin: process.env.YUQING_CODEX_BIN || (process.platform === "win32" ? "codex.cmd" : "codex"),
    schemaDir: process.env.YUQING_CODEX_SCHEMA_DIR || DEFAULT_SCHEMA_DIR,
    promptFileLimit: Number.parseInt(process.env.YUQING_CODEX_PROMPT_FILE_LIMIT || "", 10) || DEFAULT_PROMPT_FILE_LIMIT,
    intervalMs: Number.parseInt(process.env.YUQING_BRIDGE_INTERVAL_MS || "", 10) || DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: 900000,
    dryRun: false,
    once: false,
    poll: false,
    sampleKind: "",
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--once") opts.once = true;
    else if (arg === "--poll") opts.poll = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--origin=")) opts.origin = arg.slice("--origin=".length).trim();
    else if (arg.startsWith("--token=")) opts.token = arg.slice("--token=".length).trim();
    else if (arg.startsWith("--env-file=")) opts.envFile = arg.slice("--env-file=".length).trim();
    else if (arg.startsWith("--workspace=")) opts.workspace = arg.slice("--workspace=".length).trim();
    else if (arg.startsWith("--codex-bin=")) opts.codexBin = arg.slice("--codex-bin=".length).trim();
    else if (arg.startsWith("--schema-dir=")) opts.schemaDir = arg.slice("--schema-dir=".length).trim();
    else if (arg.startsWith("--prompt-file-limit=")) opts.promptFileLimit = positiveInt(arg, "--prompt-file-limit=");
    else if (arg.startsWith("--interval-ms=")) opts.intervalMs = positiveInt(arg, "--interval-ms=");
    else if (arg.startsWith("--timeout-ms=")) opts.timeoutMs = positiveInt(arg, "--timeout-ms=");
    else if (arg.startsWith("--sample-kind=")) opts.sampleKind = arg.slice("--sample-kind=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.once && !opts.poll) opts.once = true;
  if (opts.once && opts.poll) throw new Error("Choose only one of --once or --poll");
  opts.origin = normalizeOrigin(opts.origin);
  opts.workspace = path.resolve(opts.workspace || process.cwd());
  opts.codexBin = String(opts.codexBin || "").trim() || (process.platform === "win32" ? "codex.cmd" : "codex");
  opts.schemaDir = path.resolve(opts.workspace, opts.schemaDir || DEFAULT_SCHEMA_DIR);
  opts.promptFileLimit = Math.min(12000, Math.max(1000, Number(opts.promptFileLimit) || DEFAULT_PROMPT_FILE_LIMIT));
  if (opts.sampleKind) assertAllowedKind(opts.sampleKind);
  if (!opts.dryRun && !opts.token) throw new Error(`Missing bridge token. Set YUQING_BRIDGE_TOKEN or create ${DEFAULT_ENV_FILE}.`);
  return opts;
}

function positiveInt(arg, prefix) {
  const n = Number.parseInt(arg.slice(prefix.length), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${prefix.slice(0, -1)} value`);
  return n;
}

function normalizeOrigin(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) throw new Error("Missing --origin");
  const u = new URL(s);
  if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
    throw new Error("Bridge origin must use https, localhost, or 127.0.0.1");
  }
  return u.origin;
}

function assertAllowedKind(kind) {
  if (!ALLOWED_KINDS.has(String(kind || ""))) {
    throw new Error(`Unsupported task kind: ${kind}`);
  }
}

function taskUrl(origin) {
  return `${origin}${TASK_ENDPOINT}`;
}

function requestHeaders(opts) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return headers;
}

function normalizeTask(raw) {
  const task = raw && raw.task && typeof raw.task === "object" ? raw.task : raw;
  if (!task || typeof task !== "object") throw new Error("Worker response did not include a task object");
  const kind = String(task.kind || "").trim();
  assertAllowedKind(kind);
  return {
    id: String(task.id || task.taskId || crypto.randomUUID()),
    kind,
    slot: String(task.slot || "manual"),
    requestedAt: String(task.requestedAt || task.createdAt || new Date().toISOString()),
    reportDate: task.reportDate ? String(task.reportDate) : "",
    context: safeRecord(task.context),
    requirements: Array.isArray(task.requirements) ? task.requirements.map(String).slice(0, 40) : [],
    sourceRefs: Array.isArray(task.sourceRefs) ? task.sourceRefs.slice(0, 40) : [],
  };
}

function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sampleTask(kind) {
  return normalizeTask({
    id: `dry-run:${kind}:${new Date().toISOString()}`,
    kind,
    slot: "manual",
    context: {
      note: "Dry-run sample; no Worker fetch, no codex exec, no callback.",
    },
    requirements: ["Return structured JSON only.", "Do not write D1 directly."],
  });
}

async function fetchTask(opts) {
  const res = await fetch(taskUrl(opts.origin), {
    method: "GET",
    headers: requestHeaders(opts),
  });
  const body = await readJson(res);
  if (res.status === 204 || (body && body.task == null && body.ok)) return null;
  if (!res.ok || (body && body.ok === false)) throw new Error(`Task fetch failed: ${formatWorkerError(body, res.status)}`);
  return normalizeTask(body);
}

async function postResult(opts, result) {
  const res = await fetch(taskUrl(opts.origin), {
    method: "POST",
    headers: requestHeaders(opts),
    body: JSON.stringify(result),
  });
  const body = await readJson(res);
  if (!res.ok || (body && body.ok === false)) throw new Error(`Result callback failed: ${formatWorkerError(body, res.status)}`);
  return body || { ok: true };
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return { ok: false, error: text.slice(0, 500) };
  }
}

function formatWorkerError(body, status) {
  if (body && body.error) return `${status} ${body.error}`;
  return String(status);
}

function buildPrompt(task) {
  const taskLabel = task.kind === "daily_event" ? "事件一览日报" : "舆情分析日报";
  const envelope = {
    task: {
      id: task.id,
      kind: task.kind,
      slot: task.slot,
      requestedAt: task.requestedAt,
      reportDate: task.reportDate || undefined,
    },
    context: task.context,
    sourceRefs: task.sourceRefs,
    requirements: task.requirements,
  };
  return [
    `你是 Bit Trading Desk 本地 Codex CLI bridge，正在处理 ${taskLabel} 任务。`,
    "严格只返回一个 JSON 对象；不要 Markdown；不要解释；不要直接写 D1。",
    "禁止执行部署、删除、git reset、schema 修改，也不要执行网页下发的任意 shell。",
    "你可以读取本仓库 prompt/schema 文件与任务 context，并按现有 Worker 报告结构生成中文报告。",
    "JSON 顶层必须包含 kind、status、generatedAt、reportDate、slot、report、grounding、sourceRefs、marketSnapshot、costEstimate、sourceErrors。",
    "kind 必须原样返回 daily_event 或 sentiment_analysis；status 用 ready 或 error。",
    "report 必须是对象；grounding 必须说明 generator=codex_cli_bridge、taskId、promptVersion，并在报告记录里能区分 Codex 与 Gemini。",
    "如果输入上下文不足，仍返回结构化 JSON，并在 sourceErrors 中说明缺口。",
    "",
    "本地脚本传入的任务信封如下：",
    JSON.stringify(envelope, null, 2),
  ].join("\n");
}

function workspaceFilePath(workspace, relPath) {
  const root = path.resolve(workspace);
  const clean = String(relPath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("\0")) return null;
  const target = path.resolve(root, clean);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { path: target, rel: clean };
}

function readPromptFileBundle(task, opts) {
  const context = task && task.context && typeof task.context === "object" ? task.context : {};
  const files = Array.isArray(context.promptFiles) ? context.promptFiles.slice(0, 12) : [];
  const bundle = [];
  let total = 0;
  for (const item of files) {
    const safe = workspaceFilePath(opts.workspace, item);
    const rel = safe ? safe.rel : String(item || "").trim();
    if (!safe) {
      bundle.push({ path: rel || "(empty)", error: "路径不在 workspace 内，已跳过" });
      continue;
    }
    if (total >= DEFAULT_PROMPT_BUNDLE_LIMIT) break;
    try {
      const stat = fs.statSync(safe.path);
      if (!stat.isFile()) {
        bundle.push({ path: rel, error: "不是文件，已跳过" });
        continue;
      }
      const text = fs.readFileSync(safe.path, "utf8");
      const budget = Math.max(0, Math.min(opts.promptFileLimit, DEFAULT_PROMPT_BUNDLE_LIMIT - total));
      if (!budget) break;
      const content = text.slice(0, budget);
      total += content.length;
      bundle.push({ path: rel, chars: text.length, truncated: text.length > content.length, content });
    } catch (err) {
      bundle.push({ path: rel, error: String(err && err.message ? err.message : err).slice(0, 240) });
    }
  }
  return bundle;
}

function schemaPathForTask(task, opts) {
  const kind = task && task.kind ? String(task.kind) : "";
  if (!ALLOWED_KINDS.has(kind)) return "";
  const file = path.join(opts.schemaDir, `${kind}.schema.json`);
  return fs.existsSync(file) ? file : "";
}

function buildPromptV2(task, opts) {
  const promptFiles = readPromptFileBundle(task, opts);
  const schemaFile = schemaPathForTask(task, opts);
  const localBundle = promptFiles
    .map((item) => {
      if (item.error) return `--- ${item.path} ---\n读取失败/跳过：${item.error}`;
      const suffix = item.truncated ? ", truncated" : "";
      return `--- ${item.path} (${item.chars} chars${suffix}) ---\n${item.content}`;
    })
    .join("\n\n");
  return [
    buildPrompt(task),
    "",
    "本地 bridge 已经预读 context.promptFiles 中的仓库文件，下面内容用于减少重复探索和保持 Worker/Gemini 报告结构一致。",
    schemaFile ? `输出 schema 文件：${path.relative(opts.workspace, schemaFile)}` : "输出 schema 文件：未找到，按任务信封要求生成。",
    "质量边界：不要为了提速删减核心事实、结构拆解、资产传导、判断、观察与后续关注；仅减少不必要的工具探索。",
    localBundle || "未读取到本地 prompt/schema 片段；请按任务信封和 requirements 生成。",
  ].join("\n");
}

function runCodexExec(prompt, opts, task) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.join(opts.workspace, DEFAULT_RUN_DIR), { recursive: true });
    const outputFile = path.join(opts.workspace, DEFAULT_RUN_DIR, `last-message-${crypto.randomUUID()}.json`);
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputFile,
      "-C",
      opts.workspace,
      "-",
    ];
    const child = spawn(opts.codexBin, args, {
      cwd: opts.workspace,
      shell: false,
      windowsHide: true,
      timeout: opts.timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, stdout, stderr, outputFile, error: err.message });
    });
    child.on("close", (code, signal) => {
      let lastMessage = "";
      try {
        lastMessage = fs.readFileSync(outputFile, "utf8");
      } catch (_) {}
      resolve({ ok: code === 0, exitCode: code, signal, stdout, stderr, outputFile, lastMessage });
    });
  });
}

function extractJson(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("codex exec returned empty stdout");
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }
  try {
    return JSON.parse(s);
  } catch (_) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("codex exec stdout did not contain JSON");
  }
}

function validateCodexPayloadShape(task, payload) {
  const missing = [];
  const topFields = ["kind", "status", "generatedAt", "reportDate", "slot", "report", "grounding", "sourceRefs", "marketSnapshot", "costEstimate", "sourceErrors"];
  for (const key of topFields) {
    if (!Object.prototype.hasOwnProperty.call(payload || {}, key)) missing.push(key);
  }
  if (payload && payload.kind !== task.kind) missing.push("kind");
  if (!payload || payload.status !== "ready" && payload.status !== "error") missing.push("status");
  if (!payload || !payload.report || typeof payload.report !== "object" || Array.isArray(payload.report)) missing.push("report");
  if (!payload || !payload.grounding || typeof payload.grounding !== "object" || Array.isArray(payload.grounding)) missing.push("grounding");
  if (!Array.isArray(payload && payload.sourceRefs)) missing.push("sourceRefs");
  if (!Array.isArray(payload && payload.sourceErrors)) missing.push("sourceErrors");
  const grounding = payload && payload.grounding && typeof payload.grounding === "object" ? payload.grounding : {};
  if (grounding.generator && grounding.generator !== "codex_cli_bridge") missing.push("grounding.generator");
  for (const section of REQUIRED_REPORT_SECTIONS[task.kind] || []) {
    if (!Object.prototype.hasOwnProperty.call((payload && payload.report) || {}, section)) missing.push(`report.${section}`);
  }
  if (missing.length) {
    throw new Error(`codex output missing required fields: ${Array.from(new Set(missing)).join(", ")}`);
  }
}

function normalizeCodexPayload(task, payload) {
  const generatedAt = String(payload.generatedAt || new Date().toISOString());
  const report = payload.report && typeof payload.report === "object" ? payload.report : {};
  const grounding = payload.grounding && typeof payload.grounding === "object" ? payload.grounding : {};
  const sourceRefs = Array.isArray(payload.sourceRefs) ? payload.sourceRefs : [];
  const marketSnapshot = payload.marketSnapshot && typeof payload.marketSnapshot === "object" ? payload.marketSnapshot : {};
  return {
    taskId: task.id,
    kind: task.kind,
    status: payload.status === "error" ? "error" : "ready",
    generatedAt,
    slot: task.slot,
    reportDate: String(payload.reportDate || task.reportDate || bjtDateKey(generatedAt)),
    report,
    grounding: {
      ...grounding,
      generator: "codex_cli_bridge",
      taskId: task.id,
      promptVersion: "codex-cli-bridge-v1",
      costEstimate:
        payload.costEstimate && typeof payload.costEstimate === "object"
          ? payload.costEstimate
          : grounding.costEstimate && typeof grounding.costEstimate === "object"
            ? grounding.costEstimate
            : {
                currency: "CNY",
                searchQueries: 0,
                searchCostCny: 0,
                totalCostCny: 0,
                note: "Codex CLI bridge local run; Gemini Worker API cost is not used.",
              },
    },
    sourceRefs,
    marketSnapshot,
    sourceErrors: Array.isArray(payload.sourceErrors) ? payload.sourceErrors : [],
  };
}

function bjtDateKey(iso) {
  const t = Date.parse(iso);
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function errorResult(task, err, extra = {}) {
  const generatedAt = new Date().toISOString();
  return {
    taskId: task.id,
    kind: task.kind,
    status: "error",
    generatedAt,
    slot: task.slot,
    reportDate: task.reportDate || bjtDateKey(generatedAt),
    report: {
      title: "Codex bridge task failed",
      summary: String(err && err.message ? err.message : err),
    },
    grounding: {
      generator: "codex_cli_bridge",
      taskId: task.id,
      promptVersion: "codex-cli-bridge-v1",
      ...extra,
    },
    sourceRefs: [],
    marketSnapshot: {},
    sourceErrors: [{ source: "codex_cli_bridge", message: String(err && err.message ? err.message : err) }],
  };
}

async function handleTask(task, opts) {
  const prompt = buildPromptV2(task, opts);
  if (opts.dryRun) {
    return {
      dryRun: true,
      endpoint: taskUrl(opts.origin),
      task,
      prompt,
      result: normalizeCodexPayload(task, {
        status: "ready",
        report: { title: "Dry-run Codex bridge result", taskKind: task.kind },
      }),
    };
  }
  const run = await runCodexExec(prompt, opts, task);
  if (!run.ok) {
    return errorResult(task, new Error(run.error || `codex exec exited with ${run.exitCode}`), {
      exitCode: run.exitCode,
      stderr: run.stderr.slice(0, 4000),
    });
  }
  try {
    const payload = extractJson(run.lastMessage || run.stdout);
    validateCodexPayloadShape(task, payload);
    return normalizeCodexPayload(task, payload);
  } catch (err) {
    return errorResult(task, err, {
      stdout: String(run.stdout || "").slice(0, 4000),
      lastMessage: String(run.lastMessage || "").slice(0, 4000),
      stderr: run.stderr.slice(0, 4000),
    });
  }
}

async function runOnce(opts) {
  const task = opts.sampleKind ? sampleTask(opts.sampleKind) : await fetchTask(opts);
  if (!task) {
    console.log(JSON.stringify({ ok: true, endpoint: taskUrl(opts.origin), task: null }, null, 2));
    return;
  }
  const result = await handleTask(task, opts);
  if (opts.dryRun) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const callback = await postResult(opts, result);
  console.log(JSON.stringify({ ok: true, taskId: task.id, callback }, null, 2));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (opts.poll) {
    for (;;) {
      try {
        await runOnce(opts);
      } catch (err) {
        console.error(err && err.message ? err.message : String(err));
      }
      await wait(opts.intervalMs);
    }
  }
  await runOnce(opts);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
