> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# CASE11｜FDC3工作区上下文迁移

资料核验：2026-09-16。这里分析已公开的产品/方法，不声称实际使用过产品，也不复制其商业实现。


## 来源事实
FDC3将跨金融应用动作表达为context/intent；Lightweight Charts和Perspective分别负责金融序列与分析表格显示。标准、组件和数据权限是三个边界。

## 可吸收设计
用户在报告选中一条事件时，其他面板接收同instrument、绝对窗口、run和证据ID；打开来源是明确动作，不偷偷刷新latest。研究现场对象比屏幕滚动距离更适合历史恢复。

## 不能照搬的部分
单网站不一定需要完整Desktop Agent和应用目录；FDC3规范许可与参考代码还不同。只借概念即可，不把金融标准名词变成部署门槛。

## 验收
从旧报告跳转图表、再打开分组表和笔记，确认数据版本与窗口不变。路由切换、两个面板同时更新和权限变化时，不重复请求或泄漏信息。不存在原历史数据时显示降级，而不是打开今天数据。

## 价值
减少重建上下文的操作有可能比增加十个指标更有用；是否更快需要实际任务对照，而不由界面截图决定。


## 原始依据

[EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3) [EXT134｜Lightweight Charts 仓库](https://github.com/tradingview/lightweight-charts) [EXT075｜Perspective 官方仓库](https://github.com/perspective-dev/perspective)
