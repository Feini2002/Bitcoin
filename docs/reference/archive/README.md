# 历史参考

本目录不属于运行源代码、网站发布资源或默认语法扫描范围。

- maintenance/derivatives-sync-block.js.txt：旧衍生品同步代码块。它与当前 Worker 不完全一致，保留供追溯，不覆盖正式实现。
- maintenance/splice-sync-deriv-block.cjs.txt：该代码块的一次性拼接脚本，归档为文本，避免被误当作日常运维命令执行。
- reference/codex-harness-general.md：早期通用 Harness 说明，仅供历史参考；当前执行规则以 AGENTS.md 和用户指令为准。

删除的三个 verify-*-core/heatmap-snapshot 包装器仅重复执行 verify-market-snapshot-program.cjs，没有仓库调用者；旧 npm verify:chart-snapshot 别名仍保留。版本历史可以恢复这些原文件。
