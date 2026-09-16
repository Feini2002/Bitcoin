# RES04｜事件主张去重与更正

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 四个对象不能压成一张新闻表

文章是某发布者的内容版本；事件是现实过程；主张是可被支持或反驳的陈述；证据是特定来源对主张提供的观察或声明。同一事件可有多篇文章、同一文章可含多个主张，一个原始公告的十次转载仍只有一个根源。

IPTC ninjs可作为新闻对象与关系的规范参考，W3C Annotation可作为主张定位的参考；两者都不自动判断事件真假。[EXT041｜IPTC ninjs 用户指南](https://www.iptc.org/std/ninjs/userguide/) [EXT043｜W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)

## 2. 去重应可逆

建议三层处理：URL/内容精确重复先折叠；近重复算法只给候选对；语义事件归并以实体、动作、时间和结果状态判定。删除内容与折叠阅读是两种动作，默认采用可逆关系，不物理抹掉来源。

Feedly分别设计内容去重与同事件聚类，聚类保留不同报道。其代表文章可能按界面使用最新、长度或来源流行度，并不等于原始权威。因此可借鉴交互，但金融证据应另选根来源。[EXT101｜Feedly 内容去重规则](https://docs.feedly.com/article/218-how-does-deduplication-work) [EXT102｜Feedly 主题事件聚类](https://docs.feedly.com/article/552-what-is-clustering) [EXT103｜Feedly 聚类代表文章选择](https://docs.feedly.com/article/603-which-source-will-i-see-first-when-articles-are-clustered)

## 3. 必须保留的反例

“批准”与“尚未批准”的高度相似文本不能合并成一个肯定事实。“周五计划公布”与“周五实际公布”是不同状态。“交易所恢复提现”不是“上周暂停提现”的重复噪音。金额更正、单位变化、日期推迟、否认和撤回都是需要提高可见性的更新。

建议关系包括`duplicate_of`、`syndicated_from`、`reports_on`、`supports`、`contradicts`、`corrects`、`retracts`。这些关系必须带作出判断的规则/人工/模型版本和可撤销历史。模型建议合并不直接覆盖事件ID。

## 4. 来源独立性与重要性

独立性不是域名数量：通讯社原稿、转载站和模型摘要可能同源；两家机构分别披露不同测量才可能增加独立证据。根源未知时保留unknown，不能猜“多家证实”。

事件重要性应相对研究问题解释：它改变哪个已跟踪条件、是否实质更新、是否有可信可观察数据、何时需要检查。热榜可以表示注意力，不能替代经济影响。重要性评分如保留，也只表示排序规则，不冒充价格概率。

## 5. 衡量降噪不能只看少了多少

评价需要同时观察重复减少和重要变化召回。建立故意相似的更正/否定测试集、跨语言译稿和不同日期相同措辞样本；按事件划分测试，防止同一报道进入训练和测试。统计误合并是比普通重复更高风险的错误，单独设置硬门。

低置信合并送人工抽检或保留分组；用户可拆分并反馈原因。点击“合并”不是修改原始事实，而是更新研究索引。对旧报告，仍按当时已知的关系恢复，今天发现的更正附在旁边，不覆盖历史叙述。


## 证据与进一步核验

[EXT041｜IPTC ninjs 用户指南](https://www.iptc.org/std/ninjs/userguide/) [EXT034｜datasketch MinHash LSH](https://ekzhu.com/datasketch/lsh.html) [EXT102｜Feedly 主题事件聚类](https://docs.feedly.com/article/552-what-is-clustering) [EXT103｜Feedly 聚类代表文章选择](https://docs.feedly.com/article/603-which-source-will-i-see-first-when-articles-are-clustered) [EXT043｜W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)

