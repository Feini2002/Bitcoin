# CASE10｜Qlib与arch如何服务实验纪律

资料核验：2026-09-16。这里分析已公开的产品/方法，不声称实际使用过产品，也不复制其商业实现。


## 来源事实
Qlib有工作流/记录器，arch提供依赖结构下的重采样，概率校准有明确评价方法。这些工具负责组织和计算，不提供研究问题本身。

## 可迁移流程
先定义事件/标签与窗口，固定数据版本，预先拆训练/开发/时间后测试，再记录全部参数与失败尝试。估计不确定性时保留区块长度和事件簇，而不是只展示最窄区间。

## 反例
在全样本选最好阈值，再报告同样本夏普或命中率，是选择偏差；窗口重叠会夸大样本量；对稳定规则反复改测试集最终也会泄漏。

## 小实验
给同一个条件规则做简单脚本与平台工作流对照，结果应在声明精度内一致。平台的价值是少遗漏实验记录和复现步骤，而不是跑得出更高结果。

## 采用边界
少量事件研究先用简单计算与清单；大量实验确实需要管理时再采用平台。预测模块无前瞻记录就不恢复“72%置信度”外观；先用可解释条件输出。


## 原始依据

[EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT086｜arch 时间序列Bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html) [EXT087｜scikit-learn 概率校准](https://scikit-learn.org/stable/modules/calibration.html)
