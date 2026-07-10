/**
 * Bento 网格 span 分配 —— 纯函数(无 React / DOM / 随机 / 定时器,同输入同输出,可单测)。
 *
 * 用途:把「险种 → 权重」的扁平序列映射成 Bento CSS Grid 的每格跨度(colSpan/rowSpan)。
 * 权重仍来自 reportModel(itemWeight / buildReportGroups),本层不感知业务,只做确定性分档。
 *
 * 分档规则(设计规格 §2.2):
 *   1. weight 降序、order(展开序)为并列 tiebreak,排出 rank(0-based)。
 *   2. rank===0 → '2x2'(hero,全局权重最高)。
 *   3. 其余按 r = weight / maxWeight 分档:
 *        r ≥ 0.80              → '2x2'
 *        0.55 ≤ r < 0.80       → i 偶 '2x1'(宽)/ 奇 '1x2'(高)(交替制造节奏,i = 非 hero 序)
 *        0.35 ≤ r < 0.55       → '1x2'(高)
 *        r < 0.35              → '1x1'
 *   4. 窄屏(columns===2):hero 仍 '2x2'(整宽两行);非 hero 的 '2x2' 收成 '2x1'
 *      (避免非 hero 满宽两行喧宾夺主),其余保持;所有 colSpan ≤ 2,2 列不溢出。
 *
 * 之所以用「比值分档 + grid-auto-flow: dense」而非精确二维装箱:CSS Grid dense 会自动回填
 * 空洞,无需自写装箱;分档保证「权重越大块越大」的单调直觉(hero 最大,其后 2×2 > 2×1/1×2 > 1×1)。
 */

export type BentoSpan = '2x2' | '2x1' | '1x2' | '1x1';

const SPAN_DIMS: Record<BentoSpan, { colSpan: 1 | 2; rowSpan: 1 | 2 }> = {
  '2x2': { colSpan: 2, rowSpan: 2 },
  '2x1': { colSpan: 2, rowSpan: 1 },
  '1x2': { colSpan: 1, rowSpan: 2 },
  '1x1': { colSpan: 1, rowSpan: 1 },
};

export interface Placement {
  /** = lineId */
  id: string;
  /** 0 = hero(全局权重最高) */
  rank: number;
  span: BentoSpan;
  colSpan: number;
  rowSpan: number;
}

export interface BentoItem {
  id: string;
  weight: number;
  /** 展开序:并列权重时的稳定 tiebreak */
  order: number;
}

export interface BentoOptions {
  /** 网格列数;默认 4,窄屏传 2 */
  columns?: 2 | 4;
}

/** 窄屏(2 列)降级:非 hero 的 2x2 收成 2x1;其余保持(所有 colSpan ≤ 2)。 */
function narrow(span: BentoSpan): BentoSpan {
  return span === '2x2' ? '2x1' : span;
}

/**
 * 纯函数:items → Placement[](已含 span/colSpan/rowSpan)。
 * 输出顺序 = 按 rank 升序(权重降序,order 为并列 tiebreak),确定性。
 */
export function bentoLayout(items: BentoItem[], opts?: BentoOptions): Placement[] {
  const columns = opts?.columns ?? 4;
  if (items.length === 0) return [];

  const ranked = [...items].sort((a, b) => b.weight - a.weight || a.order - b.order);
  const maxWeight = ranked[0].weight;

  let nonHeroIndex = 0; // rank≥1 内的序,用于 0.55–0.80 档交替
  return ranked.map((it, rank) => {
    let span: BentoSpan;
    if (rank === 0) {
      span = '2x2';
    } else {
      const r = maxWeight > 0 ? it.weight / maxWeight : 0;
      if (r >= 0.8) span = '2x2';
      else if (r >= 0.55) span = nonHeroIndex % 2 === 0 ? '2x1' : '1x2';
      else if (r >= 0.35) span = '1x2';
      else span = '1x1';
      nonHeroIndex += 1;
      if (columns === 2) span = narrow(span);
    }
    const dims = SPAN_DIMS[span];
    return { id: it.id, rank, span, colSpan: dims.colSpan, rowSpan: dims.rowSpan };
  });
}
