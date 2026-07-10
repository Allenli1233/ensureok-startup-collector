/**
 * Bento 密铺布局 —— 纯函数(无 React / DOM / 随机 / 定时器,同输入同输出,可单测)。
 *
 * 用途:把「险种 → 权重」的扁平序列铺满一个矩形容器,返回每格的绝对矩形 {x,y,w,h}。
 * 用 squarified treemap:**100% 铺满、无空洞、无参差末行**,块面积 ∝ 权重、近正方形。
 * 换掉旧的 CSS Grid span 方案——那个在险种多时会留空洞、露出背景(白斑),无法完全铺满。
 *
 * 权重来自 reportModel(itemWeight / buildReportGroups),本层不感知业务,只做确定性密铺。
 * gap 通过对每块内缩实现(相邻块之间留 gap,统一走暗底,不再有白色留白)。
 */

export interface BentoItem {
  id: string;
  weight: number;
  /** 展开序:并列权重时的稳定 tiebreak */
  order: number;
}

export interface BentoContainer {
  width: number;
  height: number;
}

export interface BentoRect {
  /** = lineId */
  id: string;
  /** 0 = hero(全局权重最高) */
  rank: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BentoOptions {
  /** 相邻块间隙(每块内缩 gap/2),默认 8 */
  gap?: number;
}

interface SqNode {
  id: string;
  area: number;
}

/**
 * squarified treemap:把 children(带 area)完全密铺进 rect,返回每项矩形。
 * 贪心成行、按最短边铺,尽量让每块接近正方形;末行消费剩余空间 → 精确铺满。
 */
function squarify(children: Array<{ id: string; weight: number }>, rect: { x: number; y: number; w: number; h: number }): BentoRect[] {
  const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  const total = children.reduce((s, c) => s + c.weight, 0) || 1;
  const nodes: SqNode[] = children.map((c) => ({ id: c.id, area: (c.weight / total) * rect.w * rect.h }));

  let { x, y, w, h } = rect;
  let row: SqNode[] = [];

  const worst = (r: SqNode[], side: number): number => {
    if (r.length === 0) return Infinity;
    const s = r.reduce((a, c) => a + c.area, 0);
    const mx = Math.max(...r.map((c) => c.area));
    const mn = Math.min(...r.map((c) => c.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };

  const layRow = (r: SqNode[]): void => {
    const s = r.reduce((a, c) => a + c.area, 0);
    if (s <= 0) return;
    if (w >= h) {
      const dw = s / h; // 竖条:一列,宽 dw,高各自 area/dw
      let cy = y;
      for (const c of r) {
        const dh = c.area / dw;
        out.push({ id: c.id, x, y: cy, w: dw, h: dh });
        cy += dh;
      }
      x += dw;
      w -= dw;
    } else {
      const dh = s / w; // 横条:一行,高 dh,宽各自 area/dh
      let cx = x;
      for (const c of r) {
        const dw2 = c.area / dh;
        out.push({ id: c.id, x: cx, y, w: dw2, h: dh });
        cx += dw2;
      }
      y += dh;
      h -= dh;
    }
  };

  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, nodes[i]], side) <= worst(row, side)) {
      row.push(nodes[i]);
      i += 1;
    } else {
      layRow(row);
      row = [];
    }
  }
  if (row.length) layRow(row);

  return out.map((r) => ({ ...r, rank: 0 }));
}

/**
 * 纯函数:items + 容器 → 完全铺满容器的矩形数组(每块已按 gap 内缩)。
 * 输出顺序 = 权重降序(order 为并列 tiebreak);rank 0 = hero。
 */
export function bentoLayout(items: BentoItem[], container: BentoContainer, opts?: BentoOptions): BentoRect[] {
  const gap = opts?.gap ?? 8;
  if (items.length === 0 || container.width <= 0 || container.height <= 0) return [];

  const ranked = [...items].sort((a, b) => b.weight - a.weight || a.order - b.order);
  const rankOf = new Map(ranked.map((it, idx) => [it.id, idx]));

  const rects = squarify(
    ranked.map((it) => ({ id: it.id, weight: Math.max(it.weight, 1e-4) })),
    { x: 0, y: 0, w: container.width, h: container.height },
  );

  const inset = gap / 2;
  return rects.map((r) => ({
    id: r.id,
    rank: rankOf.get(r.id) ?? 0,
    x: r.x + inset,
    y: r.y + inset,
    w: Math.max(0, r.w - gap),
    h: Math.max(0, r.h - gap),
  }));
}
