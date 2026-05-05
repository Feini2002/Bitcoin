/**
 * Cloudflare Worker：代理 Gemini API + Finnhub，在服务端注入 API Key，前端不携带密钥
 * 部署后请在 Dashboard → Settings → Variables 添加 Secret：GOOGLE_API_KEY、FINNHUB_API_KEY
 */

const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
const FINNHUB_ORIGIN = 'https://finnhub.io';

/** 设为 true 时，接口全部返回 503，外人无法使用；有时间加鉴权后再改回 false 并重新部署 */
const MAINTENANCE_MODE = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT_PER_MINUTE = 12;
const RATE_WINDOW_MS = 60 * 1000;

/** 单 IP 每分钟最多 RATE_LIMIT_PER_MINUTE 次请求，使用 Cache API 存储计数（自定义域名下可用） */
async function checkRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
  const cacheKey = `https://rl/${ip}`;
  const now = Date.now();
  let window = { start: now, count: 1 };

  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      if (now - data.start <= RATE_WINDOW_MS) {
        if (data.count >= RATE_LIMIT_PER_MINUTE) {
          return new Response(
            JSON.stringify({ error: '跃迁引擎冷却中，请稍后再试。' }),
            { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          );
        }
        window = { start: data.start, count: data.count + 1 };
      }
    }
    await caches.default.put(cacheKey, new Response(JSON.stringify(window), { headers: { 'Cache-Control': 'max-age=60' } }));
  } catch (_) {
    // Cache API 异常时放行，避免影响可用性
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (MAINTENANCE_MODE) {
      return new Response(
        JSON.stringify({ error: '主控程序升级中，暂不可用。' }),
        { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const rateLimitRes = await checkRateLimit(request);
    if (rateLimitRes) return rateLimitRes;

    const url = new URL(request.url);

    // 1) Gemini：/v1beta/models/... 转发到 Google 并注入 Key（支持 generateContent 与 streamGenerateContent，流式可避免 120s 代理读超时）
    if (url.pathname.startsWith('/v1beta/')) {
      const key = env.GOOGLE_API_KEY;
      if (!key) return jsonErr(500, '系统未配置 GOOGLE_API_KEY');
      const target = GEMINI_ORIGIN + url.pathname + url.search + (url.search ? '&' : '?') + 'key=' + encodeURIComponent(key);
      
      // 将传入的 abort signal 穿透到下游
      return proxy(request, target, request.signal);
    }

    // 2) Finnhub 批量接口：/finnhub-bulk?symbols=QQQ,SPY,NVDA,GLD
    if (url.pathname === '/finnhub-bulk') {
      const token = env.FINNHUB_API_KEY;
      if (!token) return jsonErr(500, '系统未配置 FINNHUB_API_KEY');
      const symbols = (url.searchParams.get('symbols') || '').split(',');
      
      const results = {};
      const tasks = symbols.map(async (sym) => {
        const target = `${FINNHUB_ORIGIN}/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
        try {
          const resp = await fetch(target);
          if (resp.ok) {
            results[sym] = await resp.json();
          }
        } catch (e) {}
      });
      
      await Promise.all(tasks);
      return new Response(JSON.stringify(results), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 3) Finnhub 单个接口（保留兼容性）
    if (url.pathname.startsWith('/finnhub/')) {
      const token = env.FINNHUB_API_KEY;
      if (!token) return jsonErr(500, '系统未配置 FINNHUB_API_KEY');
      const symbol = url.searchParams.get('symbol') || '';
      const target = FINNHUB_ORIGIN + '/api/v1/quote?symbol=' + encodeURIComponent(symbol) + '&token=' + encodeURIComponent(token);
      return proxy(new Request(target, { method: 'GET', headers: {} }), target);
    }

    return jsonErr(404, '接口路径不存在');
  },
};

/** 不设置请求超时，允许模型长时间分析完成 */
async function proxy(request, targetUrl, externalSignal) {
  try {
    const controller = new AbortController();
    // 强制设置一个很长的超时，防止 CF 默认更早断开 fetch
    const timeoutId = setTimeout(() => controller.abort(), 240000); // 4 分钟
    
    // 如果客户端主动断开，也中断上游请求
    if (externalSignal) {
        externalSignal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            controller.abort();
        });
    }

    const req = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      duplex: request.method !== 'GET' && request.method !== 'HEAD' ? 'half' : undefined,
      signal: controller.signal
    });
    
    const res = await fetch(req);
    clearTimeout(timeoutId);

    const headers = new Headers(res.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (e) {
    if (e.name === 'AbortError') {
      return jsonErr(504, '请求处理超时或被中断');
    }
    return jsonErr(502, '连接上游服务失败: ' + e.message);
  }
}

function jsonErr(code, msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
