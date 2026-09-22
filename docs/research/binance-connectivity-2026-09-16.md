# 币安连接诊断与修复（2026-09-16）

**2026-09-21**：旧 WS 入口退役的修复仍有效；当时「迁 `/market` 不解 CF 403」也被后来直连五域持续 403 证实。永续 REST/fstream 现经东京反代，见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。下文采样与「不购买服务器」是 09-16 边界。

## 可复核证据与边界

- 官方[迁移公告](https://www.binance.com/en/support/announcement/detail/ebf9b0aa9eca4ff3804eef6fb09ba32a)说明旧USDⓈ-M WebSocket入口于2026-04-23退役。新入口按public、market、private区分。
- 官方[market流文档](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)确认aggTrade、kline与forceOrder使用`/market/ws/`或`/market/stream`。深度流使用public入口，不能全局替换所有币安产品域名。
- 16:35本机对照：旧合约combined地址握手成功，20秒零行情；新market地址1,871ms收到19个消息，覆盖aggTrade和kline。脚本`scripts/diagnose-binance-ws.cjs`有独立25秒截止、无凭据；证据`.artifacts/binance-connectivity/ws-comparison.json`。
- 生产Worker原强平源为connecting、零市场消息、3,073次重连。前端行情、足迹、强平与DO均引用旧地址。修改仅涉及连接协议和错误的握手心跳，不实施工作台设计方案。
- 同时实测`/api/d1/derivatives/origin-check`：`cf-placement=remote-NRT`，fapi、fapi1–4五个域均403。该事实证明HTTP处理已在东京附近，不能靠重复设置placement解决。Binance错误为HTML拒绝，不是API Key缺失；精确WAF/区域规则仍未判定。

## 网络调研与可行路径

- [币安API FAQ](https://www.binance.com/en/support/faq/detail/360004492232)将403与WAF联系；429/418限流须分别处理。当前403不能仅凭状态码认定是短时限流或国家限制。
- [Cloudflare placement](https://developers.cloudflare.com/workers/configuration/placement/)只是执行位置选择，不承诺独享固定出口；HTTP位置也不能证明DO和Cron出口相同。
- GitHub作者[pyne-worker](https://github.com/hoox-sh/pyne-worker)记录CF出口访问币安403及边缘外采集实践；另一个[作者项目](https://github.com/andychien555/binance-smart-money-tracker)使用外部服务器转发。它们支持调查方向，但不能证明本项目的拒绝根因；这里不引入其他交易所替代币安，也不购买代理或服务器。
- Binance开发者论坛、GitHub问题与Reddit搜索得到的改用testnet建议不可采用：测试网不是实盘。现货`data-api.binance.vision`也不能冒充U本位合约；[官方market-data-only说明](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)属于Spot。
- 免费可行顺序：修复官方WS入口；核验CF是否能实际收到消息；历史公开档案可用于历史补齐；REST只有本机通路当前已证实可用，可继续按需取数后写D1。持续REST采集需要获准网络中的现有常在线设备或币安确认解除出口拒绝，当前不承诺免费的24小时独立出口。
- 本轮不绕过平台地域资格限制，不使用来路不明公共代理，不反复高频换域重试；不把WS修复当作OI、资金费历史、账户比例等全部REST恢复。

## 验收与恢复

- 发布前版本回退点：`199c5d0d-15b0-431b-855c-c4df75499dc3`。仅代码变更，保留Secret、Cron和D1数据。
- 以真实行情消息和D1可读数据作为验收，不以WebSocket open或Wrangler退出码代替。新增强平不保证每个观察窗口必然出现；forceOrder是快照采样，不是全量清算流水。

## 修复后结果

- Worker `7c5fa076-7a5c-4897-8bf0-70b176216603`已于16:41左右切换100%生产流量。首次切换因Cloudflare登录服务连接超时失败；确认命令退出后重试同一个版本成功，没有重复上传或改动触发器。
- 16:42读取新DO实例：Binance仍connecting，27次重连、0市场消息；Bybit正常有消息。这证明迁移地址不能单独解除CF出口问题，不声称CF币安WS或持续D1写入已恢复。证据`.artifacts/binance-connectivity/collector-after.json`。
- 浏览器端同时移除合约现价对现货WS/现货REST的自动替代；Worker ticker回退结果只有明确`binance-fapi-ticker-price`才用于合约标题。原有历史D1混源问题保留在下一轮数据模型改版范围，不声称此处已解决。
- 全量`npm run build`通过；额外DO测试确认连接open不再伪造市场心跳、真实aggTrade才更新时间。Playwright `npm run verify:ui` Chromium147，1440×1000与390×844，46 PASS/0 FAIL，覆盖新订阅地址、消息渲染、D1时间不被WS改写、断流错误、恢复与连接释放。此为固定样本行为验收，不能冒充CF实时链路成功。
- REST云端连续采集仍未恢复。本轮不新增常驻本地进程、不改变免费套餐、不将其他交易所数据改名成Binance。
- Pages发布`324f6d4a.bit-trading-desk.pages.dev`；生产pages.dev首页200且引用`20260916-binance-ws2`，新chart脚本200且有market路径、无旧路径。自定义域未登录请求仍Access302，未宣称完成其已登录线上UI验收。`npm run verify:api`生产D1状态200；导航检查17项通过，CodeGraph已同步。证据`.artifacts/binance-connectivity/release.json`。
