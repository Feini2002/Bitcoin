> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES13｜因子事件研究与可复现验证

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 描述、关联、预测与因果分开

描述回答样本发生了什么；关联比较条件与结果；预测要在目标之前提交输出；因果需要识别假设。一个框架支持backtest，不代表这四类结论都已被证明。

Qlib提供实验工作流，arch提供统计重采样，DoWhy明确区分因果建模、识别、估计与反驳。分别复用它们擅长的部分，不能让工具替代研究定义。[EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT086｜arch 时间序列Bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html) [EXT088｜DoWhy 因果效应工作流](https://www.pywhy.org/dowhy/main/user_guide/causal_tasks/estimating_causal_effects/index.html)

## 2. 一个实验需要的最小记录

保存research_question、研究对象、输入数据版本、事件或标签定义、特征方法、拟合区间、验证区间、参数尝试、样本筛选与结果。训练、阈值选择、标准化只能在相应训练/开发数据中完成，不能先用全样本分位数再宣称测试独立。

事件窗口重叠会制造样本依赖；同一公告被多家转载不能算多个事件。保留未成功的假设和参数，避免只记录最漂亮的结果。退市/到期合约的历史列表也需要按当时状态，BTC研究并非天然没有幸存者偏差。

## 3. 简单基线的实际作用

预测涨跌时，始终预测基础频率、简单趋势/波动规则或随机无信息基线能揭示复杂方法的真实增量。解释型产品则用确定性事实模板：如果LLM只是重复数字，没有补充可核验的分歧与反证，就没有证明增量。

消融应逐个移除信息family，例如价格、成交、杠杆、事件和链上，不把高度相关指标当独立贡献。模型改动与数据扩张分开测试，否则无法解释改善来自哪里。

## 4. 不确定性与依赖

时间序列并非独立抽样；区块Bootstrap可以研究局部依赖，但区块长度、事件簇和制度变化影响结果。样本不足时报告样本量和分布比输出极精细置信区间更诚实。显著性不等于经济意义，也不代表未来不变。

如果研究模拟交易收益，另加信号可见时间、下一可用成交、点差、滑点、费用、资金费和容量假设。只分析事件后收益分布时，不必引入订单执行框架，但必须避免把该分布包装成可实现收益。

## 5. 市场状态检测

ruptures适合离线变点，River适合在线更新/漂移。两者需要不同验证：离线分段可用于复盘，不能把完整样本得到的转折时间当实时信号；在线模型必须先预测、等真实标签可用后再学习。[EXT130｜ruptures 当前仓库](https://github.com/deepcharles/ruptures) [EXT129｜River 当前仓库](https://github.com/online-ml/river)

来源故障、价格回退和日历错位也会造成“状态突变”。先有质量检查，再解释市场状态。没有明确目标和反馈，自动学习只增加难以还原的隐含状态。

## 6. 可复现不止随机种子

数据、方法、配置、时间模式、环境、来源权利与报告都需要关联。环境升级可导致数值细微差异，容差和排序规则预先定义；重跑改变已发布观点必须产生新版本。代码可执行是起点，不是研究结论已可靠的终点。


## 证据与进一步核验

[EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT086｜arch 时间序列Bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html) [EXT088｜DoWhy 因果效应工作流](https://www.pywhy.org/dowhy/main/user_guide/causal_tasks/estimating_causal_effects/index.html) [EXT130｜ruptures 当前仓库](https://github.com/deepcharles/ruptures) [EXT129｜River 当前仓库](https://github.com/online-ml/river)

