# TOOL024｜原生交易所协议与公开归档

查询日期：2026-09-16。已核验事实仅限下列直接材料；实验未执行。

## 身份与直接证据

类型：协议/公共数据方案。

Binance文档区分maker方向、聚合交易和盘口恢复；公开归档可被后续替换。Bybit清算文档的方向是被清算持仓方向，p是破产价。

[EXT123｜Binance Spot WebSocket 原始规范](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [EXT064｜Binance 公开归档README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) [EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

## 可以吸收的具体成果

把协议样本沉淀成黄金样本，来源特定字段先显式映射再进入统一层。保存频道、规格、时间精度、数量与价格类型；把历史归档的修订变成新的摄取版本。

## 不适用与负面证据

不能用OHLCV还原逐笔，也不能把快照减少全算撤单或成交。所谓all频道是上游说明，不证明本地没有丢包；两个来源的名义清算额不必可直接相加。

## 代码、数据与服务权利

Binance归档README有MIT声明；在线数据及其他交易所的保存、展示、模型输入另核。此卡不复制原站完整协议。

## 运行与成本边界

现有JS采集或独立进程皆可；历史回补、长期流和计算分开预算。公共访问仍受网络、限流、连接周期与地域约束。

## 维护证据及其限度

官方规范维护，可观察变更；本轮没有运行真实流、测完整率或查全部端点权限。

## 竞争替代与选型条件

Tardis等历史服务可补过去未采集部分，不能替代语义验证。统一库可减适配，但原协议仍是字段解释来源。

## 最低成本核验实验

同一事件窗口测试时间单位、聚合总量和清算方向；模拟断档时质量降级。来源替换后的历史查询必须能区分旧/新版本。

## 两轴判断

**一般适用性：**所有金融数据系统都应有的协议基线。

**当前仓库适用性：**优先复用当前正确实现，重点补语义和追溯而非重造。
