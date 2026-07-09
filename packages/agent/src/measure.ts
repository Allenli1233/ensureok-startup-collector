import type { Faithfulness, Proposal } from './types';

export interface MeasureReport {
  proposals: number;
  loopItems: number;
  /** 首评/最终 pass 率(loop item 中 verdict=pass 占比) */
  passRate: number;
  degradedRate: number;
  /** 各降级原因计数 */
  degradedReasons: Record<string, number>;
  /** 每险种 LLM 调用数 */
  calls: { avg: number; max: number; total: number };
  /** weightedScore 分布 */
  score: { min: number; avg: number; max: number };
  /** 确定性维一票否决命中率(gateFailed 非空占比) */
  gateHitRate: number;
  /** 逐条条款忠实度分布(供人工核对假阴性:unverified/not-supported 越多越要人工看) */
  faithfulness: Record<Faithfulness, number>;
  /** 覆盖到的险种 */
  linesCovered: string[];
  note: string;
}

const round = (n: number, d = 3): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * 实测闸门(§9.0 · PR4.5)聚合:把一批已生成的 Proposal 汇总成可判定"loop 是否达标上线"的指标。
 * **纯函数、确定性**——不发 API、不取时间,可单测。
 * 注意:judge 忠实度**准确率/假阴性率需人工标注比对**,本函数只给出 faithfulness 分布与逐条原始数据供人工审;
 * 不自动判定"准确率达标"(不拿机器分当人工结论)。
 */
export function summarizeProposals(proposals: Proposal[]): MeasureReport {
  const loopItems = proposals.flatMap((p) => p.items).filter((it) => typeof it.qualityScore === 'number');
  const scores = loopItems.map((it) => it.qualityScore ?? 0);
  const calls = proposals.flatMap((p) => p.items).map((it) => it.callsUsed ?? 0);
  const faithfulness: Record<Faithfulness, number> = { entailed: 0, unverified: 0, 'not-supported': 0, contradicted: 0 };
  const degradedReasons: Record<string, number> = {};
  let passed = 0;
  let degraded = 0;
  let gateHit = 0;

  for (const it of loopItems) {
    const last = it.scoreCards?.at(-1);
    if (last?.verdict === 'pass') passed++;
    if (last?.gateFailed.length) gateHit++;
    if (it.degraded) {
      degraded++;
      const reason = it.degradedReason?.split(/[,,;;(]/)[0]?.trim() || 'unknown';
      degradedReasons[reason] = (degradedReasons[reason] ?? 0) + 1;
    }
    for (const c of it.keyClausesDetailed ?? []) {
      if (c.faithfulness) faithfulness[c.faithfulness]++;
    }
  }

  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const linesCovered = [...new Set(proposals.flatMap((p) => p.items).map((it) => it.lineName))];

  return {
    proposals: proposals.length,
    loopItems: loopItems.length,
    passRate: loopItems.length ? round(passed / loopItems.length) : 0,
    degradedRate: loopItems.length ? round(degraded / loopItems.length) : 0,
    degradedReasons,
    calls: { avg: calls.length ? round(sum(calls) / calls.length, 1) : 0, max: calls.length ? Math.max(...calls) : 0, total: sum(calls) },
    score: { min: scores.length ? Math.min(...scores) : 0, avg: scores.length ? round(sum(scores) / scores.length, 1) : 0, max: scores.length ? Math.max(...scores) : 0 },
    gateHitRate: loopItems.length ? round(gateHit / loopItems.length) : 0,
    faithfulness,
    linesCovered,
    note: 'judge 忠实度准确率/假阴性率需人工标注比对(见 faithfulness 分布 + 各 item.keyClausesDetailed 原始数据);本报告不自动判定准确率达标。',
  };
}
