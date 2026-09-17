> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES01｜能力地图与复用决策

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 先判断缺什么能力，不先找框架

金融研究产品可以分成六个问题：能否发现重要信息、能否持续取得并保留允许的材料、能否按正确时间解释数据、能否完成可复算研究、能否把解释交给用户、能否追踪解释后来怎样变化。一个平台通常擅长其中几项，不应由“金融AI”或“研究助手”的命名推断全覆盖。

Qlib的工作流侧重实验与记录；OpenBB侧重金融数据适配；TradingAgents侧重多角色过程；FinRobot公开版本与未公开产品并存。这些是不同复用单位，不是四个可直接互换的BTC分析站。[EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT053｜OpenBB 官方仓库](https://github.com/OpenBB-finance/OpenBB) [EXT046｜TradingAgents 官方仓库](https://github.com/TauricResearch/TradingAgents) [EXT048｜FinRobot 当前README](https://raw.githubusercontent.com/AI4Finance-Foundation/FinRobot/master/README.md)

## 2. 六类车轮子分别怎样验收

| 复用类型 | 获得的东西 | 不随之获得的东西 | 首要验收 |
|---|---|---|---|
| 直接库依赖 | 稳定接口、算法实现、测试资产 | 数据授权、领域适配、维护承诺 | 固定输入输出及版本兼容 |
| 独立服务 | 运行能力、API、隔离边界 | 免费运维、自动容灾 | 中断恢复、状态归属与资源费用 |
| 商业API | 合同范围内的覆盖与维护 | 所有历史、原始方法、再分发权 | 字段样本、覆盖/修订、使用权 |
| 数据规范 | 语义、互操作和边界 | 内容真实性与实际采集 | 表达是否保留必要差异 |
| 论文方法 | 可检验假设与计算逻辑 | 本市场有效性 | 适用条件、基线、样本外 |
| 产品交互 | 用户任务组织方式 | 实现源码或商用授权 | 同任务效率和错误率 |

把规范、方法也算作重要成果，才能避免资料库只剩GitHub仓库链接。特别是新闻版本、引用定位、工作区上下文，IPTC、W3C与FDC3能减少从零定义时的语义遗漏。[EXT041｜IPTC ninjs 用户指南](https://www.iptc.org/std/ninjs/userguide/) [EXT043｜W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) [EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3)

## 3. 一般适用性与仓库适配性是两张表

一个完整RSS平台对没有订阅系统的人可能适合直接部署；对已有事实池的系统则可能只适合外部采集入口。不能因为后者暂时不用，就删除它的研究卡。反过来，与当前JS技术栈相容也不是采用理由：一个纯JS库若只解决很少发生的问题，仍可能没有价值。

本库每张TOOL卡分别给出一般判断和当前仓库判断。通用资料不依赖Cloudflare；实施映射再检查现有代码、数据用途、运行环境和责任人。判断可以是直接采用、限定试验、只借鉴、暂缓或证据不足；不采用不是对项目质量的总评价。

## 4. 停止无边界比较的方法

为每次选型写出一个研究问题、可观察输出、当前基线和一个竞争方案。若“成功”只能写成安装成功或页面更丰富，问题还没定义完。查询是否更快必须在同样结果、窗口、缓存条件下比较；多代理是否更好必须在同样来源和总预算下比较；更多新闻是否更好必须按唯一重要事件而非文章数量计算。

Star、发布频率、供应商客户标志只能帮助发现，不进入质量结论。维护核验至少分代码/API存在、相关模块更新、测试资产、失效处理和维护者声明；缺少后几项就保留未知。BlockSci维护者明确停止支持的声明，比仓库仍可访问更重要。[EXT059｜BlockSci 官方仓库](https://github.com/citp/BlockSci)

## 5. 对开发者的输出格式

一次选型输出五行结论即可开始讨论：这个问题今天如何解决；外部成果节省哪一段劳动；新增哪些不可忽略的依赖；什么证据会推翻选择；怎样退回原实现。更细的执行设计使用原方案卷10/13，本库不让每个参考项目都自动变成待办。


## 证据与进一步核验

[EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT041｜IPTC ninjs 用户指南](https://www.iptc.org/std/ninjs/userguide/) [EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3) [EXT059｜BlockSci 官方仓库](https://github.com/citp/BlockSci)

