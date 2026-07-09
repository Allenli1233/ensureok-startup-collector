import type { InsuranceLineId } from '@ensureok/catalog';
import { extractLineData } from '../catalogData';
import { err, ok, type ToolContext, type ToolResult } from './types';

export type PriceMatchTier = 'bracket' | 'blank';

export interface ComputePricingInput {
  lineId: InsuranceLineId;
}

export interface ComputePricingOutput {
  lineId: InsuranceLineId;
  lineName: string;
  matchTier: PriceMatchTier;
  currency: 'CNY';
  /** 参考年保费区间(人民币)——已尽量隔离"保费",排除"保额"档 */
  premiumMinCny?: number;
  premiumMaxCny?: number;
  basis: string;
  collectedAt?: string;
  /** 溯源:命中保费的价格表上下文 */
  rowRefs: string[];
  unavailableReason?: 'no_price_table' | 'no_premium_isolated';
}

const CUR_G = /([\d,]+(?:\.\d+)?)\s*(万元|万|元)/g;
/** 列头是"保额档"(含具体数字+万,如 10万保额/100万/3000-5000万)→ 其下单元格是保费 */
const isBracketHeader = (h: string): boolean => /\d[\d,.]*\s*万/.test(h);
/** 列头明说是保费 */
const isPremiumHeader = (h: string): boolean => /保费|年保费|月缴|年缴|半年缴|费用|预算|示例/.test(h);
/** 列头是"保额/额度"本身(单元格是保额金额,非保费)→ 跳过 */
const isCoverageValueHeader = (h: string): boolean => /(保额|额度|保障额)/.test(h) && !isBracketHeader(h);
/** 维度标签列(职业/规模/市值/板块…)→ 跳过 */
const isDimensionHeader = (h: string): boolean =>
  /职业|类别|规模|市值|板块|行业|方案|层次|类目|运输|场所|地域|维度|公司类型|市场|渗透|档/.test(h) && !isBracketHeader(h);

function cnyOf(numStr: string, unit: string): number {
  const n = Number(numStr.replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return unit === '元' ? n : n * 10_000;
}

/**
 * compute_pricing:从产品库价格表**隔离保费(排除保额)**算参考年保费区间(确定性,数字只来自产品库)。
 * 相比旧 buildPricing(把全表 ¥/元/万 不分语义并进一个区间)的关键改进:区分"保额档列头 vs 保费单元格"、
 * 排除"保额/额度"值列与外币表。带画像维度的精确 matchTier(exact/budget)后续细化,PR2 先给 bracket/blank。
 */
export function computePricing(input: ComputePricingInput, ctx: ToolContext): ToolResult<ComputePricingOutput> {
  const cat = ctx.catalogs.get(input.lineId);
  if (!cat) return err('not-found', `产品库无此险种: ${input.lineId}`);
  const d = extractLineData(cat);
  const base = { lineId: cat.lineId, lineName: cat.lineName, currency: 'CNY' as const, collectedAt: d.collectedAt };

  if (d.priceTables.length === 0) {
    return ok({ ...base, matchTier: 'blank', basis: '该险种无公开价目表', rowRefs: [], unavailableReason: 'no_price_table' });
  }

  const premiums: number[] = [];
  const rowRefs: string[] = [];

  for (const t of d.priceTables) {
    // 外币表整表跳过(不与人民币并入)
    if (t.rows.some((r) => r.some((c) => c.includes('$')))) continue;

    const premiumCols = t.columns.map((h, i) => (isPremiumHeader(h) || isBracketHeader(h) ? i : -1)).filter((i) => i >= 0);
    let hit = false;

    const pushFrom = (cell: string) => {
      CUR_G.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CUR_G.exec(cell))) {
        const v = cnyOf(m[1], m[2]);
        if (Number.isFinite(v)) {
          premiums.push(v);
          hit = true;
        }
      }
    };

    if (premiumCols.length > 0) {
      for (const r of t.rows) for (const j of premiumCols) pushFrom(r[j] ?? '');
    } else {
      // 无显式保费/保额档列头:矩阵体兜底——跳过首列(维度标签)、跳过"保额/额度值列"
      for (const r of t.rows) {
        for (let j = 1; j < r.length; j++) {
          const header = t.columns[j] ?? '';
          if (isCoverageValueHeader(header) || isDimensionHeader(header)) continue;
          pushFrom(r[j] ?? '');
        }
      }
    }
    if (hit) rowRefs.push(t.contextPath.join(' > '));
  }

  if (premiums.length === 0) {
    return ok({ ...base, matchTier: 'blank', basis: '价格表中未能隔离出保费(可能为纯费率/保额)', rowRefs, unavailableReason: 'no_premium_isolated' });
  }

  return ok({
    ...base,
    matchTier: 'bracket',
    premiumMinCny: Math.min(...premiums),
    premiumMaxCny: Math.max(...premiums),
    basis: `从 ${rowRefs.length} 处价格表隔离保费(已排除保额档与外币)`,
    rowRefs,
  });
}
