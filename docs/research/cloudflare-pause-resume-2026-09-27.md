# 云端开关：暂停与继续开发

## 当前暂停：2026-10-05

- 后续成本复盘见 [D1 重复扫描事故与修复方案](d1-cost-postmortem-repair-plan-2026-10-05.md)，最新[本地实施](d1-cost-repair-implementation-2026-10-06.md)已修正短路、版本选择和原子提交。旧业务恢复版仍含高扫描路径，已由costIncident阻止resume与预检误报可恢复；未替换远程恢复点。用户选择暂不增加云测试用量，候选登记/迁移与真实计费验收留待明确恢复准备，不得删除标记直接恢复旧版。
- 用户要求暂时关闭 BTC 系统以停止持续使用费用；核对账号还有其他项目后，用户明确选择“只关闭 BTC，保留其他系统及账号共用订阅”。Workers Paid、R2 Paid、Images Stream Basic 未取消，其他项目未修改。
- 北京时间 2026-10-05 20:39:32 完成暂停验证。三个 Worker 的 Cron、workers.dev 和预览入口全部关闭，BTC/舆情自定义 API 域解绑，舆情 route 不再绑定 Worker；BTC 切到无外连、取消 alarm 的维护版。三个 D1、两个 SQLite DO 命名空间和 Pages 静态文件保留。
- 本周期正式恢复点：BTC `e42aa488-463f-4505-9096-d9bcebe3eef3`；维护版 `9180e712-a75f-411b-8f14-02e68ec90663`。恢复以 `cloudflare/cloud-control-state.json` 为准，不使用下文历史版本。
- 首轮观察仍有收尾写入，未宣称成功；状态读回确认开关和维护版一致后，续做同一暂停流程。第二轮 12:37:24–12:39:32 UTC 五次采样相同，stable=true、advanced=false；行情最新存储时点停在 12:34:34.481 UTC。公网状态/健康地址分别返回 BTC 530、舆情 530、快照 404。进程监督器确认退出和清理完成。
- 本机证据：`.artifacts/cloud-control/1791203822386-pause.json`、`1791203800235-status.json`、`btc-resources-2026-10-05.json`。三个 D1 合计 468,504,576 字节；当时账户账单显示 D1 存储费用 $0，已累计用量费约 $14.51（账号总额，不等于 BTC 独立账单，也不含完整未来账单）。
- 费用边界：本次停止 BTC 采集与业务接口，不保证账号未来账单为零；已发生费用仍可能后续结算，共用付费订阅继续生效，保留存储仍占账号额度。D1 存储按账号总量计算，不能把当前 $0 推断为永久免费。Pages 静态资产请求免费，静态壳仍可访问，但不再提供已关闭的后端服务。VPS 不在本次 CF 关停范围内。
- 官方依据（查询 2026-10-05）：[D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)、[Pages 静态资产计费](https://developers.cloudflare.com/pages/functions/pricing/)、[取消订阅及生效时间](https://developers.cloudflare.com/billing/manage/cancel-subscription/)。本次未发布本地业务改动，未删除历史数据，未执行远程迁移，未 commit/push。未经用户明确恢复，不部署业务 Worker 或重新开启采集。

历史恢复状态（2026-09-29 05:24 UTC）：用户要求恢复后，三个 Worker 已恢复入口，BTC 每分钟 Cron 恢复，舆情与快照 Cron 仍为空。三服务健康检查和入库观察通过，当时恢复记录为 active；BTC 恢复点当时更新为修复版 `e8e58e2f-b4a3-4895-bc43-00ed4f1ee461`。足迹已追至当时且正常调度继续推进；详见[持续采集核验](workbench-recovery-2026-09-29.md)。下文 2026-09-27 暂停结果仅作历史。

## 直接这样说

- **“开起来” / “恢复云端”**：恢复最近一次暂停前的云端业务版本、网址和采集任务，检查行情重新入库，然后继续开发。
- **“暂停云端” / “关起来”**：保存当前恢复点，关闭三个 Worker 的入口和定时任务，将 BTC 切到不采集的维护版本，并观察写入是否停止。
- **“看看现在开着没” / “查看云端状态”**：只读查询，不启动采集。
- 这些话在本仓库上下文中由 Codex 执行；不需要用户记命令。2026-09-27 15:55 UTC 曾暂停：三个 Worker 入口和 BTC 定时任务关闭，BTC 切到不采集维护版，五次采样写入不再变化；2026-09-29 已恢复并更新业务版本。后续暂停重新保存届时正式版本，恢复只用实际记录，不能沿用旧日期中的版本号。实时状态以 `cloud:status` 为准。暂停停止本系统采集，不取消 Cloudflare 付费计划基础费，也不关停同账号的其他项目或东京 VPS。

## 固定执行入口

| 意图 | 仓库命令 | 验证结果 |
| --- | --- | --- |
| 查看 | `npm run cloud:status` | 当前三个 Worker 的版本、Cron、网址开关；发现部分状态返回非零 |
| 开启 | `npm run cloud:resume` | 校验恢复版本与存储，恢复入口，唤醒原采集器，观察实时写入推进 |
| 暂停 | `npm run cloud:pause` | 保存当前版本，关闭入口和后台采集，五次只读采样确认状态不再变化 |
| 只预检恢复 | `npm run cloud:resume -- --dry-run` | 校验云端恢复版本、D1、DO 命名空间和入口归属，无云端修改 |
| 离线模拟 | `npm run verify:cloud-control` | 假接口重放往返、重试、漂移及失败路径；不登录、不访问云端 |

实现是 `scripts/cloud-control.cjs`，维护模块是 `cloudflare/btc-maintenance.mjs`。恢复记录在 **`cloudflare/cloud-control-state.json`**，属于项目文件，只有账号/资源标识、版本、开关和绑定名称，没有变量值或密钥。每次实际开关会原子更新记录，并在 `.artifacts/cloud-control/` 留一份旧记录及结果。本次暂停的维护版是 `be22bb8a-0d6b-4ce6-be08-5ce2038fe95c`。备份仓库时一并保留最新记录，不要用更旧的 Git 版本覆盖它。

首次种子来自 2026-09-26 14:56 UTC 的实际云端快照，暂停后 BTC 为 `ac658af6-b9b6-43b0-a114-0a4136ed5e8a`，正式恢复点为 `93dc9cff-7279-4773-b7c0-d4a094212eca`。以后每个新暂停周期保存当时最新正式版本，不固定回退到这两个版本。中途失败保留 `pausing` / `resuming` 和恢复点；先读状态，再执行同一意图续做。不会自动反向操作来掩盖失败。

## 恢复范围与真实限制

- 涉及 `btc`、`yuqing`、`market-snapshot`，BTC 每分钟 Cron 恢复；**舆情和快照原本就没有 Cron，保持为空**。恢复两个自定义 API 域名、舆情 route 及原 workers.dev / preview 设置。
- 暂停时切换 BTC 云端维护版本，删除的是采集器闹钟，不是数据库数据。仅关 Cron 与域名无法停止既有 Durable Object 外连，这是 2026-09-26 的真实运行观察。
- 不部署本地尚未发布的业务修改，不做 D1 建表、迁移、清库，不删除 Worker 或命名空间，不改其他账号项目、Pages 静态网站和 VPS。已取消的舆情模型自动报告保持取消。
- 运行态发布新业务代码后，下一次暂停会重新保存版本与入口；如果在暂停期间用其他工具改了版本或绑定，脚本停止并报告差异，交由 Codex 核对，不猜测覆盖。
- 暂停期间缺失的实时强平、盘口等不能凭空补回。恢复后沿用现有有界回补，不能把“开起来”解释成一次性重采所有历史；正常采集频率与既有费用治理保持原样。
- 登录沿用本机 Wrangler 官方登录，只在内存使用认证，不读取浏览器 Cookie。登录失效时需要重新完成 `npm run cf -- login`，无需把密钥发给 Codex。
- 单次 HTTP 最长 20 秒，单次运行内部硬截止 8 分钟；采集验证约两分钟，每轮观察不超过 30 秒。过程输出 PID、阶段、样本和结果。到期或中断后先核对状态，不能盲目启动另一轮。
- 本机锁避免同机操作重叠，不是跨电脑分布式锁；开关期间不要在另一电脑/控制台同时发布。Cloudflare 传播或上游/VPS 故障可能让检查暂未通过，届时报告“入口已恢复但采集待确认”，不宣称成功。
- Cloudflare 付费计划基础费和已有 VPS 固定费不因暂停取消；此开关停止本系统采集，不是账号账单清零开关。

## 核验依据与查询日期

- 查询：2026-09-27 北京时间（2026-09-26 UTC）；适用 Wrangler 4.85.0、当前三个 Worker / 两个 DO 类。账户及存储标识以恢复记录和现场 API 为准。
- [Worker 自定义域绑定 API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)：使用账号下的 PUT，带 hostname、service、zone_id；以域名/服务归属验证恢复，不假设解绑后证书或域名记录 ID 不变。
- [版本恢复及限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)：已发布版本可重新部署；外部资源变化或版本可恢复范围会限制回退。因此每次恢复前实际 GET 版本和资源，不把本地 UUID 当作恢复成功证明。原文短摘录："You can only roll back to the 100 most recently published versions."
- [上传元数据](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)与[创建版本 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/)：沿用已验证的 keep_bindings，保留云端变量与秘密，保留 D1/DO 标识；不提供迁移或删除类操作。
- [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)与[WebSocket 生命周期](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)：暂停模块取消闹钟、不连接上游；版本切换与短期写入观察共同用于验证。
- [Cron 传播](https://developers.cloudflare.com/workers/configuration/cron-triggers/)：开关传播可能耗时；入口读回和真实数据推进是两项不同证据。
- 本仓库前置依据：[治理后的正确性修复](cloudflare-governance-correctness-2026-09-26.md)。原始脱敏运行快照保存在 `.artifacts/plans/cloudflare-pause-before-all-2026-09-26.json` 和 `cloudflare-pause-final-2026-09-26.json`；正式恢复信息已转存项目文件，不依赖临时目录。

## 本次验证边界

- 本轮保持暂停，只允许离线模拟和现场只读状态/恢复预检；没有为了测试而临时开采集。
- 验收：15 个离线场景通过；`npm run build`、资料导航检查通过。2026-09-26 16:16 UTC 真实 `cloud:resume -- --dry-run` 返回 `ready: true`；16:17:46 UTC 真实 `cloud:status` 返回 `paused`，三 Worker 的版本与开关符合暂停记录。证据位于 `.artifacts/cloud-control/`。
- 完整真实开启的入口、证书传播、上游连通与写入验证，在用户下次明确说“开起来”时执行。模拟通过不等于已完成真实开启。
