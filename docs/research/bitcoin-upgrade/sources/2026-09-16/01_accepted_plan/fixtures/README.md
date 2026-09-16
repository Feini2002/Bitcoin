# 合成验证材料

所有价格、数量、事件、来源身份、policy allowed值、时间和validator字段都是本方案构造的离线样例，不代表真实市场、实际授权或已运行验证。不得导入生产事实池。

`acceptance_cases.synthetic.json`含74个边界/业务场景，每项明确input、expected、invariants和must_not_claim。它们是待接入仓库的验收规格，不是已执行的测试报告。`sample_*.json`给出从合成价格/OI到Metric、Bundle、Report与ResearchView的相互引用；报表为手工设计，不是模型调用输出。

结构检查使用contracts/research.schema.json内对应$defs；跨字段时间、引用、哈希、权限、数值和状态必须另按卷10/11执行域验证。sample_report的content_digest按去除自身content_digest的规范化JSON计算；bundle同理。artifact的locator明确指向sample_metrics.canonical.json，其digest和byte_length针对这个文件的实际字节；sample_metrics.json是同内容的可读副本。摘要profile为btc-ascii-key-json-v1，不声称全量JCS。

`fixture://`是离线位置标识，不能由线上fetch执行。owner_synthetic/source_synthetic/policy_synthetic只供测试，不得映射成真实账号或供应商许可。
