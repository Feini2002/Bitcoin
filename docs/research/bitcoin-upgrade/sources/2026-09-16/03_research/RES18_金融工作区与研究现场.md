# RES18｜金融工作区与研究现场

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 页面组织应该对应研究动作

用户通常需要看变化、核对来源、追问分歧、记录条件和回到旧判断。把图表、新闻和报告各放一页不自动形成工作区；关键是它们共享哪个instrument、时间窗口、数据版本和问题。

FDC3用context与intent组织金融应用互操作；Perspective提供分析表格；Lightweight Charts与KLineChart是不同图表候选。可借鉴共享语义，不必把完整终端运行环境搬到单个网站。[EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3) [EXT075｜Perspective 官方仓库](https://github.com/perspective-dev/perspective) [EXT134｜Lightweight Charts 仓库](https://github.com/tradingview/lightweight-charts) [EXT135｜KLineChart 仓库](https://github.com/klinecharts/KLineChart)

## 2. Research View不是滚动位置

研究现场建议包含绝对时间范围、instrument/来源集合、指标参数与方法版本、输入包/报告ID、所选事件与标注。滚动位置和barSpacing只是显示偏好，随着数据窗口滚动不能保证回到相同事实。

恢复等级可分完整、聚合重建、部分、不可恢复，注明原因。旧数据被合规清理或从未保存时，允许链接仍打开但解释缺失；不能默认改为最新价格冒充原现场。

## 3. 信息密度与逐层展开

第一屏显示少量重要变化、冲突和下一检查点，展开后给数值分解、原始来源和方法。复杂表格用于探索，不作为所有用户的首屏。所有变化卡有“为何显示”，所有被抑制事件保留可审计原因与抽查路径。

颜色只表达已定义状态，不代替“买/卖”判断。估计值、缺失值和已确认观测使用不同文本标记。没有重大变化与关键来源停采必须视觉和文案上分开。

## 4. 交互架构选择

单站可用现有hash路由、typed事件总线和统一view对象，不需要完整FDC3实现。多个独立应用需要共享研究上下文时，标准化context/intent更有意义。数据权限始终由后端决定，不能因为跨面板打开就取得原来无权查看的全文。

图表升级与工作区设计分开验收。当前组件足够就保留；若候选能明显改善标注和恢复，再做版本兼容、历史链接和导出迁移。不要同时长期维护两份指标计算和两套图表状态真值。

## 5. 预警是可追溯状态变化

阈值首次触发、持续满足、恢复、冷却和数据降级分开。每条预警指向证据和规则版本，轮询重复不产生重复事件。历史修订可以附更正，不静默重写原预警。

先做站内记录，再决定外部通知。通知越多不代表覆盖越好；评价误报、漏掉重要变化、打断负担和用户实际核对时间。若用户不能说出预警让他少做了哪种重复检查，该规则可能应退役。


## 证据与进一步核验

[EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3) [EXT075｜Perspective 官方仓库](https://github.com/perspective-dev/perspective) [EXT134｜Lightweight Charts 仓库](https://github.com/tradingview/lightweight-charts) [EXT135｜KLineChart 仓库](https://github.com/klinecharts/KLineChart)

