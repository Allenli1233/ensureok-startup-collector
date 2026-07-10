import type { InsuranceLineId } from '@ensureok/catalog';
import { RELEVANCE_THRESHOLD, lineRelevance } from './lineRelevance';
import type { GapFinding, GapUrgency, ProposalRequest, ProposalTier } from './types';

/**
 * 缺口 coverage 文本 → 险种 code(关键词规则,长词在前)。
 * 只映射到产品库存在的 12 险种;COI 出具服务产品库暂缺,命中"出海保障包/COI"时拆成
 * tech_eo+cyber+product_liability(COI 兜底提示留待 PR4/前端)。
 */
interface Rule {
  kw: string;
  lines: InsuranceLineId[];
}

const RULES: Rule[] = [
  { kw: '雇主责任', lines: ['employer_liability'] },
  { kw: '团体', lines: ['group_accident'] },
  { kw: '出海保障包', lines: ['tech_eo', 'cyber', 'product_liability'] },
  { kw: '科技类职业责任', lines: ['tech_eo'] },
  { kw: 'Tech E&O', lines: ['tech_eo'] },
  { kw: '职业责任', lines: ['tech_eo'] },
  { kw: 'E&O', lines: ['tech_eo'] },
  { kw: '网络安全', lines: ['cyber'] },
  { kw: 'Cyber', lines: ['cyber'] },
  { kw: '产品责任', lines: ['product_liability'] },
  { kw: '公众责任', lines: ['public_liability'] },
  { kw: '董监事', lines: ['directors_officers'] },
  { kw: 'D&O', lines: ['directors_officers'] },
  { kw: '董责', lines: ['directors_officers'] },
  { kw: '知识产权', lines: ['ip'] },
  { kw: 'AI 服务责任', lines: ['ai_liability'] },
  { kw: 'AI服务责任', lines: ['ai_liability'] },
];

const URGENCY_RANK: Record<GapUrgency, number> = { mandatory: 0, high: 1, advice: 2 };

/** coverage 文本 → 险种集合(按规则顺序去重) */
export function mapCoverageToLines(coverage: string): InsuranceLineId[] {
  const out: InsuranceLineId[] = [];
  for (const r of RULES) {
    if (coverage.includes(r.kw)) {
      for (const l of r.lines) if (!out.includes(l)) out.push(l);
    }
  }
  return out;
}

function tierFor(lineId: InsuranceLineId, urgency: GapUrgency): ProposalTier {
  if (lineId === 'ai_liability') return 'tier4'; // 品类共创,单列 tier4
  return urgency === 'mandatory' ? 'tier1' : urgency === 'high' ? 'tier2' : 'tier3';
}

export interface PlannedLine {
  lineId: InsuranceLineId;
  urgency: GapUrgency; // 触发本险种的最紧迫缺口
  tier: ProposalTier;
  gapTitles: string[];
  // ── 新增(可选,向后兼容):候选池打分溯源 ──
  source?: 'finding' | 'relevance' | 'both';
  relevanceScore?: number;
  relevanceReasons?: string[];
}

/** 险种总量上限(mandatory/high 全进,其余按分数填到 ≤ MAX_LINES) */
export const MAX_LINES = 8;
/** findings-advice 线参与排序时的默认分(与阈值同尺度,至少拿到阈值分) */
export const FINDING_ADVICE_DEFAULT = 2;

type Draft = {
  lineId: InsuranceLineId;
  urgency: GapUrgency;
  titles: string[];
  source: 'finding' | 'relevance' | 'both';
  relevanceScore?: number;
  relevanceReasons?: string[];
};

/** 排序用分数:打分线用 relevanceScore;findings-advice 线用默认分 */
function sortScore(d: Draft): number {
  return d.relevanceScore ?? FINDING_ADVICE_DEFAULT;
}

/**
 * 封顶排序优先级:findings 诊断出的线(finding/both)恒优先于纯画像推断线(relevance)。
 * 保证确定性诊断出的真实缺口不被仅凭画像推断的补线挤出结果(合规:诊断结论 > 推断结论)。
 */
function sourceRank(d: Draft): number {
  return d.source === 'relevance' ? 1 : 0;
}

/**
 * 诊断缺口 + 画像 → 去重后的推荐险种清单(强制型置顶,总量封顶)。
 *
 * 两条确定性通道合并:
 *  - findings 驱动:沿用 RULES 关键词映射,保留 urgency/叙事(mandatory/high 只来自这里)。
 *  - 画像打分:lineRelevance(profile) score ≥ 阈值 → 默认 advice 补线(接通死库存险种)。
 * 合并同一 lineId 取更紧迫 urgency(打分线绝不降级 findings 线),再按分数封顶到 ≤ MAX_LINES。
 *
 * `profile` 可选:不传则退回纯 findings 行为(老调用/老测试不回归)。
 */
export function planLines(findings: GapFinding[], profile?: ProposalRequest['profile']): PlannedLine[] {
  // 1) findings 通道
  const fMap = new Map<InsuranceLineId, { urgency: GapUrgency; titles: Set<string> }>();
  for (const f of findings) {
    for (const lineId of mapCoverageToLines(f.coverage)) {
      const cur = fMap.get(lineId);
      if (!cur) {
        fMap.set(lineId, { urgency: f.urgency, titles: new Set([f.title]) });
      } else {
        cur.titles.add(f.title);
        if (URGENCY_RANK[f.urgency] < URGENCY_RANK[cur.urgency]) cur.urgency = f.urgency;
      }
    }
  }

  // 2) 合并:先落 findings 线,再叠加打分线
  const drafts = new Map<InsuranceLineId, Draft>();
  for (const [lineId, v] of fMap) {
    drafts.set(lineId, { lineId, urgency: v.urgency, titles: [...v.titles], source: 'finding' });
  }
  for (const [lineId, rel] of lineRelevance(profile)) {
    if (rel.score < RELEVANCE_THRESHOLD) continue;
    const cur = drafts.get(lineId);
    if (cur) {
      cur.source = 'both';
      cur.relevanceScore = rel.score;
      cur.relevanceReasons = rel.reasons;
      // urgency 取更紧迫者(打分线默认 advice,绝不下拉 findings 线)
    } else {
      drafts.set(lineId, {
        lineId,
        urgency: 'advice',
        titles: [],
        source: 'relevance',
        relevanceScore: rel.score,
        relevanceReasons: rel.reasons,
      });
    }
  }

  // 3) 封顶:mandatory/high 全进;其余 advice 按分数排序填到总数 ≤ MAX_LINES
  const all = [...drafts.values()];
  const must = all.filter((d) => d.urgency === 'mandatory' || d.urgency === 'high');
  const rest = all
    .filter((d) => d.urgency === 'advice')
    // findings 线优先保留,再按分数,末尾 lineId 稳定 → 诊断缺口不被推断线挤掉
    .sort((a, b) => sourceRank(a) - sourceRank(b) || sortScore(b) - sortScore(a) || a.lineId.localeCompare(b.lineId));
  const restKeep = rest.slice(0, Math.max(0, MAX_LINES - must.length));
  const selected = [...must, ...restKeep];

  // 4) 输出:先按 urgency,再 findings 优先,再按分数降序,末尾 lineId 稳定
  return selected
    .sort(
      (a, b) =>
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        sourceRank(a) - sourceRank(b) ||
        sortScore(b) - sortScore(a) ||
        a.lineId.localeCompare(b.lineId),
    )
    .map((d) => ({
      lineId: d.lineId,
      urgency: d.urgency,
      tier: tierFor(d.lineId, d.urgency),
      gapTitles: d.titles,
      source: d.source,
      relevanceScore: d.relevanceScore,
      relevanceReasons: d.relevanceReasons,
    }));
}
