# 正式设计契约说明

本目录所有接口、对象和表均为拟议设计，未在用户仓库创建、迁移或部署。先与真实schema、认证、Worker绑定和治理目录核对；优先复用已满足相同业务合同的实现。

## 文件

- `research.schema.json`：Draft 2020-12，37个核心/请求/扩展定义。`$id`使用example.invalid作为不应联网的设计标识；在本地解析$defs，不访问该域名。市场数值为十进制字符串/null；结构合规不等于数值/时间/权限正确。
- `openapi.design.json`：OpenAPI 3.1，39个拟议操作，无servers和真实密钥。ownerSession cookie名称是明确占位，实际认证由WP-001/052绑定。GET不触发模型，写操作按认证、幂等和版本前提执行。
- `research_schema.proposed.sql`：30张新增研究表的SQLite参考DDL。未含真实旧表ALTER、真实migration编号或远程命令。可以按发布scope裁剪，不要求先建完全部表。文档自检只在新建内存SQLite中验证了建表语法，没有连D1。
- `settings.design.json`：未批准的设计样例。预算、价格目录、保留目标为空时不自动启动新增付费或破坏性清理。明确source删除义务另按政策处理，不能以未配置为由无限保存。

## 协议转换

卷07 `research.synthesis.candidate.v1`是模型候选，不等于最终`research.report.v2.1`。由服务端映射observations/conditions/unknowns、解析numeric_refs、保留替代解释并验证；report_id、validated_at和digest不能由模型自认。卷04业务别名映射以卷10为准，未知语义不随便选择enum。

创建ResearchView/Viewpoint/Forecast/Alert使用对应Create定义；owner、创建时间、revision、结果状态由服务器提供。自动预测结算必须使用ResolutionRule，不能执行自由文本条件。ResearchView与Viewpoint是不同对象，观点引用现场revision以避免追随可变head。

## 不能只靠数据库保证的内容

跨owner/跨bundle引用、来源用途、事件可见时间、合约单位、状态/预算与质量必须由应用验证。CAS UPDATE影响0行不是SQL错误，后续INSERT/状态提交必须受同一token/版本成功条件守卫。外部对象存储和D1没有共同事务，final产物必须在manifest/evidence引用成立后发布。细节与负例见卷10第16节、CASE-073/074。

## 验证范围

包内合成样例经过结构、引用和示例算术检查；74个场景的业务expected尚待接入真实实现执行。这里不提供可直接上线的应用，不包含自动安装、真实数据、账号或部署配置。


## 终审修订

RunRequest区分template/model，历史知识截止独立；Bundle记录规范化与实现版本；Report增加初始基线和覆盖不足，nochange需要实际覆盖及比较对象。收集对象根入口和域校验见`../../10_final_review/contract_migration.md`。这些是新写入的设计，不能用当前hash或新字段重写旧报告后宣称过去已经满足。
