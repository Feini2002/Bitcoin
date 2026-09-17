> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# CASE14｜开源商业服务和受限搜索的分界

资料核验：2026-09-16。这里分析已公开的产品/方法，不声称实际使用过产品，也不复制其商业实现。


## 来源事实
Google Search Grounding具有独立用途和留存规则，Tardis条款区分供应商与独立直采数据，Firecrawl自托管/云服务不完全等同，Coinbase数据分发有专门要求。

## 重要启示
同一系统里的内容可能走不同权利路径：实时回答可用的结果未必可长期索引；允许内部研究的数据未必可公开图表；SDK开源不授权服务数据。权利判断必须绑定具体来源、取得方式、用途和日期。

## 错误的简化
“算成指标就能随便传模型”“用开源爬虫就能保存全文”“只要不开训练就不受限制”“数据库加allowed字段就有授权”都不能成立。反过来，也不能把条款中有例外的情况一概说成绝对禁止。

## 可执行设计
来源配置按取得、原文保存、派生保存、模型输入、显示、导出分别保存证据；unknown保持禁用对应动作，但不必关闭其他获准数据功能。现有供应商合同需要人工或明确审查，不由LLM猜。

## 验收
同一条来源在不同用途得到不同正确决策，撤销后缓存/索引/报告访问跟随政策，历史恢复等级诚实变化。此案例提供工程边界，不替代具体合同法律意见。


## 原始依据

[EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms) [EXT066｜Tardis 服务条款](https://docs.tardis.dev/legal/terms-of-service) [EXT023｜Firecrawl 自托管文档](https://docs.firecrawl.dev/contributing/self-host) [EXT127｜Coinbase 市场数据条款](https://www.coinbase.com/en-nl/legal/market_data)
