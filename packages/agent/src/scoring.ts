import { checkCompliance } from './tools/checkCompliance';
import type { JudgeSoft } from './judge';
import type { ClaimJudgement, Dimension, DimensionScore, Faithfulness, KeyClause, ScoreCard, Verdict } from './types';

/** 维度权重:compliance 为纯 gate(权重 0),其余 Σ=1(§5.2)。weightedScore = Σ(w×score)/5×100 → 满分 100。 */
const WEIGHTS: Record<Dimension, number> = { compliance: 0, accuracy: 0.2, pricing: 0.1, fidelity: 0.4, persuasion: 0.3 };

export const PASS_THRESHOLD = 78;
export const FAIL_THRESHOLD = 72;
export const FIDELITY_MIN = 3;

/** 已知保司(accuracy 维:文本出现白名单外的已知保司 → 编造,gate fail) */
const KNOWN_INSURERS = [
  '中国人保', '人保财险', '平安', '太保', '太平洋', '中国人寿', '泰康', '中华联合', '大地', '阳光', '众安', '华泰', '安盛', '美亚', '史带', '国寿',
];
/** 名字本身含保险词(如 中国人保/中国人寿)→ 出现即算保司引用 */
const NAME_IS_INSURER = /(?:保险|财险|人寿|产险|人保|养老|再保)$/;
/** 保司引用信号:名字后紧邻保险类后缀,或前面有"推荐/承保/由…"等引荐动词 */
const INSURER_SUFFIX = '(?:保险|财险|人寿|产险|养老|再保|保司|保险公司|集团)';
// 引荐动词:只用强推荐词;剔除 承保/投保/由/使用 等域内常用词(否则"承保大地震"会把"大地"误判为保司)
const REC_VERB = '(?:推荐|选择|选用|优先|采用)';
/**
 * 判断某保司名在文本里是否为"保司引用"(而非普通词)。
 * 规避 平安/阳光/大地/太平洋/国寿 等常用词误判(bug):裸子串不算,需后缀相邻或引荐动词在前。
 */
function isInsurerReference(text: string, name: string): boolean {
  if (!text.includes(name)) return false;
  if (NAME_IS_INSURER.test(name)) return true;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${n}[^。；\\n]{0,3}${INSURER_SUFFIX}`).test(text) || new RegExp(`${REC_VERB}[^。；\\n]{0,3}${n}`).test(text);
}

const EXCLUSION_HEADINGS = ['除外', '责任免除', '免除', '不承保', '不保', '免赔'];
const LIABILITY_HEADINGS = ['保险责任', '承保', '赔偿责任', '责任范围', '保障范围'];

export interface DeterministicDims {
  compliance: DimensionScore;
  accuracy: DimensionScore;
  pricing: DimensionScore;
  complianceFlags: string[];
}

/** 确定性三维(合规/价位/事实),不进 LLM。 */
export function scoreDeterministic(text: string, whitelist: string[]): DeterministicDims {
  const comp = checkCompliance({ text });
  const flags = comp.ok ? [...new Set(comp.data.violations.map((v) => v.rule))] : [];
  const hasPrice = flags.includes('R1_premium');
  const white = whitelist;
  const stray = KNOWN_INSURERS.find(
    (name) => !white.some((w) => w.includes(name) || name.includes(w)) && isInsurerReference(text, name),
  );
  return {
    compliance: { score: flags.length ? 0 : 5, verdict: flags.length ? 'fail' : 'pass', notes: flags },
    accuracy: { score: stray ? 0 : 5, verdict: stray ? 'fail' : 'pass', notes: stray ? [`保司「${stray}」不在产品库白名单`] : [] },
    pricing: { score: hasPrice ? 0 : 5, verdict: hasPrice ? 'fail' : 'pass', notes: hasPrice ? ['文本出现价格数字'] : [] },
    complianceFlags: flags,
  };
}

/** 滞回带判定(M2):≥78 pass / ≤72 fail / 中间维持上一轮(首轮按 fail)。gate/低忠实直接 fail。 */
export function decideVerdict(weighted: number, fidelity: number, gateFailed: Dimension[], prev?: Verdict): Verdict {
  if (gateFailed.length) return 'fail';
  if (fidelity < FIDELITY_MIN) return 'fail';
  if (weighted >= PASS_THRESHOLD) return 'pass';
  if (weighted <= FAIL_THRESHOLD) return 'fail';
  return prev ?? 'fail';
}

/** 汇总五维 → ScoreCard(重算 weightedScore 仅防算术漂移,不提升判断可信度)。 */
export function buildScoreCard(det: DeterministicDims, soft: JudgeSoft, prev?: Verdict): ScoreCard {
  const dimensions: Record<Dimension, DimensionScore> = {
    compliance: det.compliance,
    accuracy: det.accuracy,
    pricing: det.pricing,
    fidelity: { score: soft.fidelity, notes: [] },
    persuasion: { score: soft.persuasion, notes: soft.vagueSentences },
  };
  const gateFailed = (['compliance', 'accuracy', 'pricing'] as Dimension[]).filter((d) => dimensions[d].verdict === 'fail');
  const weightedScore = Math.round(
    ((WEIGHTS.accuracy * dimensions.accuracy.score +
      WEIGHTS.pricing * dimensions.pricing.score +
      WEIGHTS.fidelity * dimensions.fidelity.score +
      WEIGHTS.persuasion * dimensions.persuasion.score) /
      5) *
      100,
  );
  const verdict = decideVerdict(weightedScore, soft.fidelity, gateFailed, prev);
  return { dimensions, weightedScore, verdict, gateFailed, revisionInstructions: soft.revisionInstructions };
}

/**
 * 应用忠实度到条款(M3 非破坏性 + H1 结构化 heading 比对):
 * - clauseType 与证据 heading 类型错配(除外条款却引到"保险责任"heading) → 强判 not-supported。
 * - not-supported 先尝试 rebind(改引 top-K 内更佳 chunk,不删);无果则标 unverified(⚠待核)保留条款。
 * - 仅当 fidelityDestructive 且 judge 异构时,才保留 not-supported 原状(删除动作进人工确认队列,不即时删)。
 */
export function applyFaithfulness(
  clauses: KeyClause[],
  claims: ClaimJudgement[],
  headingByChunk: Map<string, string[]>,
  fidelityDestructive: boolean,
): { clauses: KeyClause[]; anyUnverified: boolean } {
  const byIndex = new Map(claims.map((c) => [c.index, c]));
  let anyUnverified = false;
  const out = clauses.map((clause, i) => {
    const claim = byIndex.get(i);
    let status: Faithfulness = claim?.status ?? 'entailed';
    let evidenceRefs = clause.evidenceRefs;

    if (clause.clauseType === '除外' || clause.clauseType === '责任') {
      const headings = evidenceRefs.flatMap((id) => headingByChunk.get(id) ?? []).join(' ');
      // 先剔除除外类词再判责任:'承保' 是 '不承保' 的子串,直接判会漏判(FN);但除外与责任**同现**时
      // 责任仍应独立成立(否则误伤 FP)。故 hitExcl 用原文,hitLiab 用"抠掉除外词后的余文"独立判定。
      const hitExcl = EXCLUSION_HEADINGS.some((h) => headings.includes(h));
      const headingsNoExcl = EXCLUSION_HEADINGS.reduce((s, h) => s.split(h).join(' '), headings);
      const hitLiab = LIABILITY_HEADINGS.some((h) => headingsNoExcl.includes(h));
      const wantHit = clause.clauseType === '除外' ? hitExcl : hitLiab;
      const otherHit = clause.clauseType === '除外' ? hitLiab : hitExcl;
      if (evidenceRefs.length && otherHit && !wantHit) {
        status = 'not-supported';
      }
    }

    if (status === 'not-supported' && claim?.rebindTo && headingByChunk.has(claim.rebindTo)) {
      evidenceRefs = [claim.rebindTo];
      status = 'entailed';
    }

    let faithfulness: Faithfulness = status;
    if (status === 'not-supported' || status === 'contradicted') {
      faithfulness = fidelityDestructive ? status : 'unverified';
      anyUnverified = true;
    }
    return { ...clause, evidenceRefs, faithfulness };
  });
  return { clauses: out, anyUnverified };
}
