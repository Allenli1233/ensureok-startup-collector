import type { MdTable } from '@ensureok/catalog';
import type { PricingHint } from './types';

const PRICING_DISCLAIMER = '参考区间 · 以保司实际报价为准 · 非成交报价,承保由合作持牌经纪机构完成';

/**
 * 从产品库价格表里确定性抽取人民币金额,估算参考年保费区间。
 * 只并入 ¥/元/万(跳过 $/HK$ 外币与纯 % 费率);数字全部来自产品库,LLM 不参与。
 * 这是 PR3b 的务实版(全档跨度区间);带维度的精确 matchTier 测算见设计 v3 §5.2,后续细化。
 */
export function buildPricing(tables: MdTable[], collectedAt?: string): PricingHint {
  const values: number[] = [];
  const re = /([\d,]+(?:\.\d+)?)\s*(万元|万|元)/g;
  for (const t of tables) {
    for (const row of t.rows) {
      for (const cell of row) {
        if (cell.includes('$')) continue; // 外币不并入人民币区间
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cell))) {
          const num = Number(m[1].replace(/,/g, ''));
          if (!Number.isFinite(num)) continue;
          values.push(m[2] === '元' ? num : num * 10_000);
        }
      }
    }
  }

  if (values.length === 0) {
    return {
      display: '价位待持牌经纪报价(该险种暂无公开价目表)',
      source: 'product_db',
      collectedAt,
      disclaimer: '承保由合作持牌经纪机构完成',
      unavailable: true,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const dateNote = collectedAt ? ` · 数据采集于 ${collectedAt}` : '';
  // 诚实标注:本区间是价格表内所有人民币金额的跨度,可能同时含"保额"与"保费"两类,
  // 故用中性措辞"价位区间"并引导下钻看精确价格表;按维度区分保费/保额的精确测算见设计 v3 §5.2(后续)。
  return {
    display: `参考价位区间约 ${fmtCny(min)}–${fmtCny(max)}(跨各档保额/职业,精确价见下钻价格表)`,
    minCny: min,
    maxCny: max,
    source: 'product_db',
    collectedAt,
    disclaimer: `${PRICING_DISCLAIMER}${dateNote}`,
    unavailable: false,
  };
}

function fmtCny(v: number): string {
  if (v >= 10_000) {
    const wan = v / 10_000;
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)}万元`;
  }
  return `${Math.round(v)}元`;
}
