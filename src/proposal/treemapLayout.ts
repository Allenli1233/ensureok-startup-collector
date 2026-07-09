/**
 * 体检报告可视化的几何基座 —— 纯函数「squarified treemap」布局。
 *
 * 无任何依赖(不引 React / DOM / 定时器 / 随机),同输入必得同输出。
 * 数据两层:外层按「紧迫度分组(group)」切块,内层把每组的「险种(node)」按权重再切块。
 *
 * 两种模式:
 *  - 'treemap':经典 squarified 算法(Bruls/Huizing/van Wijk 1999),优先让每块接近正方形,
 *    先在容器内按各组总权重切出组块,再在每个组块内按险种权重切出块。
 *  - 'stack' :窄屏降级,忽略二维打包,组=满宽横带、险种=满宽横行,高度 ∝ 权重,自上而下堆叠。
 *
 * 两处「有意的近似」(见 requirement,已在下方就地标注):
 *  1. min-floor 夹取:小于 minBlock 的块会被抬到 minBlock(宽和高都保底),牺牲最小块的面积精度,
 *     换取可点击 / 可读;夹取后若越界会被推回容器内,极端小块之间可能出现轻微重叠。
 *  2. 空组处理:总权重 <= 0 的组(即没有 node 的组)整组跳过,不占面积、不产出 group 矩形。
 */

export interface LayoutNode {
  id: string;
  /** 权重,必须 > 0 */
  weight: number;
}
export interface LayoutGroup {
  key: string;
  label: string;
  nodes: LayoutNode[];
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PlacedGroup {
  key: string;
  label: string;
  rect: Rect;
}
export interface PlacedBlock {
  id: string;
  groupKey: string;
  rect: Rect;
}
export interface LayoutResult {
  groups: PlacedGroup[];
  blocks: PlacedBlock[];
}

export type LayoutMode = 'treemap' | 'stack';

export interface LayoutOptions {
  /** 块 / 组之间的间距(内缩实现),默认 6 */
  gap?: number;
  /** 块的最小宽高保底(单位 px),默认 44,让最小块也可点可读 */
  minBlock?: number;
}

const DEFAULT_GAP = 6;
const DEFAULT_MIN_BLOCK = 44;

/** 内部:带面积的待布局项 */
interface Sized<T> {
  item: T;
  area: number;
}
interface Placed<T> {
  item: T;
  rect: Rect;
}

/**
 * 布局入口。
 * @param groups   两层数据(外组 + 内险种)
 * @param container 目标容器矩形
 * @param mode     'treemap' | 'stack'
 * @param opts     gap(默认 6)/ minBlock(默认 44)
 */
export function layoutReport(
  groups: LayoutGroup[],
  container: Rect,
  mode: LayoutMode,
  opts?: LayoutOptions,
): LayoutResult {
  const gap = opts?.gap ?? DEFAULT_GAP;
  const minBlock = opts?.minBlock ?? DEFAULT_MIN_BLOCK;

  // 只保留总权重 > 0 的组(空组 / 全零组直接跳过,不占面积)——见文件头「近似 2」。
  const kept = groups
    .map((g) => ({ group: g, total: groupWeight(g) }))
    .filter((g) => g.total > 0);

  if (kept.length === 0 || container.w <= 0 || container.h <= 0) {
    return { groups: [], blocks: [] };
  }

  if (mode === 'stack') {
    return layoutStack(kept, container, gap, minBlock);
  }
  return layoutTreemap(kept, container, gap, minBlock);
}

function groupWeight(g: LayoutGroup): number {
  let s = 0;
  for (const n of g.nodes) s += Math.max(0, n.weight);
  return s;
}

// ─────────────────────────── treemap 模式 ───────────────────────────

function layoutTreemap(
  kept: Array<{ group: LayoutGroup; total: number }>,
  container: Rect,
  gap: number,
  minBlock: number,
): LayoutResult {
  // 1) 容器内按组总权重做 squarified 切分(不排序,保持传入组顺序)。
  const groupSized: Sized<{ group: LayoutGroup; total: number }>[] = kept.map((g) => ({
    item: g,
    area: g.total,
  }));
  const placedGroups = squarify(groupSized, container);

  // 键 → 原始组块矩形(用于组内二次布局)。
  const rawGroupRect = new Map<string, Rect>();
  for (const pg of placedGroups) rawGroupRect.set(pg.item.group.key, pg.rect);

  const groups: PlacedGroup[] = [];
  const blocks: PlacedBlock[] = [];

  // 组矩形按「传入顺序」产出(squarify 本身已保序,这里再显式保序以防万一)。
  for (const { group } of kept) {
    const raw = rawGroupRect.get(group.key);
    if (!raw) continue;
    groups.push({
      key: group.key,
      label: group.label,
      rect: finalizeRect(inset(raw, gap), container, minBlock, false),
    });

    // 2) 组块内按险种权重再 squarify。险种降序排列以获得更方正的长宽比
    //    (输出顺序无契约要求;「更重的块面积更大」由面积构造天然保证)。
    const nodeSized: Sized<LayoutNode>[] = group.nodes
      .filter((n) => n.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((n) => ({ item: n, area: n.weight }));
    const placedNodes = squarify(nodeSized, raw);
    for (const pn of placedNodes) {
      blocks.push({
        id: pn.item.id,
        groupKey: group.key,
        rect: finalizeRect(inset(pn.rect, gap), container, minBlock, true),
      });
    }
  }

  return { groups, blocks };
}

/**
 * Squarified treemap 核心:把 items(面积 ∝ 权重)填满 rect,尽量让每块接近正方形。
 * 保持 items 传入顺序逐个消费(便于「保序」需求)。面积在填充前整体缩放到 rect 面积,
 * 因此(未做 gap/min-floor 前)总面积严格等于 rect 面积。
 */
function squarify<T>(items: Sized<T>[], rect: Rect): Placed<T>[] {
  const out: Placed<T>[] = [];
  const totalWeight = items.reduce((s, i) => s + i.area, 0);
  if (items.length === 0 || totalWeight <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  const scale = (rect.w * rect.h) / totalWeight;
  const rest: Sized<T>[] = items.map((i) => ({ item: i.item, area: i.area * scale }));

  let free: Rect = { ...rect };
  let row: Sized<T>[] = [];
  while (rest.length > 0) {
    const side = Math.min(free.w, free.h);
    const next = rest[0];
    if (row.length === 0 || worstRatio(row, side) >= worstRatio([...row, next], side)) {
      row.push(next);
      rest.shift();
    } else {
      free = layoutRow(row, free, out);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, free, out);
  return out;
}

/** 一行的最差长宽比(squarified 的贪心判据) */
function worstRatio<T>(row: Sized<T>[], side: number): number {
  if (row.length === 0 || side <= 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const r of row) {
    sum += r.area;
    if (r.area > max) max = r.area;
    if (r.area < min) min = r.area;
  }
  if (sum <= 0 || min <= 0) return Infinity;
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * 沿 free 矩形的短边铺一行,返回剩余矩形。短边为宽 → 顶部横条;短边为高 → 左侧竖条。
 * 面积守恒:条厚 = 行面积 / 短边长。
 */
function layoutRow<T>(row: Sized<T>[], free: Rect, out: Placed<T>[]): Rect {
  let rowArea = 0;
  for (const r of row) rowArea += r.area;

  if (free.w <= free.h) {
    // 顶部横条:高 = rowArea / 宽,块沿宽度方向排布
    const h = free.w > 0 ? rowArea / free.w : 0;
    let x = free.x;
    for (const r of row) {
      const w = h > 0 ? r.area / h : 0;
      out.push({ item: r.item, rect: { x, y: free.y, w, h } });
      x += w;
    }
    return { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
  }
  // 左侧竖条:宽 = rowArea / 高,块沿高度方向排布
  const w = free.h > 0 ? rowArea / free.h : 0;
  let y = free.y;
  for (const r of row) {
    const h = w > 0 ? r.area / w : 0;
    out.push({ item: r.item, rect: { x: free.x, y, w, h } });
    y += h;
  }
  return { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
}

// ─────────────────────────── stack 模式 ───────────────────────────

function layoutStack(
  kept: Array<{ group: LayoutGroup; total: number }>,
  container: Rect,
  gap: number,
  minBlock: number,
): LayoutResult {
  const totalW = kept.reduce((s, g) => s + g.total, 0);
  const groups: PlacedGroup[] = [];
  const blocks: PlacedBlock[] = [];

  let y = container.y;
  for (const { group, total } of kept) {
    const groupRawH = totalW > 0 ? (total / totalW) * container.h : 0;
    const startY = y;

    for (const node of group.nodes) {
      if (node.weight <= 0) continue;
      const nodeRawH = total > 0 ? (node.weight / total) * groupRawH : 0;
      const nh = Math.max(nodeRawH, minBlock); // min-floor 高度保底
      const raw: Rect = { x: container.x, y, w: container.w, h: nh };
      blocks.push({
        id: node.id,
        groupKey: group.key,
        rect: finalizeRect(inset(raw, gap), container, minBlock, false),
      });
      y += nh;
    }

    // 组带高度 = 其内所有块的实际高度之和,天然包住这些块。
    const bandRaw: Rect = { x: container.x, y: startY, w: container.w, h: y - startY };
    groups.push({
      key: group.key,
      label: group.label,
      rect: finalizeRect(inset(bandRaw, gap), container, minBlock, false),
    });
  }

  return { groups, blocks };
}

// ─────────────────────────── 通用几何工具 ───────────────────────────

/** 四周各内缩 gap/2,使相邻矩形之间形成 gap 的间隙;宽高不小于 0。 */
function inset(r: Rect, gap: number): Rect {
  const half = gap / 2;
  return {
    x: r.x + half,
    y: r.y + half,
    w: Math.max(0, r.w - gap),
    h: Math.max(0, r.h - gap),
  };
}

/**
 * 收尾:可选地对块做 min-floor 保底,再把矩形夹回容器内,保证不越界。
 * @param applyFloor 仅对「块」保底;组矩形(已由内容撑开)不再抬升。
 */
function finalizeRect(r: Rect, container: Rect, minBlock: number, applyFloor: boolean): Rect {
  let { x, y, w, h } = r;
  if (applyFloor) {
    // min-floor:宽高都抬到 minBlock(牺牲最小块面积精度,换可点可读)——见文件头「近似 1」。
    w = Math.max(w, minBlock);
    h = Math.max(h, minBlock);
  }
  // 夹回容器:先限尺寸不超过容器,再推回边界内。
  w = Math.min(w, container.w);
  h = Math.min(h, container.h);
  if (x < container.x) x = container.x;
  if (y < container.y) y = container.y;
  if (x + w > container.x + container.w) x = container.x + container.w - w;
  if (y + h > container.y + container.h) y = container.y + container.h - h;
  return { x, y, w, h };
}
