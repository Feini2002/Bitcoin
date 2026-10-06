# D1 异常读取修复：本地实施与验收

日期：2026-10-05晚至2026-10-06凌晨，北京时间。依据：[事故方案 v6](d1-cost-postmortem-repair-plan-2026-10-05.md)、[开发检测](cloud-read-detection-2026-10-05.md)。风险 L3：修改持久数据提交、读取成本及恢复行为；当前交付限定本地，不是上线完成。

用户已明确要求“深度执行上述方案”，随后明确选择“先完成本地，暂不增加云端测试用量”。因此本次没有新建测试云资源，没有生产 D1 写入、索引迁移、业务部署、恢复、清库、模型运行或 Git 提交。已有其他前端/Agent改动保留。

## 1. 已实施范围

| 阶段 | 本地实现 | 验收边界 |
| --- | --- | --- |
| P0 | D1语句和事务的 rows_read、rows_written、changes 汇总；K线预检也计入操作；输入、采用回执、重复、迟到、收盘与缓存修订计数；按操作/数据集在内存聚合，常规每分钟输出一次、失败每窗口首次报告 | 元数据缺失或失败成本标为 UNKNOWN，不按0；日志不是账号总额度或跨实例硬限额，无 D1 审计表 |
| P1 | canonical/raw 初始化改为明确 CASE 短路；历史 baseline 同样显式短路 | baseline原来暖态已经便宜，不能算成新增已证实热点；保留冷态已有历史发现和revision |
| P2a | 仅 Binance USD-M 七周期K线维护图表历史状态，自动覆盖scheduler gap与bootstrap调用；其他产品不再碰共享图表状态 | 旧状态行保留；提供有界派生head修复SQL，未在生产执行 |
| P2（有界版本读取） | K线有效版本、明确收盘证明使用两个局部索引；成功时间只从实际胜出回执产生；K线调度最新两点和按保留数量清理改为有界键查找 | 新索引增加相关回执写入和存储；未采用方案中暂缓的P2b通用跨产品状态表；本地验收通过不证明真实D1成本目标已达标 |
| P2c | 实时行情和补采的规范值、raw投影、head/revision、成功状态合并到同一D1 batch；500根一批，6000根最多12批；失败保持明确未完成且原回执可重试 | 整个6000根不承诺一次事务；完整恢复checkpoint仍由原DO恢复机制在全部覆盖后确认 |
| P3 | 新增实际SQLite约束失败、竞争回执、第二分片失败/原回执重试、版本/历史分轴矩阵；纳入verify:all | 真实D1、Worker binding并发、真实24小时成本尚未验收；已准备云端隔离测试命令但按用户选择未执行 |
| P4 | 拒绝恢复已证实有问题的旧BTC版本；可选固定绝对试运行截止覆盖Worker API/Cron、DO连接、闹钟、重连及K线新批次；重启不续期 | 未配置或启动试运行；候选上传/登记、最近100版本中的维护版可部署性、迁移预算和生产恢复还未完成 |

## 2. 写入与数据正确性

- 原先实时调用先写raw，再标成功，最后写canonical。新入口 `kline-commit.mjs` 先构造所有SQL，再一次提交；raw从该事务内实际胜出的canonical记录投影，避免两份价格互相矛盾。
- 普通forming旧回执不能替换更新回执或已收盘版本。过时REST的不可变回执仍保留来源证据，通过 `supersededByWs` 标记退出当前版本选择；当前读、bounded读和raw投影使用一致规则。它也不能刷新成功时间。
- REST请求开始时间晚于有效WS回执时，仍允许真实历史修订。已经存在的收盘证明跨REST保存；重试之间新取得的证明不改变原始REST正文身份，不把同一回执误报内容冲突。
- 不可变身份相同但正文冲突时，预检和事务内约束共同拒绝。事务内利用既有 value_json NOT NULL 约束强制冲突回滚，不添加锁表或写入队列。不同取得时点的真实证据继续保留。
- 第二分片失败时第一分片是已经完成的原子成果；成功状态/规范集HTTP状态标为未完成。失败标记不把最近成功时间改成“刚刚”，使用原receivedAt重试可以收敛。DO持久checkpoint不会因部分数据推进而提前确认。
- 重启读取恢复游标时，取raw与canonical较早的已存在头；任一表示缺失时要求完整恢复。保留现有每周期顺序、三周期并发、5秒写入下限和正常补缺频率。
- 仅修复派生head的SQL按七个周期分别索引定位真实raw/canonical头，必要时纠正错误的超前head并增加revision；不把revision归零，不修改事实表，不删除旧其他产品状态。

## 3. 成本与规模证据

本机Node SQLite 3.53.1，独立Python SQLite 3.50.4。同一组生成SQL分别执行；历史轴H=800/8,000/80,000固定V=1；版本轴V=1/10/100固定20个键，没有运行80,000×100的大笛卡尔积。

两轴检查实际结果、有效版本索引和暖态行为。最终代码在北京时间2026-10-06 00:22通过两引擎复核：六组场景的代表性单根已收盘提交均为 **1,524个SQLite VM步骤**，历史轴扩大100倍、版本轴扩大100倍没有增加该例工作量。Python通过progress handler记录该写入（含预检、诊断统计、投影、状态）。VM步数是本地运算证据，**不是D1 Rows Read**，也不是所有任务的负载画像。运行结果见本机 `.artifacts/d1-cost-repair/scale-results-cross-engine.json`；Node独立结果见 `scale-results-node.json`。

两个新局部索引：`idx_finance_kline_winner`用于闭合优先、真实取得时点排序；`idx_finance_kline_confirmed`用于按键寻找明确收盘证明。生产尚无本次迁移。SQL保持在旧schema上能执行，不能据此声称没有索引时也具备相同成本。迁移创建索引本身的读取、写入和存储必须在未来发布预算内。

新的正常日志事件为 `d1_cost_window`，失败为 `d1_cost_failure`。采用数表示实际写入/更新的规范回执，不等于新K线根数、有效研究结论数或交易收益。修订数表示缓存版本变更，不等于市场事实条数。来源正文、SQL文本、请求参数、凭据不进入这组日志。

## 4. 实际验证与对抗修订

| 检查 | 结果／处理 |
| --- | --- |
| 现有金融链路29项增量测试 | PASS；宏观A→B→A、knownAt、收盘证明、范围/补缺、旧历史revision等保持 |
| verify:finance | PASS；含现有来源、存储、调度、desk和刷新频率契约 |
| 真实SQLite事务回归 | PASS；raw写入约束在canonical之后失败，两个值与head/revision回滚，旧成功状态失效 |
| 两个竞争写者 | PASS本地序列化事务/交错预检；冲突身份只能有一方提交，不冒充真实D1跨isolate并发 |
| 501根第二分片失败 | PASS；留下完整的500根两种表示和未完成状态；原回执重试收敛为501根 |
| 过时回执与新鲜度 | PASS；保留旧REST证据，不能覆盖新WS或刷新success；后来的有效REST可修订 |
| spot/macro状态与head修复 | PASS；不维护perp图表状态；派生head修正后revision递增且重复执行幂等 |
| verify:footprint | PASS；原采集时序、恢复、重连、三周期并发、退休旧DO保持；夹具补上实际运行必需的canonical表 |
| 固定截止 | PASS离线；实际Worker API/Cron、DO alarm/wake、四条socket、重连和重启，过期入口零网络/D1调用 |
| 全量build | PASS；`npm run build`包含lint、verify:all及73个Pages运行文件构建；监督器返回退出0并确认派生进程清理 |
| 双引擎规模检查 | PASS；`npm run verify:d1-cost:cross`，最终六组均1,524 VM步骤；不声称真实D1计费通过 |
| 开发收尾云端检测 | ALERT；`npm run cloud:reads`返回告警退出2，已立即向用户汇报；精确窗口和原因见下节 |

迭代中保留并修正三类反例：最初过滤过时REST会丢失证据，改为保留且不选用；失败记录若覆盖last_run会让原回执重试不能清除失败，改为保留成功时点；只保护价格仍可能让旧REST刷新成功时间，改为实际胜出回执门槛。测试失败没有被重试掩盖，均有对应实质修正或明确的夹具修正。

## 5. 云端与后续精确步骤

- 只读控制面在2026-10-05 23:49北京时间确认三个Worker仍暂停：无Cron、workers.dev与previews关闭、无项目自定义域、舆情route已解绑；BTC仍为维护版 `9180e712-a75f-411b-8f14-02e68ec90663`。
- 收尾Analytics查询于2026-10-06 00:22:52北京时间完成：最近窗口为00:02–00:17（右端不含），三个库均无可核验活动记录，标为REVIEW而非零用量。过去24小时窗口为2026-10-05 00:17至10-06 00:17，读取 **5,706,866,683行**，超过1亿/日开发告警线：BTC库5,706,861,435行，舆情库5,248行，快照库没有返回该窗口记录。该窗口包含暂停前用量，不能把该告警当作暂停后仍读取的证据，也不能据空记录承诺零账单。最终本地检测不再命中原三类已知重复扫描形态；静态检查不是线上修复证据。
- 旧恢复业务版 `e42aa488-463f-4505-9096-d9bcebe3eef3` 被本地控制器列为已知异常版本，普通resume和dry-run都明确拒绝。原恢复记录及绑定保留，不能手工删除标记来绕过成本修复。
- `npm run cloud:reads:benchmark` 默认只输出方案。未来明确允许云测试后才加 `-- --run`：新建一次性独立D1，合成H=10/100/1000与V=1/10/100，10M读取/100k写入预算、每请求预留、未知成本停止、删除仅本次创建的数据库。脚本未在线验收，REST接口结果也不能冒充Worker binding生命周期与真实DO测试。
- 当前跳过生产API smoke，因为旧暂停系统上的业务探测可能触发读穿/采集，不以生产不可用当作本地失败或擅自恢复理由。没有运行以前已崩溃的相同workerd环境来伪造新证据。
- 恢复前还必须：隔离D1实测完整事务/失败与索引成本；准备明确版本候选及登记支持、检查绑定/预览隔离和维护版可部署性；按授权迁移索引和派生head；拟定实际试运行负载、停止预算与固定绝对截止；明确开启后才恢复并完成真实24小时成本验收。
- `BTC_TRIAL_END_AT`仅是绝对时间闸门，不是全账号费用硬上限。已经启动的有界事务/请求可能在截止后完成；外部暂停脚本及控制面/用量读回仍是最终停机措施，不能宣传“到点账单立即归零”。

## 6. 相关文件与来源

- 业务：`cloudflare/finance/dataset-store.mjs`、`kline-commit.mjs`、`d1-cost.mjs`、`dataset-schema.sql`、两份候选迁移SQL、`scheduler.mjs`、`cloudflare/kline-live-collector.mjs`、`binance-klines-worker.js`、`cloud-trial.mjs`。
- 开发与运维：`scripts/operations/cloud-control.cjs`、`cloudflare/cloud-control-state.json`、隔离测试脚本、`package.json`、新增/更新的集成测试和规模夹具。
- 官方核验日期2026-10-05：[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1限制](https://developers.cloudflare.com/d1/platform/limits/)（SQL100KB、绑定100、Paid每调用1000查询）、[D1 REST query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)、[SQLite CASE](https://www.sqlite.org/lang_expr.html#the_case_expression)。官方性质与本地测试结果分别记录，不猜测当前D1引擎版本。

## 7. 本地交付证据与完成界限

- 全量构建日志：`.artifacts/d1-cost-repair/build-final.log`。监督器PID25116、子进程23796，退出0，清理confirmed。
- 最终规模回归日志：`.artifacts/d1-cost-repair/cross-final.log`。监督器PID2600、子进程33176，退出0，清理confirmed。
- 本次收尾云端只读报告另存为 `.artifacts/d1-cost-repair/cloud-reads-final.json` 与同名 `.md`，避免后续latest报告覆盖现场；检查子进程25500与外层子进程25116均返回告警退出2，清理confirmed。这是检测正常捕获既有历史告警，不是检查工具成功后被忽略的错误。
- 本轮完成本地根因修复和离线验收，保持生产暂停。P3真实D1计费/并发/完整日负载与P4发布流程尚未完成；候选上传登记能力、实际迁移及恢复列入下一次获准云端验证后的工作，不能把本记录作为直接恢复凭证。
