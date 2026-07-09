import type { InsuranceLineId } from '@ensureok/catalog';
import type { GapFinding, GapUrgency, ProposalTier } from './types';

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
}

/** 诊断缺口 → 去重后的推荐险种清单(强制型置顶) */
export function planLines(findings: GapFinding[]): PlannedLine[] {
  const map = new Map<InsuranceLineId, { urgency: GapUrgency; titles: Set<string> }>();
  for (const f of findings) {
    for (const lineId of mapCoverageToLines(f.coverage)) {
      const cur = map.get(lineId);
      if (!cur) {
        map.set(lineId, { urgency: f.urgency, titles: new Set([f.title]) });
      } else {
        cur.titles.add(f.title);
        if (URGENCY_RANK[f.urgency] < URGENCY_RANK[cur.urgency]) cur.urgency = f.urgency;
      }
    }
  }
  return [...map.entries()]
    .map(([lineId, v]) => ({ lineId, urgency: v.urgency, tier: tierFor(lineId, v.urgency), gapTitles: [...v.titles] }))
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}
