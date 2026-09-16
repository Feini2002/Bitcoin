# RES02｜持续订阅与来源发现

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 订阅与搜索不是同一件事

订阅回答“指定来源出现了什么新内容”，搜索回答“围绕当前问题还能找到什么”。前者可以测更新时间与漏采，后者适合发现新来源和补缺。仅靠模型每日报告时临时搜索，难以知道没有发现某件事是因为它不重要、搜索没召回还是来源无法访问。反过来，无差别订阅所有热榜会制造大量待处理库存。

Miniflux的API提供订阅、条目与检查/错误相关元数据；FreshRSS提供阅读器兼容API；RSSHub负责为不同来源生成订阅。它们分别是聚合管理、阅读同步与源适配，不能仅因都涉及RSS就部署三套相同责任。[EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html) [EXT009｜FreshRSS Google Reader兼容API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html) [EXT001｜RSSHub 官方仓库](https://github.com/DIYgod/RSSHub)

## 2. 建议的来源发现漏斗

候选来源首先记录它能回答的研究问题。例如央行声明能确认政策措辞，交易所公告能确认合约变动，发行人页面能确认某披露字段；媒体采访和分析可以提出不同解释，但不能冒充发行人原始数据。

候选状态建议是`discovered → examined → eligible_for_specific_use → pilot → active/paused/rejected`。进入active前必须明确获取方式、字段、更新节奏、可保存内容、负责人和失效替代；这些是设计建议而不是第三方平台已有状态。

官方RSS/Atom/API优先；其次是明确许可的HTML变化监测；需浏览器执行的页面放在最后。搜索引擎、聚合服务和社媒可提供线索，但一个线索地址不自动取得抓取和保存权。Feed、页面、发布主体分别建ID，避免一个媒体的多个feed被误当独立来源。

## 3. 三条可选路线

| 路线 | 最小组成 | 优势 | 代价与退出条件 |
|---|---|---|---|
| 轻量直采 | 少量官方feed/API＋现有任务账本 | 故障定位清楚，来源可控 | 来源太多、调度/重试重复成为负担时升级 |
| 订阅中枢 | Miniflux或FreshRSS＋一个只读导出适配 | 现成订阅、阅读状态、人工筛选 | 不把已读状态当事件有效性；新增服务需维护 |
| 专门采集平台 | Scrapy/RSSHub/变更监控按源组合 | 复杂来源与恢复能力 | 只有对应源确有价值才启用，不全网铺开 |

Fed订阅目录和BLS日历提供适合首个官方源试点的入口，但BLS日历的Eastern Time与文章发布时间不能混用。[EXT067｜Federal Reserve RSS目录](https://www.federalreserve.gov/feeds/feeds.htm) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm)

## 4. 增量获取的最低语义

保存last_attempt、last_success、HTTP状态、ETag/Last-Modified、游标以及抓取批次。304意味着该表示未改变，不代表整个平台没有新事件；200空列表也不能在解析器刚改坏时自动解释为没有内容。失败保留上次成功时间，陈旧数据允许显示但标stale。

来源优先级不使用单一“权威分”。先看是否直接发布、是否独立、能否取得更新时间、是否经常改写同URL、覆盖了哪类主题。非官方采访仍可能有独特信息；官方源也可能延迟和选择披露。重要的是来源在当前主张上承担什么证据角色。

## 5. 评价与价值

用一组事先列好的已知事件做覆盖审计：是否发现、何时首次发现、哪些是新的根源、哪些只重复转发、失败原因是什么。不要把历史搜索能找到当作实时订阅一定能及时找到。保留一个未被规则选中的抽样队列，用来发现筛选漏掉的关键更正。

第一轮可以同时交付“两个高价值来源稳定采集”和“一份使用其材料的简报”，无需等待全网库，但也不应把采集改进无限推到分析完成以后。


## 证据与进一步核验

[EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html) [EXT009｜FreshRSS Google Reader兼容API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html) [EXT001｜RSSHub 官方仓库](https://github.com/DIYgod/RSSHub) [EXT067｜Federal Reserve RSS目录](https://www.federalreserve.gov/feeds/feeds.htm) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm)

