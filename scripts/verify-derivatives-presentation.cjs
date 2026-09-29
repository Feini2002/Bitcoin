const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium, expect } = require("playwright/test");

const ROOT = path.join(__dirname, "..");
const NOW = Date.UTC(2026, 8, 15, 12);
const OBSERVED = "2026-09-15T10:00:00.000Z";
const RECEIVED = "2026-09-15T11:30:00.000Z";
const OBSERVED_TEXT = "2026-09-15 18:00";
const RECEIVED_TEXT = "2026-09-15 19:30";
const FAILURE_TEXT = "2026-09-15 20:00";
let browser;
let server;

function fact(extra) {
  return {
    referencePeriod: OBSERVED,
    receivedAt: RECEIVED,
    collectionStale: false,
    sourceStale: false,
    unavailable: false,
    ...extra,
  };
}

function macroGroups() {
  return {
    dailyRates: {
      title: "日终利率（CMT / SOFR，非可成交）",
      cards: [{ id: "fred-dgs10", label: "10y CMT 日终", value: 4.2, referencePeriod: "2026-09-14", receivedAt: RECEIVED }],
    },
    weeklyDollarH41: { title: "周频美元与 H.4.1（禁止相减）", cards: [], residualForbidden: true },
    monthlyCpi: { title: "月频 CPI 指数", cards: [] },
    cryptoBackground: { title: "加密背景（非币安成交、非流入）", cards: [] },
    unofficialVol: { title: "非官方波动率（不上屏除非 desk 标明 unofficial）", cards: [], planned: true },
  };
}

function positioning(flags) {
  const mark = flags || {};
  const stale = (key) => ({
    sourceStale: mark.source === true || mark.source === key,
    collectionStale: mark.collection === true || mark.collection === key,
  });
  return {
    oi: fact({ ...stale("oi"), value: 90000, values: { openInterest: 90000 }, ...(mark.missingOi ? { unavailable: true, value: null, values: {} } : {}) }),
    oiHistory: fact({ ...stale("oiHistory"), period: "1h", values: { sumOpenInterest: 88000, sumOpenInterestValue: 5200000 } }),
    taker: fact({ ...stale("taker"), period: "1h", values: { buyVol: 12.5, sellVol: 8.25 } }),
    accounts: fact({ ...stale("accounts"), period: "1h", sample: "all-accounts", values: { longShortRatio: 1.08 } }),
    topPositions: fact({ ...stale("topPositions"), period: "1h", sample: "top-positions", values: { longShortRatio: 0.97 } }),
  };
}

function contextDesk(kind) {
  const base = {
    schemaVersion: "2026-09-21.1",
    asOf: RECEIVED,
    asKnownMode: "system_observed",
    scope: "context",
    groups: macroGroups(),
  };
  if (kind === "no-positioning") {
    const desk = contextDesk("normal");
    delete desk.contract.positioning;
    return desk;
  }
  if (kind === "wb07") {
    return {
      ...base,
      contract: {
        unavailable: false,
        partial: true,
        premium: fact({ values: { markPrice: 64250, lastFundingRate: 0.0001 } }),
        funding: fact({
          sourceStale: true,
          values: { fundingRate: 0.00012 },
          fundingIntervalHours: 8,
          intervalBasis: "unknown",
        }),
        basis: fact({ collectionStale: true, values: { basis: 12.5, basisRate: 0.001, annualizedBasisRate: 0.11 } }),
        positioning: positioning({ source: "topPositions" }),
      },
    };
  }
  const allSource = kind === "source";
  const allCollection = kind === "collection";
  const missingFunding = kind === "partial";
  const missingOi = kind === "partial";
  return {
    ...base,
    contract: {
      unavailable: false,
      partial: kind !== "normal",
      premium: fact({ sourceStale: allSource, collectionStale: allCollection, values: { markPrice: 64250, lastFundingRate: 0.0001 } }),
      funding: fact({
        sourceStale: allSource,
        collectionStale: allCollection,
        unavailable: missingFunding,
        values: missingFunding ? {} : { fundingRate: 0.00012 },
        fundingIntervalHours: missingFunding ? null : 4,
        intervalBasis: missingFunding ? "unknown" : "exchange-funding-info",
      }),
      basis: fact({
        sourceStale: allSource,
        collectionStale: allCollection,
        values: { basis: 12.5, basisRate: 0.001, annualizedBasisRate: 0.11 },
      }),
      positioning: positioning({ source: allSource, collection: allCollection, missingOi: missingOi }),
    },
  };
}

function heatDesk(binanceNotional, bybitNotional) {
  const exchange = (name, notional) => ({
    exchange: name,
    longNotional: notional,
    shortNotional: 0,
    buckets: [{ exchange: name, bucket_start: NOW - 300000, long_notional: notional, short_notional: 0, long_count: 1, short_count: 0 }],
  });
  const byExchange = { binance: exchange("binance", binanceNotional) };
  if (bybitNotional != null) byExchange.bybit = exchange("bybit", bybitNotional);
  return {
    schemaVersion: "2026-09-21.1",
    asKnownMode: "system_observed",
    scope: "heatmap",
    combinedTotalsForbidden: true,
    byExchange,
  };
}

function footprintBar(t, buy, sell) {
  return {
    t,
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    buyVol: buy,
    sellVol: sell,
    delta: buy - sell,
    volume: buy + sell,
    levels: [{ price: 100, buyVol: buy, sellVol: sell }],
  };
}

function orderflowDesk(bars) {
  const t0 = Date.UTC(2026, 8, 15, 4, 0, 0);
  return {
    schemaVersion: "2026-09-21.1",
    asOf: RECEIVED,
    asKnownMode: "system_observed",
    scope: "orderflow",
    instrumentId: "BINANCE:USDM:BTCUSDT:PERPETUAL",
    venue: "binance-usdm",
    sourceInterval: "5m",
    quality: { status: "pass" },
    observedAt: new Date(t0).toISOString(),
    receivedAt: RECEIVED,
    gap: null,
    tradingNarrative: false,
    series: bars,
  };
}

function incompleteSeries() {
  const t0 = Date.UTC(2026, 8, 15, 4, 0, 0);
  return [footprintBar(t0, 1.25, 0.4), footprintBar(t0 + 5 * 60 * 1000, 0.25, 0.1)];
}

async function main() {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const file = path.resolve(ROOT, "." + (rel === "/" ? "/index.html" : rel));
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" }[path.extname(file)] || "text/plain";
      res.setHeader("Content-Type", type);
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.BITDESK_TEST_BROWSER ? { channel: process.env.BITDESK_TEST_BROWSER } : {}) });
  console.log(JSON.stringify({ pid: process.pid, origin, browser: browser.version(), deadline: "external run-bounded watchdog" }));

  await runDerivatives(origin);
  await runHeatmap(origin);
  await runOrderflow(origin);
  console.log("PASS verify-derivatives-presentation");
}

async function openPage(origin, prepare) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(8000);
  const state = { mode: "normal", counts: { context: 0, heatmap: 0, orderflow: 0 }, held: [] };
  if (prepare) await prepare(context, state);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.pathname === "/api/desk/context") {
      state.counts.context += 1;
      if (state.mode === "fail") {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture service paused" }) });
      }
      if (state.mode === "hold") {
        state.held.push({ kind: "context", route });
        return;
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(contextDesk(state.mode)) });
    }
    if (url.pathname === "/api/desk/heatmap") {
      state.counts.heatmap += 1;
      const range = url.searchParams.get("range") || "24h";
      state.lastHeatmapRange = range;
      if (state.mode === "heat-hold") {
        state.held.push({ kind: "heatmap", range, route });
        return;
      }
      if (state.mode === "heat-binance") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(heatDesk(222000, null)) });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(heatDesk(111000, 1000)) });
    }
    if (url.pathname === "/api/desk/orderflow") {
      state.counts.orderflow += 1;
      const display = url.searchParams.get("displayInterval") || "15m";
      state.lastOrderflow = url.pathname + url.search;
      if (state.mode === "order-fail") {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture service paused" }) });
      }
      if (state.mode === "order-hold") {
        state.held.push({ kind: "orderflow", display, route });
        return;
      }
      const bars = state.mode === "order-incomplete" ? incompleteSeries() : [footprintBar(Date.UTC(2026, 8, 15, 4, 0, 0), 1.11, 0.2)];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(orderflowDesk(bars)) });
    }
    return route.fulfill({
      status: 200,
      contentType: route.request().resourceType() === "script" ? "text/javascript" : "application/json",
      body: route.request().resourceType() === "script" ? "" : "{}",
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: NOW });
  return { context, page, state, errors, origin };
}

async function show(session, hash) {
  await session.page.goto(session.origin + "/#" + hash);
  await session.page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
}

async function runDerivatives(origin) {
  const session = await openPage(origin);
  const { page, state, errors } = session;
  state.mode = "normal";
  await show(session, "/derivatives");
  await expect(page.locator("#deriv-status")).toContainText("desk context 已返回");
  await expect(page.locator("#deriv-status")).toContainText("正常");
  await assertContract(page, "正常");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("4 小时");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("exchange-funding-info");
  await expect(page.locator("#deriv-freq-groups")).toContainText("PLANNED");
  await expect(page.locator("#deriv-freq-groups")).toContainText("日终利率");
  await expect(page.locator("#deriv-freq-groups")).toContainText("月频 CPI");
  await expect(page.locator("#deriv-research-evidence")).toContainText("不套用行情主图周期");
  console.log("PASS WB-06 normal");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-workbench-export]").click(),
  ]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  const premium = exported.pages.derivatives.cards.find((card) => card.id === "premium");
  if (!premium || premium.values.markPrice !== 64250) throw new Error("WB-13 download missed displayed mark price");
  if (exported.pages.chart.access !== "not_visited") throw new Error("WB-14 export requested an unvisited page");
  if (exported.atomicSnapshot !== false) throw new Error("WB-13 export claimed an atomic snapshot");
  const macro = exported.pages.derivatives.cards.find((card) => card.id === "fred-dgs10");
  if (!macro || macro.value !== 4.2) throw new Error("WB-13 download missed displayed macro value");
  console.log("PASS WB-13 derivatives download matches the displayed cards");
  await page.setViewportSize({ width: 390, height: 800 });
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (narrow > 1) throw new Error("WB-12 derivatives horizontal overflow " + narrow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS WB-12 derivatives 390 width");

  state.mode = "partial";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator("#deriv-status")).toContainText("部分缺失");
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("64250 USDT/BTC");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("部分缺失");
  await expect(page.locator('[data-deriv-card="oi"]')).toContainText("部分缺失");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("12.5 BTC");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("8.25 BTC");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("周期：1h");
  await expect(page.locator('[data-deriv-card="accounts"]')).toContainText("all-accounts");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("top-positions");
  await expect(page.locator('[data-deriv-card="oiHistory"]')).toContainText("88000 BTC");
  await expect(page.locator('[data-deriv-card="oiHistory"]')).toContainText("5200000 USDT");
  console.log("PASS WB-06 partial");

  state.mode = "source";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator("#deriv-status")).toContainText("源陈旧");
  await assertContract(page, "源陈旧");
  await expect(page.locator('[data-deriv-card="premium"]')).not.toContainText("实时");
  await expect(page.locator('[data-deriv-card="premium"]')).not.toContainText("采集陈旧");
  await expect(page.locator("#deriv-live-chip")).not.toHaveText("实时");
  console.log("PASS WB-06 source stale");

  state.mode = "collection";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator("#deriv-status")).toContainText("采集陈旧");
  await assertContract(page, "采集陈旧");
  await expect(page.locator('[data-deriv-card="premium"]')).not.toContainText("实时");
  await expect(page.locator('[data-deriv-card="funding"]')).not.toContainText("源陈旧");
  console.log("PASS WB-06 collection stale");

  state.mode = "no-positioning";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("64250 USDT/BTC");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("0.00012 decimal-per-settlement");
  await expect(page.locator('[data-deriv-card="basis"]')).toContainText("12.5 USDT/BTC");
  await expect(page.locator('[data-deriv-card="oi"]')).toContainText("部分缺失");
  await expect(page.locator("#deriv-status")).toContainText("desk context 已返回");
  await expect(page.locator("#deriv-freq-groups")).toContainText("PLANNED");
  console.log("PASS positioning absence keeps premium funding and basis");

  state.mode = "wb07";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("64250 USDT/BTC");
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("正常");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("结算周期：未知");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("0.00012");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("源陈旧");
  await expect(page.locator('[data-deriv-card="funding"]')).not.toContainText("8 小时");
  await expect(page.locator('[data-deriv-card="basis"]')).toContainText("12.5 USDT/BTC");
  await expect(page.locator('[data-deriv-card="basis"]')).toContainText("采集陈旧");
  await expect(page.locator('[data-deriv-card="oi"]')).toContainText("90000 BTC");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("0.97");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("源陈旧");
  await expect(page.locator("#deriv-status")).toContainText("desk context 已返回");
  console.log("PASS WB-07 stale card keeps the others");

  state.mode = "fail";
  await page.locator("#deriv-refresh").click();
  await expect(page.locator("#deriv-status")).toContainText("读取失败");
  await expect(page.locator("#deriv-status")).toContainText("失败时间 " + FAILURE_TEXT);
  await expect(page.locator("#deriv-status")).toContainText("陈旧");
  await expect(page.locator("#deriv-read-failure")).toContainText("上一次成功展示");
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("64250 USDT/BTC");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("未知");
  await expect(page.locator("#deriv-freq-groups")).toContainText("PLANNED");
  await expect(page.locator("#outlet")).not.toContainText("未实现");
  await expect(page.locator("#deriv-status")).not.toContainText("功能未实现");
  console.log("PASS WB-06 request failure keeps the last desk");

  const seen = state.counts.context;
  await page.evaluate(() => {
    window.__testHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__testHidden });
  });
  state.mode = "wb07";
  await page.evaluate(() => {
    window.__testHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(31000);
  if (state.counts.context !== seen) throw new Error("hidden derivatives page sent " + (state.counts.context - seen) + " requests");
  await page.evaluate(() => {
    window.__testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.counts.context).toBe(seen + 1);
  console.log("PASS WB-11 derivatives hidden pauses requests");

  const left = state.counts.context;
  await page.evaluate(() => { location.hash = "#/archive"; });
  await expect(page.getByRole("heading", { name: "发言历史库", exact: true })).toBeVisible();
  await page.clock.runFor(20000);
  if (state.counts.context !== left) throw new Error("left derivatives page kept polling");
  console.log("PASS WB-10 derivatives leave stops requests");

  state.mode = "hold";
  state.held.length = 0;
  await page.evaluate(() => { location.hash = "#/derivatives"; });
  await expect.poll(() => state.held.filter((row) => row.kind === "context").length).toBe(1);
  const late = state.held[0];
  state.mode = "normal";
  await page.evaluate(() => { location.hash = "#/overview"; });
  await page.evaluate(() => { location.hash = "#/derivatives"; });
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("4 小时");
  await late.route.fulfill({ contentType: "application/json", body: JSON.stringify(contextDesk("wb07")) }).catch(() => {});
  await expect(page.locator('[data-deriv-card="premium"]')).toContainText("64250 USDT/BTC");
  await expect(page.locator('[data-deriv-card="funding"]')).toContainText("4 小时");
  await expect(page.locator('[data-deriv-card="funding"]')).not.toContainText("未知");
  console.log("PASS WB-10 late derivatives response does not replace the new visit");
  if (errors.length) throw new Error(errors.join("; "));
  await session.context.close();
}

async function assertContract(page, statusText) {
  const premium = page.locator('[data-deriv-card="premium"]');
  await expect(premium).toContainText("64250 USDT/BTC");
  await expect(premium).toContainText("0.0001 decimal");
  await expect(premium).toContainText("观察时间：" + OBSERVED_TEXT);
  await expect(premium).toContainText("接收时间：" + RECEIVED_TEXT);
  await expect(premium).toContainText(statusText);
  const funding = page.locator('[data-deriv-card="funding"]');
  await expect(funding).toContainText("0.00012 decimal-per-settlement");
  await expect(funding).toContainText(statusText);
  const basis = page.locator('[data-deriv-card="basis"]');
  await expect(basis).toContainText("12.5 USDT/BTC");
  await expect(basis).toContainText("0.001 decimal");
  await expect(basis).toContainText("0.11 decimal-per-year");
  await expect(basis).toContainText(statusText);
  await expect(page.locator('[data-deriv-card="oi"]')).toContainText("90000 BTC");
  await expect(page.locator('[data-deriv-card="oiHistory"]')).toContainText("88000 BTC");
  await expect(page.locator('[data-deriv-card="oiHistory"]')).toContainText("5200000 USDT");
  await expect(page.locator('[data-deriv-card="oiHistory"]')).toContainText("周期：1h");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("12.5 BTC");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("8.25 BTC");
  await expect(page.locator('[data-deriv-card="taker"]')).toContainText("周期：1h");
  await expect(page.locator('[data-deriv-card="accounts"]')).toContainText("1.08 ratio");
  await expect(page.locator('[data-deriv-card="accounts"]')).toContainText("all-accounts");
  await expect(page.locator('[data-deriv-card="accounts"]')).toContainText("周期：1h");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("0.97 ratio");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("top-positions");
  await expect(page.locator('[data-deriv-card="topPositions"]')).toContainText("周期：1h");
  for (const key of ["oi", "oiHistory", "taker", "accounts", "topPositions"]) {
    await expect(page.locator(`[data-deriv-card="${key}"]`)).toContainText(statusText);
    await expect(page.locator(`[data-deriv-card="${key}"]`)).toContainText(OBSERVED_TEXT);
  }
}

async function runHeatmap(origin) {
  const session = await openPage(origin);
  const { page, state, errors } = session;
  state.mode = "heat-binance";
  await show(session, "/heatmap");
  await expect(page.locator("#hm-status")).toContainText("desk 分所");
  await expect(page.locator("#hm-kpi-binance")).toContainText("$222.0K");
  await expect(page.locator("#hm-kpi-bybit")).toHaveText("未覆盖");
  await expect(page.locator("#hm-research-evidence")).toContainText("Bybit 未覆盖");
  await expect(page.locator("#hm-research-evidence")).toContainText("不把币安与 Bybit 合并成完整覆盖");
  await expect(page.locator("#hm-research-evidence")).toContainText("不跟随行情主图周期");
  await expect(page.locator("#hm-research-evidence")).toContainText("宏观日频");
  await expect(page.locator("#hm-status")).toContainText("范围 24h");
  await page.setViewportSize({ width: 390, height: 800 });
  const heatmapNarrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (heatmapNarrow > 1) throw new Error("WB-12 heatmap horizontal overflow " + heatmapNarrow);
  const clippedVenue = await page.locator(".heatmap-venue-block").evaluateAll(elements => elements.some(el => el.getBoundingClientRect().right > innerWidth + 1));
  if (clippedVenue) throw new Error("liquidation venue summary is clipped on mobile");
  const tableScroll = page.locator(".heatmap-venue-block .rd-table-scroll").first();
  await tableScroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  if (await tableScroll.evaluate(el => el.scrollLeft <= 0)) throw new Error("mobile liquidation table cannot scroll to its last column");
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS WB-12 heatmap 390 width");
  console.log("PASS WB-08 liquidation stays split by venue");

  await page.locator("#hm-window").selectOption("7d");
  await expect.poll(() => state.lastHeatmapRange).toBe("7d");
  await expect(page.locator("#hm-status")).toContainText("范围 7d");
  await page.locator("#hm-min-notional").fill("300000");
  await expect(page.locator(".heatmap-venue-block tbody")).toContainText("没有匹配");
  await expect(page.locator("#hm-kpi-binance")).toContainText("$222.0K");
  const [filteredDownload] = await Promise.all([page.waitForEvent("download"), page.locator("[data-workbench-export]").click()]);
  const filteredEvidence = JSON.parse(fs.readFileSync(await filteredDownload.path(), "utf8")).pages.heatmap;
  if (filteredEvidence.parameters.range !== "7d" || filteredEvidence.parameters.minimumBucketNotional !== 300000
    || filteredEvidence.buckets.find(row => row.exchange === "binance").displayedBuckets.length !== 0) throw new Error("filtered liquidation export differs from displayed rows");
  await page.locator("#hm-min-notional").fill("0");
  await expect(page.locator(".heatmap-venue-block tbody")).toContainText("$222.0K");
  await page.locator("#hm-window").selectOption("24h");
  await expect(page.locator("#hm-status")).toContainText("范围 24h");
  console.log("PASS research liquidation 7d query, minimum filter, unchanged totals and filtered export");

  await page.evaluate(() => {
    window.__testHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__testHidden });
  });
  const seen = state.counts.heatmap;
  await page.evaluate(() => {
    window.__testHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(12000);
  if (state.counts.heatmap !== seen) throw new Error("hidden heatmap kept requesting");
  await page.evaluate(() => {
    window.__testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.counts.heatmap).toBe(seen + 1);
  console.log("PASS WB-11 heatmap hidden pauses requests");

  const left = state.counts.heatmap;
  await page.evaluate(() => { location.hash = "#/archive"; });
  await expect(page.getByRole("heading", { name: "发言历史库", exact: true })).toBeVisible();
  await page.clock.runFor(12000);
  if (state.counts.heatmap !== left) throw new Error("left heatmap kept requesting");
  console.log("PASS WB-10 heatmap leave stops requests");

  state.mode = "heat-hold";
  state.held.length = 0;
  await page.evaluate(() => { location.hash = "#/heatmap"; });
  await expect.poll(() => state.held.some((row) => row.kind === "heatmap" && row.range === "24h")).toBe(true);
  await page.locator("#hm-window").selectOption("all");
  await expect.poll(() => state.held.some((row) => row.kind === "heatmap" && row.range === "30d")).toBe(true);
  const late = state.held.find((row) => row.range === "24h");
  const next = state.held.find((row) => row.range === "30d");
  await late.route.fulfill({ contentType: "application/json", body: JSON.stringify(heatDesk(888888, 1000)) }).catch(() => {});
  await next.route.fulfill({ contentType: "application/json", body: JSON.stringify(heatDesk(222000, 1000)) });
  await expect(page.locator("#hm-status")).toContainText("范围 30d");
  await expect(page.locator("#hm-kpi-binance")).toContainText("$222.0K");
  await expect(page.locator("#outlet")).not.toContainText("$888.9K");
  console.log("PASS WB-10 late liquidation range does not replace the new window");
  const [heatDownload] = await Promise.all([page.waitForEvent("download"), page.locator("[data-workbench-export]").click()]);
  const heatEvidence = JSON.parse(fs.readFileSync(await heatDownload.path(), "utf8")).pages.heatmap;
  const binance = heatEvidence.buckets.find((row) => row.exchange === "binance");
  if (!binance || binance.longNotional + binance.shortNotional !== 222000
    || heatEvidence.parameters.range !== "30d" || heatEvidence.combinedTotalsForbidden !== true) throw new Error("WB-13 liquidation download disagrees with displayed range or exchange");
  console.log("PASS WB-13 liquidation displayed range download");
  if (errors.length) throw new Error(errors.join("; "));
  await session.context.close();
}

async function runOrderflow(origin) {
  const session = await openPage(origin, async (context) => {
    await context.addInitScript(() => {
      localStorage.removeItem("bitdesk.orderflow.settings");
      localStorage.removeItem("bitdesk.heatmap.settings");
      localStorage.setItem("bitdesk.orderflow.footprint.BTCUSDT.15m.auto", JSON.stringify({
        symbol: "BTCUSDT",
        interval: "15m",
        tickSize: "auto",
        bars: [{ t: Date.UTC(2026, 8, 15, 4, 0, 0), close: 77777.25, buyVol: 3.21, sellVol: 1, levels: [{ price: 77777.25, buyVol: 3.21, sellVol: 1 }] }],
      }));
    });
  });
  const { page, state, errors } = session;
  state.mode = "order-fail";
  await show(session, "/orderflow");
  await expect(page.locator("#of-status")).toContainText("断流后未回用无来源标记缓存");
  await expect(page.locator("#outlet")).not.toContainText("77777.25");
  await expect(page.locator(".orderflow-desk")).toHaveClass(/halted/);
  await page.locator('.of-tf-btn[data-of-tf="4h"]').click();
  await expect(page.locator('.of-tf-btn[data-of-tf="4h"]')).toHaveClass(/primary/);
  await page.locator('.of-tf-btn[data-of-tf="15m"]').click();
  await expect(page.locator('.of-tf-btn[data-of-tf="15m"]')).toHaveClass(/primary/);
  console.log("PASS WB-08 broken footprint ignores unmarked cache and the period control stays usable");

  state.mode = "order-incomplete";
  await page.evaluate(() => { location.hash = "#/archive"; });
  await expect(page.getByRole("heading", { name: "发言历史库", exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = "#/orderflow"; });
  await expect(page.locator("#of-status")).toContainText("不完整");
  await expect(page.locator("#of-status")).toContainText("组成 2/3");
  await expect(page.locator("#of-research-evidence")).toContainText("来源周期 5m");
  await expect(page.locator("#of-research-evidence")).toContainText("显示周期 15m");
  await expect(page.locator("#of-research-evidence")).toContainText("aggTrade 主动量近似");
  await expect(page.locator("#of-research-evidence")).toContainText("BINANCE:USDM:BTCUSDT:PERPETUAL");
  await expect(page.locator("#of-research-evidence")).toContainText("显示聚合周期 15m");
  await expect(page.locator("#of-side-source")).toHaveText("5m");
  await expect(page.locator("#of-side-interval")).toHaveText("15m");
  await expect(page.locator("#of-kpi-buy")).toHaveText("1.50");
  const [orderDownload] = await Promise.all([page.waitForEvent("download"), page.locator("[data-workbench-export]").click()]);
  const orderEvidence = JSON.parse(fs.readFileSync(await orderDownload.path(), "utf8")).pages.orderflow;
  if (orderEvidence.parameters.displayInterval !== "15m" || !orderEvidence.aggregationIncomplete
    || orderEvidence.bars.at(-1).buyVol !== 1.5) throw new Error("WB-13 footprint download disagrees with incomplete displayed bar");
  console.log("PASS WB-13 footprint displayed aggregation download");
  await page.setViewportSize({ width: 390, height: 800 });
  const orderflowNarrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (orderflowNarrow > 1) throw new Error("WB-12 orderflow horizontal overflow " + orderflowNarrow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("PASS WB-12 orderflow 390 width");
  console.log("PASS WB-08 incomplete footprint aggregation");

  await page.evaluate(() => {
    window.__testHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__testHidden });
  });
  const seen = state.counts.orderflow;
  await page.evaluate(() => {
    window.__testHidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(12000);
  if (state.counts.orderflow !== seen) throw new Error("hidden orderflow kept requesting");
  await page.evaluate(() => {
    window.__testHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => state.counts.orderflow).toBe(seen + 1);
  console.log("PASS WB-11 orderflow hidden pauses requests");

  const left = state.counts.orderflow;
  await page.evaluate(() => { location.hash = "#/archive"; });
  await expect(page.getByRole("heading", { name: "发言历史库", exact: true })).toBeVisible();
  await page.clock.runFor(12000);
  if (state.counts.orderflow !== left) throw new Error("left orderflow kept requesting");
  console.log("PASS WB-10 orderflow leave stops requests");

  state.mode = "order-hold";
  const beforeHold = state.counts.orderflow;
  state.held.length = 0;
  state.lastOrderflow = "";
  await page.evaluate(() => { location.hash = "#/orderflow"; });
  const holdDeadline = Date.now() + 4000;
  while (Date.now() < holdDeadline && !state.held.some((row) => row.display === "15m")) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!state.held.some((row) => row.display === "15m")) {
    const diag = await page.evaluate(() => ({ hash: location.hash, hidden: document.hidden, text: document.body.innerText.slice(0, 400) }));
    throw new Error(`no 15m hold delta=${state.counts.orderflow - beforeHold} held=${state.held.map((row) => row.display).join("|")} last=${state.lastOrderflow} ${JSON.stringify(diag)}`);
  }
  await page.evaluate(() => document.querySelector('.of-tf-btn[data-of-tf="4h"]').click());
  const nextDeadline = Date.now() + 4000;
  while (Date.now() < nextDeadline && !state.held.some((row) => row.display === "4h")) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!state.held.some((row) => row.display === "4h")) {
    const diag = await page.evaluate(() => ({
      interval: document.querySelector("#of-side-interval") && document.querySelector("#of-side-interval").textContent,
      status: document.querySelector("#of-status") && document.querySelector("#of-status").textContent,
    }));
    throw new Error(`no 4h hold held=${state.held.map((row) => row.display).join("|")} last=${state.lastOrderflow} ${JSON.stringify(diag)}`);
  }
  const late = state.held.find((row) => row.display === "15m");
  const next = state.held.find((row) => row.display === "4h");
  const t0 = Date.UTC(2026, 8, 15, 4, 0, 0);
  await late.route.fulfill({ contentType: "application/json", body: JSON.stringify(orderflowDesk([footprintBar(t0, 9.99, 0.1)])) }).catch(() => {});
  await next.route.fulfill({ contentType: "application/json", body: JSON.stringify(orderflowDesk([footprintBar(t0, 2.5, 0.2)])) });
  await expect(page.locator("#of-side-interval")).toHaveText("4h");
  await expect(page.locator("#of-research-evidence")).toContainText("显示聚合周期 4h");
  await expect(page.locator("#of-kpi-buy")).toHaveText("2.50");
  await expect(page.locator("#outlet")).not.toContainText("9.99");
  console.log("PASS WB-11 late footprint interval does not replace the new period");
  if (errors.length) throw new Error(errors.join("; "));
  await session.context.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
