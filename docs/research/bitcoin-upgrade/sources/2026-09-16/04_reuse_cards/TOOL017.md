# TOOL017｜Sentence Transformers：召回与重排

查询日期：2026-09-16。已核验事实仅限下列直接材料；实验未执行。

## 身份与直接证据

类型：嵌入/重排框架。

官方实例区分双编码候选召回与交叉编码重排。库提供实施接口，具体中文/英文质量取决于选定模型和数据，并不由库名保证。

[EXT036｜Sentence Transformers 当前仓库](https://github.com/huggingface/sentence-transformers) [EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) [EXT038｜Sentence Transformers 代码许可证](https://raw.githubusercontent.com/huggingface/sentence-transformers/master/LICENSE)

## 可以吸收的具体成果

按来源、权利、语言和as-of过滤后，在允许文本上做语义召回；保留原文语言、翻译版本和模型版本。重排只改变候选顺序，证据身份及原始定位不变。

## 不适用与负面证据

相关性不是事实支持度：一篇反驳文章可能比支持文章更相关。向量相近不能证明独立来源；无版本过滤会让最新更正泄漏到历史研究。

## 代码、数据与服务权利

代码Apache-2.0；每个权重/模型卡、训练语料及服务条款另查。向外部嵌入服务发送文本也是数据披露。

## 运行与成本边界

通常Python；CPU/GPU或远程推理可选。不能未经量测承诺需要GPU或本地一定便宜；记录索引重建、查询和模型加载成本。

## 维护证据及其限度

仓库路径已迁至Hugging Face组织；旧链接跳转不能判停更。可见当前文档，所选模型维护与安全性仍未知。

## 竞争替代与选型条件

FTS/BM25适合准确实体、合约代码与数字；语义检索适合同义和跨语种。应做混合候选对照，不先删除词法路径。

## 最低成本核验实验

预设中英文查询及正确证据，不把训练问答复用为测试；比较词法、向量、混合加重排，分别看召回、错误时点和总成本。

## 两轴判断

**一般适用性：**有竞争力的检索基础组件；不等于事实判别器。

**当前仓库适用性：**在已有事实池出现可测检索遗漏后引入；先把版本和查询条件定义好。
