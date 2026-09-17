> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# TOOL060｜exchange_calendars

查询日期：2026-09-16。已核验事实仅限下列直接材料；实验未执行。

## 身份与直接证据

类型：证券交易日历库。

它定义证券交易时段与休市；宏观发布时间应来自BLS/Fed等发布机构，不可从交易所session推断。

[EXT131｜exchange_calendars 当前仓库](https://github.com/gerrymanoim/exchange_calendars) [EXT132｜exchange_calendars许可证](https://raw.githubusercontent.com/gerrymanoim/exchange_calendars/master/LICENSE) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm)

## 可以吸收的具体成果

跨资产对齐时记录session状态、交易日、时区与日历版本；周末BTC仍交易，但SPY旧收盘不能标成新观测。

## 不适用与负面证据

临时休市和未来排期可能变动；日历库不保证每个venue在所有历史日期完美正确。

## 代码、数据与服务权利

Apache-2.0已核；价格数据、官方排期和第三方服务独立。

## 运行与成本边界

Python批处理可直接用；JS线上可消费有限经过验证的日历表，不必引入另一常驻服务。

## 维护证据及其限度

当前项目与许可可核，未逐市场运行验收。

## 竞争替代与选型条件

少量资产可直接用官方日历/来源session状态；扩大交易所覆盖后库更划算。

## 最低成本核验实验

测试夏令时切换、半日市、节假日和周末旧价格，区分休市与数据断供。

## 两轴判断

**一般适用性：**跨资产研究的重要小组件。

**当前仓库适用性：**与Yahoo等现有跨资产路径结合，不混同宏观vintage管道。
