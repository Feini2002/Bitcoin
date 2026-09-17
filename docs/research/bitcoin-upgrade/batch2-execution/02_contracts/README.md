# 设计契约与合成链路

本目录是小型语义合同示例，不是生产数据库迁移，不取代finance现有响应。所有example都是合成，example_only=true；scope外部调用和生产写入均false。原旧版本的30表/39API不作为本次必建清单。

`design.schema.json`验证五类示例入口；Decimal/Time/Quality/Window是辅助定义。JSON Schema不能证明window.start<end、receipt在cutoff前、owner/用途或数值真实性，这些需域校验。本包的文档QA对样例做有限交叉核查，不证明真实应用实现。

样例quote=1020 USD、base=10 BTC、VWAP=102 USD/BTC；来源是人为构造，不是Binance或当前行情。Report只有初始基线，不宣称市场变化。API清单均拟新增，采用前应与当前路由合并，不启用第二同义入口。
