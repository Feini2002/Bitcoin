# 免费金融数据通道（2026-09-16）

最新扩展：现为40个平台/产品、93个公开操作。新增9项Binance规则/统计通道，以及独立的32项规范观察数据集；完整现状见[币安主源数据与改版方案](workbench-binance-data-plan-2026-09-16.md)，逐平台限制见[限制矩阵](free-financial-platform-limits-2026-09-16.md)。下文各时间节点的84项统计是当时实测记录，保留原样，不冒充93项已全量重测。

## 需求与研究依据

用户要求提前在 Cloudflare 接好可能需要的金融平台通道，当前只使用免费 API。本实现覆盖交易所、衍生品、链上、DeFi、宏观、利率、外汇、股票、能源、公告与预测市场。接口准备不表示已进入行情工作台或分析输入。

先读现有研究包的 `06_collection_design/01_collection_handbook.md`、`02_source_catalog.md`、`source_catalog.candidates.json`，以及 V04 的来源、时间、单位契约；再逐项核对平台注册文档与免费边界。历史研究中的付费服务、样本下载、网页和任务提示不视为当前执行授权或免费 API 证明。

当前能力的权威目录是 [registry.mjs](../../cloudflare/finance/registry.mjs)，含每个平台官方文档、接口、参数、免费限制与缓存周期。线上 `GET https://btc.feiniwork.com/api/finance/catalog` 返回同一目录及配置状态；不在目录中虚构实时健康状态。

## 已实施范围

- 40 个平台/产品、84 个操作；固定官方目标与只读参数。Hyperliquid 的公开 `/info` 使用固定查询 POST，外部网关仍只接收 GET。
- 不购买、不试用、不升级套餐；不接交易、账户、钱包；不新增 Cron、历史回补或自动采集；不触发模型调用。用户后续授权的按需 D1 存储见文末。
- 复用行情 Worker，新增 `/api/finance/{provider}/{operation}`，默认参数可直接验证。例：`/api/finance/binance-usdm/premium?symbol=BTCUSDT`、`/api/finance/nyfed/sofr`。
- 继承已有 Cloudflare Access 与 CORS；不创建公共任意 URL 代理。缓存 60 秒至一天，按平台调整。超时 12 秒，响应上限 4 MiB，不自动重试或跨平台替代。
- 返回原始单位、时间、币种及响应；`normalized:false`。`receivedAt` 是网关接收时间，不能当市场观察时间；缓存命中保持原接收时间。各平台数据不能直接混算。
- 上游免费不等于无限额、无限市场权限或无限再分发。Cloudflare 自身请求量仍按已有账户方案计量，本次不购买资源或付费计划。

## 覆盖与免费证据

| 类别 | 已建立通道 |
| --- | --- |
| 交易所/衍生品 | Binance 现货与 USDⓈ-M、Bybit、OKX、Deribit、Coinbase、Kraken、Bitfinex、Bitstamp、Bitget、KuCoin、Hyperliquid |
| 聚合/DeFi | CoinGecko Demo、CoinMarketCap Basic、Coinpaprika、DefiLlama、DEX Screener、Alternative.me |
| 链上 | Coin Metrics Community、mempool.space、Blockstream Esplora、Blockchain.com |
| 宏观/利率/外汇 | FRED/ALFRED、BLS、美国财政部、ECB、World Bank、Frankfurter、加拿大央行、纽约联储、Eurostat、CFTC |
| 股票/披露/能源 | Alpha Vantage、Finnhub、Twelve Data Basic、SEC EDGAR、EIA |
| 公告/事件 | GDELT、美联储 RSS、Polymarket Gamma |

逐项正式文档链接见线上目录与注册表；以下是易混淆的免费限制（核验日 2026-09-16）：

- [Alpha Vantage](https://www.alphavantage.co/support/#api-key)：免费额度 25 次/日；只开放 compact 日线，不请求 full/premium。
- [Twelve Data](https://twelvedata.com/pricing)：个人 Basic 免费额度 8 credits/min、800/day；不同市场权限不能用代码绕过。
- [CoinGecko](https://www.coingecko.com/en/api/pricing)：使用 Demo Key 和公开 API 主机，不能把 Pro Key 或试用当永久免费。
- [CoinMarketCap](https://coinmarketcap.com/api/pricing/)：Basic 免费，但正式主机仍名为 pro-api；仅使用 Basic 的 listings/latest。
- [Coin Metrics Community](https://docs.coinmetrics.io/api)：社区接口免 Key，非商业使用边界须保留。
- [FRED](https://fred.stlouisfed.org/docs/api/api_key.html)、[EIA](https://www.eia.gov/opendata/documentation.php)：免费注册 Key；初始通道实现未创建账号，后续按用户明确授权申请，见本页申请记录。
- [SEC](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)：免费，必须提交真实应用与联系邮箱的 User-Agent；不虚构联系人。
- [Frankfurter](https://frankfurter.dev/)、[加拿大央行](https://www.bankofcanada.ca/valet-api-how-to/)是参考汇率/统计，不是实时可成交报价。

## 免费通道配置

通过 Cloudflare Worker 的 Secrets 配置下列绑定；只使用已确认免费计划的 Key，不在聊天、源码、日志或研究文档中保存真实值。Key 是否免费由账户方案决定，网关不能鉴别一个字符串背后的订阅等级。

| 平台 | 绑定名 |
| --- | --- |
| CoinGecko Demo | FREE_COINGECKO_API_KEY |
| CoinMarketCap Basic | FREE_COINMARKETCAP_API_KEY |
| FRED | FREE_FRED_API_KEY |
| Alpha Vantage | FREE_ALPHAVANTAGE_API_KEY |
| Finnhub | FREE_FINNHUB_API_KEY |
| Twelve Data Basic | FREE_TWELVEDATA_API_KEY |
| EIA | FREE_EIA_API_KEY |
| SEC（普通设置，真实应用名和联系邮箱） | FINANCE_SEC_USER_AGENT |

缺配置直接返回 503 与明确原因，不发上游请求。配置完成仅表示 configured-not-probed，必须再定向探测；有限额接口不要用全量诊断反复消耗免费额度。

## 不冒充已接通的范围

Glassnode、CryptoQuant、Nansen、Santiment、Laevitas、Amberdata、Kaiko、Tardis、Bloomberg、LSEG、Trading Economics、CoinGlass 未核实适合本任务的长期免费正式 API，未新增。Yahoo/东方财富/新浪抓取链不作为已核实官方通道新增。ETF、Circle、Tether 披露网页不伪装成净流入/储备 API。BIS/OECD/IMF/中国统计仍需核实具体当前接口，列为候选而非完成项；详见 catalog.excluded。

## 验证、发布与维护

- `npm run verify:finance`：离线契约、凭据隔离、限流、超时、缓存、上游应用错误、Worker 路由与 Access，以及真实 SQLite 存储验证。
- `npm run diagnose:finance`：本机无 Key 首接口探测；`-- --origin https://btc.feiniwork.com --all --d1` 验证 CF 出口全部操作及独立 D1 读回，结果写入 `.artifacts/finance-channels/`。启用存储后，源查询会按需落库；仅有限探测，无自动重试。支持 `--provider` / `--operation` 定向复核。
- `npm run build`：全量既有验证与 Pages 产物检查。代码版本发布使用 Wrangler versions upload/deploy，保留运行变量，不改线上触发器和路由。D1 新增表只应用 `cloudflare/finance/schema.sql`，不重跑既有市场迁移。
- 本轮前版本为 `98757086-96b6-419a-9666-40116420e458`，必要时通过 Worker 版本部署回退；无需回滚数据库。
- 新平台需先证实免费范围和官方契约，登记来源、参数、市场/单位/时间限制，并补充定向验证；不得仅增加一个名称就宣布接入。

实时探测是特定时间和出口的事实，不构成长期连通承诺。最终实测结果见下方发布记录。

## 发布与实测记录

2026-09-16 13:37（北京时间），Cloudflare 生产网关全量 84 操作：49 PASS、14 PENDING、21 FAIL。8 个平台需要免费 Key 或 SEC 联系信息，共 14 操作；其余失败涉及 8 个平台/产品。本机先前首操作探测 30 PASS、8 PENDING、2 FAIL，证明本机结果不能替代 CF 出口验收。

| CF 未通过项 | 证据与处理 |
| --- | --- |
| Binance 现货 3、USDⓈ-M 6、Bitget 1 | 上游 403；明确返回访问受限，不切换其他交易所伪造成功 |
| Deribit 4、DEX Screener 1、BLS 1、GDELT 1 | 上游 429，保留限流，不自动重试或购买升级 |
| CoinPaprika 2 | 上游 402；[官方 FAQ](https://docs.coinpaprika.com/faq)确认 402/429 为额度限制，映射为网关 429 并保留原状态；其[免费计划](https://docs.coinpaprika.com/api-plans)为每月 20,000 次，不代表 CF 共用出口当前有额度 |
| 美国财政部 2 | 上游 525 TLS 握手失败；不关闭证书验证、不改为 HTTP |

24 个平台全部操作实测成功；8 个平台受上述上游限制；8 个平台待配置。ECB 本机连接失败但 CF 成功，进一步说明出口差异。所有失败通道仅能称适配已部署，不能称已接通。

完整离线构建通过；金融通道 17 项测试和 84 操作请求契约通过。实测机器记录为 `.artifacts/finance-channels/cloudflare.json`，不包含 Key 或原始金融响应。版本首次上传 `feafd00a-648d-418c-bd9e-b5b9b4874902`；修正 402 分类后的最终版本见下方。

最终 Worker 版本 `a8ff359e-d72a-4a60-8a57-d39ee3468901` 已切换 100% 流量。13:42 定向线上复核：catalog HTTP 200、40 平台/84 操作；Bybit ticker HTTP 200；CoinPaprika ticker 网关 429/原始 402；FRED 缺 Key 503；原 `/api/d1/status` HTTP 200。Pages 同步发布 `19bad2f2.bit-trading-desk.pages.dev`，本次未改动前端运行文件。

Pages 主域 `bit-trading-desk.pages.dev` 返回 200 且资源版本正确；自定义域 `bitcoin.feiniwork.com` 返回 Cloudflare Access 登录跳转，未以未登录请求冒充页面验收。发布后的 production 历史清理删除了 17 条（原 25、计划保留 8）；preview 首次列表请求超时，后续只读确认仅 2 条、无需删除。production 最终数量复查遇到 Cloudflare API 超时，未据此重复部署；不影响已验证的新 Worker/Pages 发布。

## 免费 Key 申请与配置（后续记录）

2026-09-16 14:30（北京时间），按用户本次授权申请免费 Key，并仅在浏览器内存读取后直接写入现有 `btc` Worker 的加密 Secret；不在本地文件、日志或本资料保存真实值。新增注册信息及服务条款已由用户确认。

| 平台 | 已确认套餐 / 配置 | CF 出口结果 |
| --- | --- | --- |
| CoinMarketCap | Basic，已配置 | listings 200 |
| FRED | 新建项目专用 Key，已配置；既有 Key 保持 | series、observations 均 200 |
| Finnhub | Free，无支付方式，已配置 | quote、news 均 200 |
| Twelve Data | Basic 8，800 credits/day，已配置 | price、daily 均 200 |
| CoinGecko | Demo，10,000 credits/月、100 calls/min，已配置 | prices、markets 200；global 上游 401，未计为接通 |
| Alpha Vantage | 免费 Key 已配置 | 修正后定向复核返回 429 / upstream_rate_limited；未取得日线数据 |
| EIA | 免费申请和邮箱验证完成，用户直接填入 CF 加密 Secret | petroleum 200 |

[CoinGecko Demo global 官方契约](https://docs.coingecko.com/demo/reference/crypto-global)确认 `/api/v3/global` 使用 `x-cg-demo-api-key`，当前实现与文档相符；单接口 401 不证明整个 Key 无效，也不自动升级套餐或修改鉴权方式。

[Alpha Vantage 文档](https://www.alphavantage.co/documentation/)确认 compact 日线对免费 Key 开放。网关修正：先将 Note/Information/Error Message 分类成固定错误码，限流提示返回 429，再对成功载荷检查凭据回显；不返回原始错误文字。离线用例同时验证“含 Key 的限流提示仍能正确分类”和“成功载荷含 Key 仍被拦截”。

14:42 最终记录：7 个免费 Key 均已配置为 `btc` 加密 Secret，12 个相关操作中 10 PASS、2 FAIL（Alpha Vantage daily 限流；CoinGecko global 401，单独复核仍然失败）。这不是平台全部接口权限或长期可用性保证。SEC 不申请 Key，仍缺联系标识配置，未将提供给注册流程的邮箱自动用于该新目的。

错误分类修正已发布为 Worker 版本 `074facb2-7e4a-4b42-bfeb-7ef0ec345955`、100% 流量；发布后目录确认七个 Key 配置全部保留，原 `/api/d1/status` 200。可回退到修正前且已含七个 Secret 的 `11c92a4f-3a27-4ab3-8226-a117cf356521`，不要回退到尚未配置免费 Key 的旧版本。`npm run build`、金融通道 18 项测试 / 84 操作契约、研究导航检查、CodeGraph 同步状态均通过；无 D1 变更、无付费订阅或试用。

Pages 同步发布 `8b8e16b2.bit-trading-desk.pages.dev`；该部署及生产 `bit-trading-desk.pages.dev` 均 HTTP 200、入口资源引用正常，自定义域仍为 Access 302。后续旧部署清理在 120 秒硬截止时终止，已核对记录的进程树没有残留；清理最终保留数量未确认，不据此重复发布或声称清理完成。研究文档不包含在 33 个 Pages 运行文件中。

## 按需 D1 存储与加固依据（2026-09-16）

用户明确要求加固验收并将数据传入 D1，本节取代初始阶段“无 D1 写入”的实现范围。复用卷04的来源/时间契约和采集手册的失败不覆盖有效版本原则。当前 `btc` D1 身份已核对，容量 7.91 MB；新增独立表，不改 K 线、足迹、报告和 LLM 输入表。

- 查询既有金融通道时，同步把成功响应保存为该平台、操作、规范参数组合的最新快照；D1 可复用仍在来源 TTL 内的结果。独立的 stored/status 查询只读 D1，不触发上游。保留原生时间与单位，不宣称已完成规范化。
- 原生事件/发布日期仍在来源载荷内；receivedAt 为真正上游接收时间，storedAt 单列。仅保存最新快照，当前不是完整历史库或自动全市场采集。无新增 Cron。
- [D1 官方限制](https://developers.cloudflare.com/d1/platform/limits/)为单行/字符串 2,000,000 bytes、单 SQL 100 KB、100 个绑定参数。官方资料优先于本机 Skill 中过时的 1 MB 表述。较大载荷拆为有序片段，使用 [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) 事务同时替换内容和元数据；失败保留上次成功快照。
- 限流遵守 Retry-After；失败冷却防止同一查询反复消耗额度。错误状态只保存固定分类和数值，不保存上游错误原文、鉴权 URL 或 Key。D1 失败必须在返回结果中明确，不冒充落库成功。
- CoinGecko 复核发现领取页同时显示掩码与完整请求示例；旧配置误取掩码前缀。改用明确的完整 Key 字段；今后配置验收不能只看某些匿名可读接口成功。
- [Binance 官方 market-data-only 文档](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)明确现货 ticker/klines/depth 可直接使用 `data-api.binance.vision`，据此把现货公开通道改用专用行情主机。期货仍保留独立来源，不替换成现货或其他交易所冒充原源。
- 验证覆盖真实 SQLite 事务、分片还原、Unicode、重复采集、较旧响应竞争、失败保留、冷却、存储故障；线上逐操作取得响应后通过独立 D1 读取接口核对来源、时间、参数和完整载荷，再以远程 SQL 汇总复核。

## D1 接口使用与最终验收（2026-09-16 15:33 北京时间）

| 入口 | 行为 |
| --- | --- |
| `/api/finance/{provider}/{operation}` | 使用已验证参数按需取数；命中新鲜 D1 缓存时不访问上游；成功响应同步保存并读回后才返回 `storage.persisted=true` |
| `/api/finance/stored/{provider}/{operation}` | 仅从 D1 读取最近成功快照；接受相同参数，不请求上游，过期状态明确标记为 stale |
| `/api/finance/status` | 只读 D1；列出保存数量、载荷字节数、最近尝试/成功时间和错误状态，不返回 API Key |

`FINANCE_D1_ENABLED=true` 已在生产启用。专用表为 `finance_channel_state`、`finance_snapshot_chunks`，只保留每组规范参数最近成功响应；这不是全量历史仓库，也没有为新增金融通道启动后台轮询。接收时间、保存时间和原生观测时间分开，失败不替换有效快照。关闭开关可停止该通道存储，不需要删除数据或回退既有市场表。

- 全量 84 操作验收：**61 PASS、23 FAIL、0 PENDING**。61 项均完成真实取数、D1 写入、独立读回以及载荷/参数/时间一致性比较。失败不作为成功数据入库。
- 最终远程 SQL：83 个查询状态、61 个成功快照、68 个内容分片、2,318,095 bytes 载荷，孤立分片为 0。剩余一个 USDⓈ-M klines 在最终探测时发生客户端连接失败，没有伪造一条服务器采集记录。
- SEC 两项均成功；CoinGecko 三项均成功，已修正此前误取领取页掩码前缀的问题。其余已配置免费 Key 均保留；Alpha Vantage 完整 Key 重新核对后仍返回免费额度限流。

| 未通过范围 | 证据与限制 |
| --- | --- |
| Binance spot 3、USDⓈ-M 6、Bitget 1 | 观察到上游 403；USDⓈ-M klines 末次为客户端网络失败，早前为 403。官方现货只读域名同样被当前 CF 出口拒绝；未用其他交易所数据冒充该来源 |
| OKX klines、Deribit 4、CoinPaprika 2、DEX Screener、BLS、Alpha Vantage | 共 10 项额度/速率限制；CoinPaprika 原始 402，其余 HTTP 429 或 Alpha HTTP 200 限额通知。不申请付费升级，不绕过冷却反复请求 |
| Treasury 2 | 上游 525，TLS/来源服务故障；不关闭证书校验 |
| GDELT articles | 上游未在 12 秒预算内返回，504；未保存空白伪数据 |

这些是当次出口与免费额度条件下的结果，不能表述为“所有 API 都可用”或长期稳定保证。来源恢复、额度窗口重置后，可用现有 `--provider` / `--operation` 参数定向复测，成功后自动保存 D1。

验证：`npm run build` 通过；金融契约 18 项 + SQLite 存储 9 项通过；研究导航和 CodeGraph 状态通过；原 `/api/d1/status` 最终 HTTP 200。全量及定向报告在 `.artifacts/finance-channels/`，汇总为 `acceptance.json`，不含 Key 或源数据正文。

发布：最终 Worker `50839539-ffb2-4b04-9452-fabf434a3414`、100% 流量，目录版本 `2026-09-16.2`。曾在控制台旧页面保存 Secret 时带回旧代码，最终检查发现后重新发布已验收代码；D1 数据保留，最终版本的 SEC/CoinGecko 读回已再次通过。操作经验：代码发布后应刷新控制台生产页再编辑变量，变量保存后也要验证代码版本与接口，不能只检查 Secret 名字存在。

Pages `8b7aea6e.bit-trading-desk.pages.dev` 和生产 pages.dev 均为 HTTP 200、包含入口脚本；自定义域名仍按现有配置跳转 Cloudflare Access。既有旧部署清理达到 120 秒上限，已终止本次精确进程树并确认无残留；本次发布成功，旧部署保留数量尚未全部收敛。本轮没有前端运行文件改动、没有购买 API 套餐、没有新增 Cron、没有 Git 提交或推送。

需要回退功能时，优先设置 `FINANCE_D1_ENABLED=false` 并保持当前代码和 Secret；新表保留。完整回退前版本为 `263684f4-f5c1-497a-8fb8-029572edc764`，但其不含最后一次 Alpha 绑定复核；因此不要盲目回退旧版本覆盖当前密钥。
