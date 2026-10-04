import {identity} from './contract.mjs';
export function forwardPrompt(input){
  const prompt='仅使用这份封存的 Binance USD-M BTCUSDT 永续15m原始观察与已完成研究，注册一次 user-attested shadow 研究命题。不得联网/读取其他输入/调用其他模型，不下单，不说已验证胜率。目标命题严格为 target closed close / reference closed close - 1 > 0；概率给null或0..1原始未校准值，说明最强反证，样本只有1次。不得修改目标start/end/reference/source。输出单一JSON：{taskId,runId,snapshotId,source,reference,targetStart,targetAt,probability,probabilityStatus,reasoning,counterEvidence,limitations,sourceRefs}。时间全部原样，概率null不是0.5。sourceRefs必须含给定artifactHash和researchOutputHash。'+JSON.stringify(input);
  return {prompt,promptHash:identity.sha256(prompt),version:'bitdesk.shadow.prompt.2026-10-02.1'};
}
