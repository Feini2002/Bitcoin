> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES25｜论文披露与复杂文档摄取

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 信息收集不能只覆盖网页新闻

论文、发行人披露、储备报告、监管附件和方法说明常以PDF或复杂文档发布。只做RSS标题与HTML摘要，会遗漏表格、脚注和方法限制。但“支持PDF”也不代表可以把所有数字直接交给金融计算。

Docling侧重多格式与统一文档结构，GROBID侧重学术技术文献TEI，Unstructured侧重元素化摄取。它们解决的任务不同，适合按真实样本比较，不必全部部署。[EXT142｜Docling 当前仓库](https://github.com/docling-project/docling) [EXT144｜GROBID 当前仓库](https://github.com/grobidOrg/grobid) [EXT146｜Unstructured 开源库](https://github.com/Unstructured-IO/unstructured)

## 2. 提取层必须保留证据结构

文档对象保存来源、文件hash、发布日期/取得时间、语言、权利和原始版本；元素保存页码、区域/段落、表格单元和阅读顺序；抽取主张引用元素，数值同时保留单位、脚注与表头。

先查是否有原生CSV、XBRL、XML或HTML，再用文档解析。扫描件只有在其他提取无效时才使用OCR，并对关键数字人工核查；不能把OCR置信分当金融事实概率。跨页表、负号、括号、百万/十亿和日期格式都应专门测试。

## 3. 文献发现和文献已读分开

参考文献里出现一篇论文，不代表本系统已经取得或读过其正文。GROBID可以帮助抽结构，但引用真实性与研究方法适用性还要回原文。论文摘要提供研究问题和作者结论，不能据此声称检查了所有实验、消融或数据许可证。

方法库建议为每篇材料记录问题、样本/市场、方法假设、比较基线、主要限制、可迁移部分和不可外推部分。没有复现就写文档证据，不能把作者报告的性能当本项目运行结果。

## 4. 处理方案与成本

少量复杂材料可人工核对加批提取，不需要常驻文档服务。材料类型与数量扩大后再选择一种主要管道和必要回退，避免三个组件分别输出三个不一致版本。模型权重与解析插件可能需要下载或外部服务，不能把本地代码许可等同完全离线能力。[EXT143｜Docling 许可证](https://raw.githubusercontent.com/docling-project/docling/main/LICENSE) [EXT145｜GROBID 许可证](https://raw.githubusercontent.com/grobidOrg/grobid/master/LICENSE) [EXT147｜Unstructured 库许可证](https://raw.githubusercontent.com/Unstructured-IO/unstructured/main/LICENSE.md)

失败时保留已成功元数据和不可解析范围，报告可链接原文但不得补造表格。若正文不允许长期保存，采取允许的元数据/定位策略并注明重现范围。文档查阅功能不是一条绕过付费墙的抓取链。

## 5. 最小验收矩阵

使用一个数字型表格、一个带否定/限定条件的长段、一个跨页表和一个扫描样本，核对标题、页定位、关键数字、单位与引用恢复。再将提取元素放入实际检索/报告链，检查分块后是否丢失表头。转换成JSON或Markdown成功只能算结构处理完成，不能算事实抽取正确。


## 证据与进一步核验

[EXT142｜Docling 当前仓库](https://github.com/docling-project/docling) [EXT144｜GROBID 当前仓库](https://github.com/grobidOrg/grobid) [EXT146｜Unstructured 开源库](https://github.com/Unstructured-IO/unstructured) [EXT143｜Docling 许可证](https://raw.githubusercontent.com/docling-project/docling/main/LICENSE)

