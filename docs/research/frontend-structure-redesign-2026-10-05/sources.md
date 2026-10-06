# 结构案例来源、原件与限制

查询/浏览器核验日期：2026-10-05，北京时间。本文件服务于[重设计方案](../frontend-structure-redesign-review-2026-10-05.md)，不表示案例功能已经在本系统实现。

| 来源 | 已核验事实、版本 | 采用推断 | 原件与限制 |
| --- | --- | --- | --- |
| [Koyfin Reports v3.84](https://www.koyfin.com/help/release-notes/reports/) | 官方发布页标2026-04-15发布/2026-05-20更新；介绍报告入口、命名/类型/更新日期、搜索/排序和读取导出。正文及帮助产品图已看 | 本系统将运行轮次组织成报告对象；日期分组是本项目推断 | [浏览器截图](evidence/browser-r2-koyfin-reports.png)；原HTML在本机`.artifacts/frontend-ia-review-20261005/browser-r2/koyfin-reports-source.html`。不是登录账户验收，不照搬投资组合/交易账户 |
| [AlphaSense Vertical Filters](https://help.alpha-sense.com/hc/en-us/articles/41641827216659-Vertical-Filters) | 官方帮助2026-03-25更新；来源/内容集与日期过滤分开；正文和产品筛选图已看 | 研究类型、来源、日期应为独立维度，减少内部类型词，诚实标查询覆盖 | [浏览器截图](evidence/browser-r2-alphasense-filters.png)；原HTML在本机同目录`alphasense-filters-source.html`。本系统不具有它全部内容覆盖或全文检索能力 |
| [OpenBB Workspace Apps](https://docs.openbb.co/workspace/developers/apps) | 官方Apps文档说明围绕用途组织widgets、布局和表/图分组，并给出专题多tab配置示例；文档未固定版本号/发布日期 | 围绕判断/范围联动图、表、材料，比按数据回执对象排页面更适合研究任务 | [文档截图](evidence/browser-r3-openbb-observed.png)；原页面文本在本机`browser-r3/openbb-observed.txt`。产品图片未加载，未声称亲看签入应用或Workspace全部开源 |

原始公开页面/文字保留在审查本机工件中，方案只记录必要事实与项目推断，不复制整页正文。官方图像作为结构证据，不能冒充本系统已实现截图。帮助站的分析/统计POST被阻止；Koyfin页面外部脚本错误不归为本仓库错误。

适用代码：导航与报告库`js/nav.js`、`js/pages/research-records.js`；报告/证据联动`js/agent-team/ui.mjs`、`js/user-workspace.js`；行情/宏观/杠杆`js/pages/derivatives.js`、`js/desk-visual.js`。借鉴要通过方案UX01—12的真实任务验证，不能靠外部产品声誉证明本系统可用性。
