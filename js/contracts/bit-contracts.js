/**
 * Batch2 本地主线：产品身份、质量、窗口、方法与来源用途。
 * 纯函数；now/cutoff 必须由调用方传入。浏览器与 Node 共用。
 */
(function bitContractsModule(globalTarget) {
  "use strict";

  var SCHEMA_VERSION = "market-observation.v1";
  var METHOD_VERSION = "2026-09-17.batch2";
  var PRIMARY_INSTRUMENT = {
    venue: "BINANCE",
    market: "USDM",
    symbol: "BTCUSDT",
    contractType: "PERPETUAL",
    id: "BINANCE:USDM:BTCUSDT:PERPETUAL",
  };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "" || value === ".") return null;
    if (typeof value === "boolean") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function missingVsZero(value) {
    if (value === null || value === undefined || value === "") {
      return { kind: "missing", value: null };
    }
    var n = toNumber(value);
    if (n === null) return { kind: "invalid", value: null };
    if (n === 0) return { kind: "zero", value: 0 };
    return { kind: "present", value: n };
  }

  function instrumentId(parts) {
    var venue = String((parts && parts.venue) || "").toUpperCase();
    var market = String((parts && parts.market) || "").toUpperCase();
    var symbol = String((parts && parts.symbol) || "").toUpperCase();
    var contractType = String((parts && parts.contractType) || "").toUpperCase();
    if (!venue || !market || !symbol || !contractType) return null;
    return venue + ":" + market + ":" + symbol + ":" + contractType;
  }

  function parseInstrumentId(id) {
    var parts = String(id || "").split(":");
    if (parts.length !== 4) return null;
    return { venue: parts[0], market: parts[1], symbol: parts[2], contractType: parts[3], id: parts.join(":") };
  }

  function productMatch(expected, actual) {
    var exp = typeof expected === "string" ? parseInstrumentId(expected) : expected;
    var act = typeof actual === "string" ? parseInstrumentId(actual) : actual;
    if (!exp || !act) {
      return { ok: false, reason: "product_identity_unknown" };
    }
    if (exp.symbol === act.symbol && exp.contractType !== act.contractType) {
      return { ok: false, reason: "product_mismatch", expected: exp, actual: act };
    }
    if (exp.venue !== act.venue || exp.market !== act.market || exp.symbol !== act.symbol || exp.contractType !== act.contractType) {
      return { ok: false, reason: "product_mismatch", expected: exp, actual: act };
    }
    return { ok: true, expected: exp, actual: act };
  }

  function classifyLegacySource(row) {
    if (!row || row.venue == null || row.venue === "" || row.source == null) {
      return {
        status: "legacy_unknown",
        researchUse: "restricted",
        reason: "legacy_source_unknown",
        claimVenue: null,
      };
    }
    return { status: "identified", researchUse: "ok", venue: row.venue, source: row.source };
  }

  function validateOhlc(row) {
    var o = toNumber(row && row.open != null ? row.open : row && row.o);
    var h = toNumber(row && row.high != null ? row.high : row && row.h);
    var l = toNumber(row && row.low != null ? row.low : row && row.l);
    var c = toNumber(row && row.close != null ? row.close : row && row.c);
    if ([o, h, l, c].some(function (v) { return v === null; })) {
      return { ok: false, reason: "ohlc_missing" };
    }
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) return { ok: false, reason: "non_positive_price" };
    if (h < o || h < c || h < l) return { ok: false, reason: "invalid_high" };
    if (l > o || l > c || l > h) return { ok: false, reason: "invalid_low" };
    return { ok: true, open: o, high: h, low: l, close: c };
  }

  function validateKlineDomain(row, expectedProduct) {
    var ohlc = validateOhlc(row);
    if (!ohlc.ok) return ohlc;
    if (expectedProduct) {
      if (row.product && String(expectedProduct) === "perpetual" && String(row.product) === "spot") {
        return { ok: false, reason: "product_mismatch" };
      }
      var match = productMatch(expectedProduct, row.instrumentId || expectedProduct);
      if (row.instrumentId && !match.ok) return { ok: false, reason: match.reason || "product_mismatch" };
    }
    var base = missingVsZero(row.baseVolume != null ? row.baseVolume : row.v);
    var quote = missingVsZero(row.quoteVolume != null ? row.quoteVolume : row.q);
    var takerBase = missingVsZero(row.takerBuyBase != null ? row.takerBuyBase : row.V);
    if (base.kind === "invalid" || (base.kind === "present" && base.value < 0) || (base.kind === "zero" && false)) {
      if (base.kind === "invalid" || (base.value !== null && base.value < 0)) return { ok: false, reason: "negative_or_invalid_volume" };
    }
    if (quote.kind === "invalid" || (quote.value !== null && quote.value < 0)) return { ok: false, reason: "negative_or_invalid_quote_volume" };
    if (takerBase.kind === "present" && base.kind === "present" && takerBase.value > base.value + 1e-12) {
      return { ok: false, reason: "taker_exceeds_total" };
    }
    if (takerBase.value !== null && takerBase.value < 0) return { ok: false, reason: "negative_or_invalid_volume" };
    return { ok: true, ohlc: ohlc, baseVolume: base, quoteVolume: quote, takerBuyBase: takerBase };
  }

  function validateBook(book) {
    var bids = book && book.bids;
    var asks = book && book.asks;
    if (!Array.isArray(bids) || !Array.isArray(asks)) return { ok: false, reason: "invalid_book_shape" };
    if (!bids.length || !asks.length) return { ok: false, reason: "empty_book", partial: true };
    function levelPrice(level) {
      return toNumber(Array.isArray(level) ? level[0] : level && level.price);
    }
    function levelQty(level) {
      return toNumber(Array.isArray(level) ? level[1] : level && (level.qty != null ? level.qty : level.size));
    }
    var bid = levelPrice(bids[0]);
    var ask = levelPrice(asks[0]);
    var bidQty = levelQty(bids[0]);
    var askQty = levelQty(asks[0]);
    if (bid === null || ask === null || bid <= 0 || ask <= 0) return { ok: false, reason: "invalid_book_price" };
    if (bidQty === null || askQty === null || bidQty < 0 || askQty < 0) return { ok: false, reason: "invalid_book_qty" };
    if (ask < bid) return { ok: false, reason: "crossed_book" };
    return { ok: true, bid: bid, ask: ask, spread: ask - bid };
  }

  function classifyKlineFinality(input) {
    var nativeX = input && input.nativeX;
    if (nativeX === true) return { status: "exchange_confirmed", basis: "native_k.x", usableForCloseConfirm: true };
    if (nativeX === false) return { status: "forming", basis: "native_k.x_false", usableForCloseConfirm: false };
    if (input && input.clockAfterClose) return { status: "time_elapsed_only", basis: "request_after_scheduled_close", usableForCloseConfirm: false };
    return { status: "unknown", basis: "no-native-confirmation-in-input", usableForCloseConfirm: false };
  }

  function capabilityStatus(input) {
    var registered = !!(input && input.registered);
    var observed = !!(input && (input.observed || input.lastSuccessReceivedAt));
    var continuous = !!(input && (input.continuous === true || input.automaticCollection === true));
    var consumer = !!(input && (input.consumerConnected === true || input.frontendConnected === true));
    var label;
    if (!registered) label = "unregistered";
    else if (!observed) label = "catalog_only";
    else if (!continuous) label = "observed_not_continuous";
    else if (!consumer) label = "continuous_consumer_pending";
    else label = "consumable";
    return {
      states: { registered: registered, observed: observed, continuous: continuous, consumer: consumer },
      label: label,
      liveClaimAllowed: continuous && observed && consumer,
    };
  }

  function transportVsMarket(input) {
    var wsOpen = !!(input && input.wsOpen);
    var lastMarketEventAt = toNumber(input && input.lastMarketEventAt);
    var now = toNumber(input && input.now);
    if (wsOpen && lastMarketEventAt === null) {
      return { transport: "open", marketFreshness: "unknown", livePriceClaim: false, reason: "transport_open_without_market_event" };
    }
    return {
      transport: wsOpen ? "open" : "closed",
      marketFreshness: lastMarketEventAt === null || now === null ? "unknown" : (now - lastMarketEventAt),
      livePriceClaim: wsOpen && lastMarketEventAt !== null,
    };
  }

  function freshnessByTask(dependencies, now) {
    var rows = Array.isArray(dependencies) ? dependencies : [];
    var asOf = toNumber(now);
    function itemOk(row) {
      var latest = toNumber(row.latestT);
      var staleMs = latest === null || asOf === null ? null : Math.max(0, asOf - latest);
      var threshold = toNumber(row.staleAfterMs);
      return staleMs !== null && threshold !== null && staleMs <= threshold;
    }
    var requiredFail = rows.filter(function (row) { return row.required !== false && !itemOk(row); });
    return {
      current: rows.find(function (row) { return row.current; }) || null,
      anyFresh: rows.some(itemOk),
      taskOk: requiredFail.length === 0,
      failed: requiredFail.map(function (row) { return row.id || row.interval; }),
      status: requiredFail.length ? "degraded" : "fresh",
      note: "task freshness uses required dependencies; any-fresh is informational only",
    };
  }

  function orderflowFreshness(input) {
    var now = toNumber(input && input.now);
    var lastTradeTime = toNumber(input && input.lastTradeTime);
    var barEnd = toNumber(input && input.barEnd);
    if (lastTradeTime === null) {
      return { status: "unknown", ageMs: null, reason: "missing_trade_time", reference: null, usedBarEndAsHeartbeat: false, barEnd: barEnd };
    }
    return {
      status: now === null ? "unknown" : "known",
      ageMs: now === null ? null : Math.max(0, now - lastTradeTime),
      reference: lastTradeTime,
      barEnd: barEnd,
      usedBarEndAsHeartbeat: false,
    };
  }

  function selectAsOfWindow(input) {
    var points = ((input && input.points) || []).filter(function (p) {
      return p && isFiniteNumber(Number(p.t)) && toNumber(p.value) !== null;
    }).sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var requestedWindowMs = toNumber(input && input.requestedWindowMs);
    var asOf = toNumber(input && (input.asOf != null ? input.asOf : input.now));
    var toleranceMs = toNumber(input && input.toleranceMs);
    if (toleranceMs === null) toleranceMs = 15 * 60 * 1000;
    var knowledgeCutoff = toNumber(input && input.knowledgeCutoff);
    var marketCutoff = toNumber(input && input.marketCutoff);
    var expectedSource = input && input.expectedSource;
    if (requestedWindowMs === null || requestedWindowMs <= 0 || asOf === null || points.length < 2) {
      return { ok: false, reason: "insufficient_points", requestedWindowMs: requestedWindowMs, actualWindowMs: null, value: null };
    }
    var usable = points.filter(function (p) {
      var t = Number(p.t);
      if (marketCutoff !== null && t > marketCutoff) return false;
      if (knowledgeCutoff !== null && toNumber(p.receivedAt) !== null && Number(p.receivedAt) > knowledgeCutoff) return false;
      if (expectedSource && p.source && p.source !== expectedSource) return false;
      if (toNumber(p.receivedAt) !== null && Number(p.receivedAt) > asOf) return false;
      return t <= asOf;
    });
    if (usable.length < 2) {
      return { ok: false, reason: "insufficient_anchor", requestedWindowMs: requestedWindowMs, actualWindowMs: null, value: null };
    }
    var end = usable[usable.length - 1];
    var target = Number(end.t) - requestedWindowMs;
    var prev = null;
    for (var i = usable.length - 2; i >= 0; i--) {
      if (Number(usable[i].t) <= target + toleranceMs) {
        prev = usable[i];
        break;
      }
    }
    if (!prev) {
      var span = Number(end.t) - Number(usable[0].t);
      var startVal = toNumber(usable[0].value);
      var endVal = toNumber(end.value);
      return {
        ok: false,
        reason: "insufficient_anchor",
        requestedWindowMs: requestedWindowMs,
        actualWindowMs: span,
        value: null,
        observedChange: startVal ? ((endVal - startVal) / Math.abs(startVal)) * 100 : null,
        start: usable[0],
        end: end,
      };
    }
    var actualWindowMs = Number(end.t) - Number(prev.t);
    if (Math.abs(actualWindowMs - requestedWindowMs) > toleranceMs) {
      return { ok: false, reason: "anchor_outside_tolerance", requestedWindowMs: requestedWindowMs, actualWindowMs: actualWindowMs, value: null, start: prev, end: end };
    }
    var startValue = toNumber(prev.value);
    var endValue = toNumber(end.value);
    if (startValue === null || startValue === 0 || endValue === null) {
      return { ok: false, reason: "invalid_anchor_value", requestedWindowMs: requestedWindowMs, actualWindowMs: actualWindowMs, value: null };
    }
    return {
      ok: true,
      requestedWindowMs: requestedWindowMs,
      actualWindowMs: actualWindowMs,
      anchorSkewMs: actualWindowMs - requestedWindowMs,
      value: ((endValue - startValue) / Math.abs(startValue)) * 100,
      start: prev,
      end: end,
    };
  }

  function digestObservation(values) {
    return JSON.stringify(values);
  }

  function receiptConflict(existing, incoming) {
    if (!existing) return { action: "insert" };
    var sameIdentity =
      existing.datasetId === incoming.datasetId &&
      existing.observationKey === incoming.observationKey &&
      existing.receivedAt === incoming.receivedAt;
    if (!sameIdentity) return { action: "insert" };
    if (digestObservation(existing.values) === digestObservation(incoming.values)) return { action: "reuse" };
    return { action: "reject", reason: "identity_content_conflict" };
  }

  var SOURCE_USAGE = {
    "binance-usdm-klines": { read: "allowed", persist: "unknown", modelSend: "unknown", export: "unknown", notes: "公开行情只读；保存/外发需按用途再核条款。" },
    "binance-usdm-ticker": { read: "allowed", persist: "unknown", modelSend: "unknown", export: "unknown", notes: "标题价只读。" },
    "legacy-d1-klines": { read: "allowed", persist: "denied", modelSend: "denied", export: "unknown", notes: "旧主键无 venue；可读但不得补标 Binance 后外发为单所证据。" },
    "stored-restricted-model": { read: "allowed", persist: "allowed", modelSend: "denied", export: "unknown", notes: "入库不自动授权模型外发。" },
    "unknown-vendor": { read: "unknown", persist: "denied", modelSend: "denied", export: "denied", notes: "未知不自动允许。" },
  };

  function sourcePurpose(sourceId, purpose) {
    var row = SOURCE_USAGE[sourceId];
    if (!row) return { status: "unknown", allowed: false, reason: "unregistered_source" };
    var status = row[purpose];
    if (!status) return { status: "unknown", allowed: false, reason: "unregistered_purpose" };
    return { status: status, allowed: status === "allowed", sourceId: sourceId, purpose: purpose, notes: row.notes };
  }

  function computeQuoteBaseVwap(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var quote = 0;
    var base = 0;
    var used = 0;
    list.forEach(function (row) {
      var q = toNumber(row.quoteVolume != null ? row.quoteVolume : row.q);
      var b = toNumber(row.baseVolume != null ? row.baseVolume : row.v);
      if (q === null && Array.isArray(row.trades)) {
        q = 0;
        b = 0;
        row.trades.forEach(function (trade) {
          var px = toNumber(Array.isArray(trade) ? trade[0] : trade.price);
          var qty = toNumber(Array.isArray(trade) ? trade[1] : trade.qty);
          if (px !== null && qty !== null && qty >= 0) {
            q += px * qty;
            b += qty;
          }
        });
      }
      if (q === null || b === null || b < 0 || q < 0) return;
      quote += q;
      base += b;
      used += 1;
    });
    if (!used || base === 0) {
      return { methodId: "M06", version: METHOD_VERSION, value: null, reason: "zero_or_missing_base", quoteVolume: quote, baseVolume: base };
    }
    return { methodId: "M06", version: METHOD_VERSION, value: quote / base, quoteVolume: quote, baseVolume: base };
  }

  function computeHlc3ApproxVwap(rows) {
    var pv = 0;
    var vol = 0;
    (rows || []).forEach(function (row) {
      var ohlc = validateOhlc(row);
      var v = toNumber(row.baseVolume != null ? row.baseVolume : row.v);
      if (!ohlc.ok || v === null || v < 0) return;
      pv += ((ohlc.high + ohlc.low + ohlc.close) / 3) * v;
      vol += v;
    });
    if (vol === 0) return { methodId: "M07", version: METHOD_VERSION, value: null, reason: "zero_or_missing_base" };
    return { methodId: "M07", version: METHOD_VERSION, value: pv / vol };
  }

  function sessionVwapSeries(klines, opts) {
    var mode = (opts && opts.mode) || "quote_base";
    var out = [];
    var dayKey = null;
    var bucket = [];
    (klines || []).forEach(function (row) {
      var ms = Number(row.t);
      if (!Number.isFinite(ms)) return;
      var d = new Date(ms);
      var key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (dayKey !== key) {
        dayKey = key;
        bucket = [];
      }
      bucket.push(row);
      var result = mode === "hlc3" ? computeHlc3ApproxVwap(bucket) : computeQuoteBaseVwap(bucket);
      var firstMs = Number(bucket[0] && bucket[0].t);
      var sessionAnchorComplete = Number.isFinite(firstMs) && firstMs <= key;
      out.push({
        time: Math.floor(ms / 1000),
        value: result.value,
        methodId: result.methodId,
        reason: result.reason || null,
        sessionAnchorComplete: sessionAnchorComplete,
        sessionDay: key,
      });
    });
    return out;
  }

  function evaluateFrozenBreakout(input) {
    var knownLevel = toNumber(input && input.knownLevel);
    var buffer = toNumber(input && input.buffer);
    var previousClose = toNumber(input && input.previousClose);
    var closedClose = toNumber(input && input.closedClose);
    var side = (input && input.side) || "resistance";
    if ([knownLevel, buffer, previousClose, closedClose].some(function (v) { return v === null; })) {
      return { ok: false, reason: "missing_inputs", confirmed: false };
    }
    var threshold = side === "support" ? knownLevel - buffer : knownLevel + buffer;
    var confirmed = side === "support" ? closedClose < threshold : closedClose > threshold;
    return {
      ok: true,
      methodId: "M12",
      version: METHOD_VERSION,
      knownLevel: knownLevel,
      buffer: buffer,
      threshold: threshold,
      previousClose: previousClose,
      closedClose: closedClose,
      confirmed: confirmed,
      note: "tested level is frozen from prior knowledge; display nearest is separate",
    };
  }

  function prevCompletedUtcDayRange(klines, opts) {
    if (!Array.isArray(klines) || klines.length < 2) return { ok: false, reason: "insufficient_bars" };
    var intervalMs = toNumber(opts && opts.intervalMs) || 60 * 60 * 1000;
    var latest = klines[klines.length - 1];
    var d = new Date(Number(latest.t));
    var latestDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var targetDay = latestDay - 24 * 60 * 60 * 1000;
    var dayBars = klines.filter(function (row) {
      var x = new Date(Number(row.t));
      return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) === targetDay;
    });
    if (!dayBars.length) return { ok: false, reason: "target_day_missing", day: targetDay };
    var high = -Infinity;
    var low = Infinity;
    var volume = 0;
    var minT = Infinity;
    var maxT = -Infinity;
    dayBars.forEach(function (row) {
      var ohlc = validateOhlc(row);
      if (!ohlc.ok) return;
      high = Math.max(high, ohlc.high);
      low = Math.min(low, ohlc.low);
      volume += toNumber(row.v) || 0;
      minT = Math.min(minT, Number(row.t));
      maxT = Math.max(maxT, Number(row.t));
    });
    if (!Number.isFinite(high) || !Number.isFinite(low)) return { ok: false, reason: "invalid_day_ohlc", day: targetDay };
    var expected = intervalMs >= 24 * 60 * 60 * 1000 ? 1 : Math.round((24 * 60 * 60 * 1000) / intervalMs);
    var span = maxT - minT;
    var complete = expected <= 1
      ? dayBars.length >= 1
      : dayBars.length >= Math.max(1, Math.floor(expected * 0.9)) || span >= 24 * 60 * 60 * 1000 - intervalMs;
    if (!complete) return { ok: false, reason: "incomplete_day", day: targetDay, bars: dayBars.length, expected: expected };
    return { ok: true, methodId: "M11", high: high, low: low, volume: volume, day: targetDay, complete: true, bars: dayBars.length };
  }

  function nestedPriceIndex(price, bin) {
    var p = toNumber(price);
    var b = toNumber(bin);
    if (p === null || b === null || b <= 0) return null;
    return Math.floor(p / b);
  }

  function priceFromIndex(index, bin) {
    return index * bin;
  }

  function selectPoc(levels, opts) {
    var rows = (levels || []).filter(function (level) {
      return level && toNumber(level.price) !== null && toNumber(level.total != null ? level.total : level.volume) !== null;
    });
    if (!rows.length) return { pocPrice: null, ties: [], reason: "empty_distribution" };
    var maxTotal = -Infinity;
    rows.forEach(function (level) {
      var total = toNumber(level.total != null ? level.total : level.volume);
      if (total > maxTotal) maxTotal = total;
    });
    var ties = rows.filter(function (level) {
      return Math.abs(toNumber(level.total != null ? level.total : level.volume) - maxTotal) < 1e-12;
    });
    var vwap = toNumber(opts && opts.vwap);
    ties.sort(function (a, b) {
      var pa = toNumber(a.price);
      var pb = toNumber(b.price);
      if (vwap !== null) {
        var da = Math.abs(pa - vwap);
        var db = Math.abs(pb - vwap);
        if (Math.abs(da - db) > 1e-12) return da - db;
      }
      return pa - pb;
    });
    return { methodId: "M15", version: METHOD_VERSION, pocPrice: toNumber(ties[0].price), ties: ties.map(function (level) { return toNumber(level.price); }), tiePolicy: "nearest_vwap_then_low" };
  }

  function fundingDisplay(input) {
    var rate = toNumber(input && input.rate);
    var unit = (input && input.unit) || "decimal-per-settlement";
    var kind = (input && input.kind) || "last_reported";
    var intervalHours = toNumber(input && input.intervalHours);
    if (rate === null) return { ok: false, reason: "missing_rate", value: null };
    var decimal = unit === "percent" ? rate / 100 : rate;
    var annualized = null;
    if (intervalHours && intervalHours > 0) annualized = decimal / intervalHours * 8760;
    return { ok: true, methodId: "M23", kind: kind, unit: "decimal-per-settlement", decimal: decimal, percent: decimal * 100, intervalHours: intervalHours, annualized: annualized, guessedUnit: false };
  }

  function coverageForWindow(available, required) {
    var a = toNumber(available);
    var r = toNumber(required);
    if (a === null || r === null || r <= 0) return { ok: false, reason: "unknown_requirement" };
    if (a < r) return { ok: false, available: a, required: r, missing: r - a, reason: "coverage_short", claimComplete: false };
    return { ok: true, available: a, required: r, missing: 0, claimComplete: true };
  }

  function lateObservationGuard(input) {
    var requestSeq = toNumber(input && input.requestSeq);
    var latestSeq = toNumber(input && input.latestSeq);
    var requestMarketTime = toNumber(input && input.requestMarketTime);
    var latestMarketTime = toNumber(input && input.latestMarketTime);
    if (latestSeq !== null && requestSeq !== null && requestSeq < latestSeq) return { accept: false, reason: "stale_generation" };
    if (latestMarketTime !== null && requestMarketTime !== null && requestMarketTime < latestMarketTime) return { accept: false, reason: "stale_market_time" };
    return { accept: true };
  }

  function buildCaptureIdentity(input) {
    return {
      schema: SCHEMA_VERSION,
      captureId: input && input.captureId,
      marketCutoff: (input && input.marketCutoff) || null,
      knowledgeCutoff: (input && input.knowledgeCutoff) || null,
      enabledCapabilities: (input && input.enabledCapabilities) || [],
      methodVersions: (input && input.methodVersions) || {},
      inputDigest: digestObservation(input && input.inputs),
      preview: !!(input && input.preview),
      final: !!(input && input.final),
    };
  }

  function buildMarketBrief(input) {
    var facts = (input && input.facts) || [];
    var changes = (input && input.changes) || [];
    var disagreements = (input && input.disagreements) || [];
    var limits = (input && input.limits) || [];
    if (input && input.coverage === "insufficient") {
      return {
        kind: "template_brief",
        status: "insufficient_coverage",
        capture: input && input.capture,
        facts: facts,
        changes: [],
        disagreements: disagreements,
        limits: limits.concat(["覆盖不足，不能写成市场平静"]),
        nextCheckpoint: (input && input.nextCheckpoint) || "等待足够窗口",
        modelUsed: false,
        scores: null,
      };
    }
    if (!(input && input.previous)) {
      return {
        kind: "template_brief",
        status: "initial_baseline",
        capture: input && input.capture,
        facts: facts,
        changes: [],
        disagreements: disagreements,
        limits: limits.concat(["首次无比较对象，只建立基线，不宣称市场平静"]),
        nextCheckpoint: (input && input.nextCheckpoint) || "等待下一窗口对照",
        modelUsed: false,
        scores: null,
      };
    }
    var important = changes.filter(function (row) { return row && row.material; });
    return {
      kind: "template_brief",
      status: important.length ? "material_change" : "no_material_change",
      capture: input && input.capture,
      facts: facts,
      changes: important,
      disagreements: disagreements,
      limits: limits,
      nextCheckpoint: (input && input.nextCheckpoint) || null,
      modelUsed: false,
      scores: null,
      short: !important.length,
    };
  }

  function modelBudgetRoot(input) {
    var limit = toNumber(input && input.limitUsd);
    var spent = toNumber(input && input.spentUsd) || 0;
    if (limit === null) return { ok: false, reason: "missing_root_budget" };
    var remaining = limit - spent;
    return { ok: remaining >= 0, limitUsd: limit, spentUsd: spent, remainingUsd: remaining, allowCall: remaining > 0 };
  }

  function verifyModelOutput(output, capture) {
    var citations = (output && output.citations) || [];
    var claims = (output && output.claims) || [];
    var uncited = claims.filter(function (claim) {
      return !citations.some(function (c) { return c && claim && c.factId === claim.factId; });
    });
    var invented = claims.filter(function (claim) {
      return claim && claim.factId && capture && Array.isArray(capture.factIds) && capture.factIds.indexOf(claim.factId) < 0;
    });
    return { ok: uncited.length === 0 && invented.length === 0, uncited: uncited, invented: invented };
  }

  function swingKnownAt(input) {
    var pivotBar = toNumber(input && input.pivotBar);
    var wing = toNumber(input && input.wing);
    var evaluationBar = toNumber(input && input.evaluationBar);
    if (pivotBar === null || wing === null) return { ok: false, reason: "missing_inputs" };
    var confirmedAtBar = pivotBar + wing;
    return {
      ok: true,
      confirmedAtBar: confirmedAtBar,
      usableAtEvaluation: evaluationBar !== null && evaluationBar >= confirmedAtBar,
      retrospectiveIfUsedEarlier: evaluationBar !== null && evaluationBar < confirmedAtBar,
    };
  }

  function classifyTickSources(input) {
    var observed = ((input && input.observedPrices) || []).map(toNumber).filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
    var minGap = null;
    for (var i = 1; i < observed.length; i++) {
      var gap = observed[i] - observed[i - 1];
      if (minGap === null || gap < minGap) minGap = gap;
    }
    var exchangeTick = toNumber(input && input.exchangeTick);
    return {
      observedMinGap: minGap,
      exchangeTick: exchangeTick,
      analysisBin: toNumber(input && input.analysisBin),
      displayBin: toNumber(input && input.displayBin),
      observedGapIsExchangeTick: false,
    };
  }

  function preserveAnalysisBin(analysisValue, displayBefore, displayAfter) {
    return {
      analysis: analysisValue,
      displayChanged: displayBefore !== displayAfter,
      preserved: true,
    };
  }

  function classifyLiquidationQuote(input) {
    var ap = toNumber(input && input.ap);
    var p = toNumber(input && input.p);
    var z = toNumber(input && input.z);
    var q = toNumber(input && input.q);
    var v = toNumber(input && input.v);
    if (ap !== null && ap > 0 && z !== null && z > 0) {
      return { kind: "average_fill", usableAsFillNotional: true, notional: ap * z };
    }
    if (p !== null && p > 0 && q !== null && q > 0 && (z === null || z === 0)) {
      return { kind: "order_price_times_order_qty", usableAsFillNotional: false, notional: null };
    }
    if (p !== null && p > 0 && v !== null) {
      return { kind: "bankruptcy_or_mark_estimate", usableAsFillNotional: false, estimate: p * v };
    }
    return { kind: "unknown", usableAsFillNotional: false };
  }

  function cumulativeFilledDelta(nativeId, zValues) {
    if (!nativeId) return { ok: false, reason: "no_native_identity", losslessDedup: false, deltas: [] };
    var list = Array.isArray(zValues) ? zValues : [];
    var deltas = [];
    var prev = 0;
    for (var i = 0; i < list.length; i++) {
      var z = toNumber(list[i]);
      if (z === null) return { ok: false, reason: "invalid_cumulative", losslessDedup: false, deltas: deltas };
      var d = z - prev;
      if (d < 0) return { ok: false, reason: "cumulative_decreased", losslessDedup: false, deltas: deltas };
      deltas.push(d);
      prev = z;
    }
    return { ok: true, deltas: deltas, total: prev, losslessDedup: true };
  }

  function calendarFactKind(input) {
    if (input && input.officialSchedule) return { kind: "official_schedule", futureCatalystAllowed: true };
    if (input && input.publishedAt) return { kind: "article_timestamp", futureCatalystAllowed: false };
    return { kind: "unknown_schedule", futureCatalystAllowed: false };
  }

  function searchCoverageStatus(input) {
    if (!input || input.incrementalSearchUsed === false) {
      return { coverage: "unknown", claimSufficient: false, sourceHealth: (input && input.sourceHealth) || "unknown" };
    }
    return { coverage: (input && input.coverage) || "unknown", claimSufficient: false };
  }

  function opportunityFromAvailability(input) {
    if (input && input.marketOk && input.directionsNotComputed) {
      return { alignedOpportunity: false, reason: "availability_is_not_alignment" };
    }
    return { alignedOpportunity: !!(input && input.aligned) };
  }

  function observationKind(input) {
    if (input && input.computed) return { kind: "computed_description", rawFact: false };
    return { kind: "raw_observation", rawFact: true };
  }

  function recoveryGrade(input) {
    if (input && input.restricted) return { grade: "restricted", latestSubstitution: false };
    if (input && (input.missing || !input.found)) return { grade: "missing", latestSubstitution: false };
    if (input && input.reportOnly) return { grade: "report_only", latestSubstitution: false };
    if (input && input.aggregatesOnly) return { grade: "aggregate_evidence", latestSubstitution: false };
    if (input && input.inputsReadable) return { grade: "exact_inputs", latestSubstitution: false };
    return { grade: "unknown", latestSubstitution: false };
  }

  function resolveHistoricalReport(requestedId, found) {
    if (!requestedId) return { action: "no_request", latestSubstitution: false };
    if (found && found.restricted) {
      return { action: "restricted", report: null, requestedId: requestedId, latestSubstitution: false };
    }
    if (!found) return { action: "missing", report: null, requestedId: requestedId, latestSubstitution: false };
    if (String(found.id) !== String(requestedId)) {
      return { action: "identity_mismatch", report: null, requestedId: requestedId, latestSubstitution: false };
    }
    return { action: "exact", report: found, requestedId: requestedId, latestSubstitution: false };
  }

  function exportPurposeGuard(sourceId, purpose) {
    return sourcePurpose(sourceId, purpose || "export");
  }

  function formatResearchEvidenceLines(input) {
    var sel = input || {};
    return [
      sel.instrumentId || PRIMARY_INSTRUMENT.id,
      sel.windowLabel || sel.interval || null,
      "methods " + METHOD_VERSION,
      sel.captureId ? "capture " + sel.captureId : "capture 未封存",
      sel.reportId ? "report " + sel.reportId : null,
      sel.recoveryGrade ? "恢复 " + sel.recoveryGrade : null,
      sel.source || null,
      sel.coverage || null,
      "拖动视口不是研究身份",
    ].filter(Boolean).join(" · ");
  }

  function depthBandStatus(input) {
    var wanted = toNumber(input && input.wantedBps);
    var visible = toNumber(input && input.lastVisibleBps);
    if (wanted === null || visible === null || visible < wanted) {
      return { status: "partial", remainingIsZero: false };
    }
    return { status: "complete", remainingIsZero: false };
  }

  function etfFlowPartial(input) {
    var known = 0;
    var missing = 0;
    Object.keys(input || {}).forEach(function (key) {
      if (input[key] == null) missing += 1;
      else known += Number(input[key]) || 0;
    });
    return { totalKnown: known, missingFunds: missing, completeUniverse: missing === 0, noneIsZero: false };
  }

  function polarityRelation(a, b) {
    if (a && b && String(a) !== String(b)) return { relation: "negation_or_correction", dropAsNearDuplicate: false };
    return { relation: "same_or_unknown", dropAsNearDuplicate: false };
  }

  function sameOriginCarriers(input) {
    var count = Array.isArray(input && input.domains) ? input.domains.length : toNumber(input && input.domains);
    return { originId: input && input.originId, carrierCount: count, independentConfirmations: 1 };
  }

  function hashIsNotTruth(input) {
    return {
      digestValid: !!(input && input.digestValid),
      claimSupported: !!(input && input.claimSupported),
      factOk: !!(input && input.digestValid && input.claimSupported),
    };
  }

  function providerOutcome(input) {
    if (input && input.requestSent && input.timeout) {
      return { usage: "unknown", retryUnlimited: false, assumeUnbilled: false };
    }
    return { usage: (input && input.usage) || "known", retryUnlimited: false };
  }

  function cancelLateResponse(input) {
    if (input && input.cancelled && input.lateResponse) return { publish: false, becomeFinal: false };
    return { publish: !!(input && input.publish), becomeFinal: !!(input && input.final) };
  }

  function weekendObservation(input) {
    return { newObservation: false, calendarBackground: true, lastObserved: input && input.lastObserved, today: input && input.today };
  }

  function systemObservedImport(input) {
    return {
      observationDate: input && input.observationDate,
      receivedAt: input && input.receivedAt,
      backfillKnownAt: false,
    };
  }

  function truncatedSection(returned, available) {
    var a = toNumber(returned);
    var b = toNumber(available);
    return { partial: a !== null && b !== null && a < b, complete: a !== null && b !== null && a >= b };
  }

  function optionsSummaryFields(row) {
    return {
      hasBidAsk: !!(row && row.bid_price != null && row.ask_price != null),
      markIv: row && row.mark_iv,
      inventMissingGap: false,
    };
  }

  function concurrentRefreshNote() {
    return { singleflightGuaranteed: false, duplicateUpstreamObservable: true };
  }

  function enabledCapabilityClaim(enabled, claim) {
    return { allowed: !!enabled, reject: !enabled, claim: claim || null };
  }

  function incrementalValueSplit(input) {
    return {
      dataIncrementRunnable: !!(input && input.dataIncrement),
      modelIncrementRunnable: !!(input && input.modelCallAuthorized),
      claimedLiftPct: null,
    };
  }

  function healthScope(input) {
    return {
      knownAt: input && input.knownAt,
      healthScope: (input && input.healthScope) || "current",
      historicalHealthFromCurrent: false,
    };
  }

  var METHOD_REGISTRY = {
    M06: { id: "M06", version: METHOD_VERSION, name: "quote_base_vwap" },
    M07: { id: "M07", version: METHOD_VERSION, name: "hlc3_approx_vwap" },
    M11: { id: "M11", version: METHOD_VERSION, name: "prev_completed_utc_day" },
    M12: { id: "M12", version: METHOD_VERSION, name: "frozen_level_breakout" },
    M15: { id: "M15", version: METHOD_VERSION, name: "poc_tie_vwap_then_low" },
    M23: { id: "M23", version: METHOD_VERSION, name: "funding_explicit_unit" },
  };

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    METHOD_VERSION: METHOD_VERSION,
    PRIMARY_INSTRUMENT: PRIMARY_INSTRUMENT,
    SOURCE_USAGE: SOURCE_USAGE,
    METHOD_REGISTRY: METHOD_REGISTRY,
    missingVsZero: missingVsZero,
    instrumentId: instrumentId,
    parseInstrumentId: parseInstrumentId,
    productMatch: productMatch,
    classifyLegacySource: classifyLegacySource,
    validateOhlc: validateOhlc,
    validateKlineDomain: validateKlineDomain,
    validateBook: validateBook,
    classifyKlineFinality: classifyKlineFinality,
    capabilityStatus: capabilityStatus,
    transportVsMarket: transportVsMarket,
    freshnessByTask: freshnessByTask,
    orderflowFreshness: orderflowFreshness,
    selectAsOfWindow: selectAsOfWindow,
    receiptConflict: receiptConflict,
    sourcePurpose: sourcePurpose,
    computeQuoteBaseVwap: computeQuoteBaseVwap,
    computeHlc3ApproxVwap: computeHlc3ApproxVwap,
    sessionVwapSeries: sessionVwapSeries,
    evaluateFrozenBreakout: evaluateFrozenBreakout,
    prevCompletedUtcDayRange: prevCompletedUtcDayRange,
    nestedPriceIndex: nestedPriceIndex,
    priceFromIndex: priceFromIndex,
    selectPoc: selectPoc,
    fundingDisplay: fundingDisplay,
    coverageForWindow: coverageForWindow,
    lateObservationGuard: lateObservationGuard,
    buildCaptureIdentity: buildCaptureIdentity,
    buildMarketBrief: buildMarketBrief,
    modelBudgetRoot: modelBudgetRoot,
    verifyModelOutput: verifyModelOutput,
    swingKnownAt: swingKnownAt,
    classifyTickSources: classifyTickSources,
    preserveAnalysisBin: preserveAnalysisBin,
    classifyLiquidationQuote: classifyLiquidationQuote,
    cumulativeFilledDelta: cumulativeFilledDelta,
    calendarFactKind: calendarFactKind,
    searchCoverageStatus: searchCoverageStatus,
    opportunityFromAvailability: opportunityFromAvailability,
    observationKind: observationKind,
    recoveryGrade: recoveryGrade,
    resolveHistoricalReport: resolveHistoricalReport,
    exportPurposeGuard: exportPurposeGuard,
    formatResearchEvidenceLines: formatResearchEvidenceLines,
    depthBandStatus: depthBandStatus,
    etfFlowPartial: etfFlowPartial,
    polarityRelation: polarityRelation,
    sameOriginCarriers: sameOriginCarriers,
    hashIsNotTruth: hashIsNotTruth,
    providerOutcome: providerOutcome,
    cancelLateResponse: cancelLateResponse,
    weekendObservation: weekendObservation,
    systemObservedImport: systemObservedImport,
    truncatedSection: truncatedSection,
    optionsSummaryFields: optionsSummaryFields,
    concurrentRefreshNote: concurrentRefreshNote,
    enabledCapabilityClaim: enabledCapabilityClaim,
    incrementalValueSplit: incrementalValueSplit,
    healthScope: healthScope,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalTarget && typeof globalTarget === "object") globalTarget.BitContracts = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
