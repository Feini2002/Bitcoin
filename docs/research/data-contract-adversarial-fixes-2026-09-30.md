# 数据契约交叉审查修复检查点

本轮在桌面既有未提交工作树上局部合并，未部署、推送、修改生产数据或认证。
七组新增离线负例与十项数据/证据测试程序均通过；日志为工作目录 `.artifacts/implementation/data-adversarial-regression.log`。

## 修复与接口

1. `BitEvidenceBundle.build()` 增加 `capabilityReadiness`、`taskReadiness`、`roleReadiness`、`asOfComplete`。环境顶层 quality=pass 不能替代宏观、OI、期权分项就绪。可选 `requirements={capabilities:[id],roles:{role:[id]}}` 绑定所需数据能力并参与冻结哈希；未知能力拒绝就绪。未传 requirements 保留保守的四工作台检查。能力例：`context.contract.premium`、`context.positioning.oi`、`context.reference.fred-dgs10`、`context.options.BTC.summary`、`context.options.BTC.greeks`。`reference` 仅表示带时间、收据与来源的报告观测，不能保证发布进度最新；`latest` 要求来源/采集新鲜度明确验证，unknown 保留 null。
2. 足迹构建排除超截止的事件、收据、采集尝试和行时间，不允许负 age 判 fresh。`collectorAttemptAt` 与真实 `receivedAt` 分开；缺真实收据保持 null。`historicalEligibility.eligible=false` 明确聚合版本不是完整原始成交回放。未来行通过实际 SQL→映射→构建路径保留并筛除。
3. NYFed 旧边缘缓存必须通过版本、receipt 年龄、provider/operation、成功状态与精确参数核对，不能仅把旧 6h 条目标成新 1h TTL。D1 路径继续独立于边缘缓存。
4. Deribit 元数据/摘要严格对账 BTC 与 BTC_USDC 名称组、请求币种、base/kind/settlement/option type。归一化拒绝错误混入；覆盖读取也排除并报告旧错误行。保存的真实公开收据回放验证 BTC 946/946、USDC BTC 612/612 元数据与摘要，错误、遗漏和多余合约均为 0；这仅证明该两次快照的摘要对账，不证明全链 Greeks 或全天连续性。
5. `financeSnapshotKey()` 收敛 camelCase 与 snake_case 历史窗口为有界槽，同时保留精确请求身份。来源/操作级冷却读取现有失败行，改变时间窗口也不能绕过，旧动态键同样受控。未删除生产旧键，未新增生产迁移。
6. 内容版本只过滤明确 desk 顶层包络读时钟，不递归丢弃 native source 的 generatedAt/readAt/inputRevision 等同名实质字段。desk schemaVersion 为 2026-09-30.3，inputRevisionMethod 为 desk-content.v3/canonical-json-sha256.v1。

## 验证边界与续接

- `verify-data-adversarial.cjs` 七组均通过，真实 SQLite 验证有界槽、429 冷却及旧键兼容，所有网络请求均为本地合成 fixture。
- 其余定向回归覆盖 finance channels/storage/datasets/source coverage/incremental、desk assembly、funding cutoff、refresh cadence、evidence freeze。
- 上轮完整 build 已通过；本轮新增修复之后仍需再跑完整 build。既有十项浏览器基线已经通过，不重复当作新 UI 验收。
- asOf 查询仍由 knownAt 推导，独立不同事件截止没有实现；冻结包不再把不匹配 asOf 标为可分析。
- 云端 UI/research 候选 ZIP 尚未物化/合并。Library 官方 helper 的 os.setxattr 在本机 Windows 不可用，不能把 prepare_materialize 返回描述当下载成功；需要支持的物化流程或可直接读取的正常源代码交接。
