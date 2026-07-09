import { describe, expect, it } from 'vitest';
import {
  layoutReport,
  type LayoutGroup,
  type LayoutResult,
  type Rect,
} from './treemapLayout';

const container: Rect = { x: 0, y: 0, w: 800, h: 600 };

function area(r: Rect): number {
  return r.w * r.h;
}
function within(r: Rect, c: Rect, eps = 1e-6): boolean {
  return (
    r.x >= c.x - eps &&
    r.y >= c.y - eps &&
    r.x + r.w <= c.x + c.w + eps &&
    r.y + r.h <= c.y + c.h + eps
  );
}
function aspect(r: Rect): number {
  if (r.w <= 0 || r.h <= 0) return Infinity;
  return Math.max(r.w / r.h, r.h / r.w);
}
function blockById(res: LayoutResult, id: string): Rect {
  const b = res.blocks.find((x) => x.id === id);
  if (!b) throw new Error(`block ${id} not found`);
  return b.rect;
}

const threeGroups: LayoutGroup[] = [
  {
    key: 'tier1',
    label: '必配',
    nodes: [
      { id: 'a', weight: 8 },
      { id: 'b', weight: 3 },
      { id: 'c', weight: 1 },
    ],
  },
  {
    key: 'tier2',
    label: '强烈建议',
    nodes: [
      { id: 'd', weight: 5 },
      { id: 'e', weight: 2 },
    ],
  },
  {
    key: 'tier3',
    label: '可选',
    nodes: [{ id: 'f', weight: 4 }],
  },
];

describe('layoutReport — treemap', () => {
  it('面积近似守恒(gap=0, minBlock=0 时严格等于容器面积)', () => {
    const res = layoutReport(threeGroups, container, 'treemap', { gap: 0, minBlock: 0 });
    const sum = res.blocks.reduce((s, b) => s + area(b.rect), 0);
    // squarify 填充前整体缩放,总面积应等于容器面积(浮点误差极小)。
    expect(Math.abs(sum - area(container))).toBeLessThan(area(container) * 1e-6);
  });

  it('所有块与组矩形都不越界', () => {
    const res = layoutReport(threeGroups, container, 'treemap');
    for (const b of res.blocks) expect(within(b.rect, container)).toBe(true);
    for (const g of res.groups) expect(within(g.rect, container)).toBe(true);
  });

  it('同组内更重的险种得到更大的块', () => {
    const res = layoutReport(threeGroups, container, 'treemap', { gap: 0, minBlock: 0 });
    // tier1: a(8) > b(3) > c(1)
    expect(area(blockById(res, 'a'))).toBeGreaterThan(area(blockById(res, 'b')));
    expect(area(blockById(res, 'b'))).toBeGreaterThan(area(blockById(res, 'c')));
    // tier2: d(5) > e(2)
    expect(area(blockById(res, 'd'))).toBeGreaterThan(area(blockById(res, 'e')));
  });

  it('组顺序保持传入顺序', () => {
    const res = layoutReport(threeGroups, container, 'treemap');
    expect(res.groups.map((g) => g.key)).toEqual(['tier1', 'tier2', 'tier3']);
  });

  it('长宽比合理(squarified 不产生极端狭长块,< 6)', () => {
    const spread: LayoutGroup[] = [
      {
        key: 'g',
        label: 'spread',
        nodes: [1, 2, 3, 4, 5, 6, 8, 13].map((w, i) => ({ id: `n${i}`, weight: w })),
      },
    ];
    const res = layoutReport(spread, { x: 0, y: 0, w: 1000, h: 700 }, 'treemap', {
      gap: 0,
      minBlock: 0,
    });
    const maxAr = Math.max(...res.blocks.map((b) => aspect(b.rect)));
    expect(maxAr).toBeLessThan(6);
  });

  it('gap 生效:块之间留有间隙(块被内缩)', () => {
    const noGap = layoutReport(threeGroups, container, 'treemap', { gap: 0, minBlock: 0 });
    const withGap = layoutReport(threeGroups, container, 'treemap', { gap: 20, minBlock: 0 });
    const sumNoGap = noGap.blocks.reduce((s, b) => s + area(b.rect), 0);
    const sumGap = withGap.blocks.reduce((s, b) => s + area(b.rect), 0);
    expect(sumGap).toBeLessThan(sumNoGap);
  });
});

describe('layoutReport — stack', () => {
  const oneGroup: LayoutGroup[] = [
    {
      key: 'only',
      label: '单组',
      nodes: [
        { id: 'big', weight: 3 },
        { id: 'small', weight: 1 },
      ],
    },
  ];
  const c: Rect = { x: 0, y: 0, w: 400, h: 1000 };

  it('块高 ∝ 权重(gap=0, minBlock=0),更重更高', () => {
    const res = layoutReport(oneGroup, c, 'stack', { gap: 0, minBlock: 0 });
    const big = blockById(res, 'big');
    const small = blockById(res, 'small');
    expect(big.h).toBeGreaterThan(small.h);
    // 3:1 权重 → 高度比约 3(容差)
    expect(Math.abs(big.h / small.h - 3)).toBeLessThan(0.01);
  });

  it('满宽 + 垂直顺序保持', () => {
    const res = layoutReport(oneGroup, c, 'stack', { gap: 0, minBlock: 0 });
    for (const b of res.blocks) {
      expect(b.rect.x).toBe(0);
      expect(b.rect.w).toBe(400);
    }
    const big = blockById(res, 'big');
    const small = blockById(res, 'small');
    expect(big.y).toBeLessThan(small.y); // big 在前
  });

  it('minBlock 高度保底:极小权重的块被抬到 minBlock', () => {
    const skewed: LayoutGroup[] = [
      {
        key: 'k',
        label: 'k',
        nodes: [
          { id: 'huge', weight: 1000 },
          { id: 'tiny', weight: 1 },
        ],
      },
    ];
    const res = layoutReport(skewed, { x: 0, y: 0, w: 400, h: 400 }, 'stack', {
      gap: 0,
      minBlock: 44,
    });
    const tiny = blockById(res, 'tiny');
    expect(tiny.h).toBe(44);
    expect(tiny.w).toBe(400);
  });

  it('多组:各组带自上而下、顺序保持', () => {
    const res = layoutReport(threeGroups, { x: 0, y: 0, w: 400, h: 900 }, 'stack', {
      gap: 0,
      minBlock: 0,
    });
    expect(res.groups.map((g) => g.key)).toEqual(['tier1', 'tier2', 'tier3']);
    // 组带 y 递增
    for (let i = 1; i < res.groups.length; i++) {
      expect(res.groups[i].rect.y).toBeGreaterThanOrEqual(res.groups[i - 1].rect.y);
    }
    // tier1 总权重 12 > tier2 的 7 > tier3 的 4 → 组带更高
    const h = (k: string) => res.groups.find((g) => g.key === k)!.rect.h;
    expect(h('tier1')).toBeGreaterThan(h('tier2'));
    expect(h('tier2')).toBeGreaterThan(h('tier3'));
  });
});

describe('layoutReport — 边界情况', () => {
  it('空输入 → 空结果', () => {
    const res = layoutReport([], container, 'treemap');
    expect(res.groups).toEqual([]);
    expect(res.blocks).toEqual([]);
  });

  it('单组单节点 → 占满容器(减去 gap)', () => {
    const one: LayoutGroup[] = [{ key: 'k', label: 'k', nodes: [{ id: 'x', weight: 1 }] }];
    const res = layoutReport(one, container, 'treemap', { gap: 0, minBlock: 0 });
    expect(res.blocks).toHaveLength(1);
    expect(Math.abs(area(res.blocks[0].rect) - area(container))).toBeLessThan(1e-3);
    expect(within(res.blocks[0].rect, container)).toBe(true);
  });

  it('无节点的组被跳过(不产出组矩形,不崩溃)', () => {
    const mixed: LayoutGroup[] = [
      { key: 'empty', label: '空', nodes: [] },
      { key: 'full', label: '有', nodes: [{ id: 'x', weight: 1 }] },
    ];
    const res = layoutReport(mixed, container, 'treemap');
    expect(res.groups.map((g) => g.key)).toEqual(['full']);
    expect(res.blocks.map((b) => b.id)).toEqual(['x']);
  });

  it('全等权重不崩溃且每块面积相近', () => {
    const equal: LayoutGroup[] = [
      {
        key: 'g',
        label: 'g',
        nodes: [1, 2, 3, 4].map((n) => ({ id: `n${n}`, weight: 1 })),
      },
    ];
    const res = layoutReport(equal, { x: 0, y: 0, w: 400, h: 400 }, 'treemap', {
      gap: 0,
      minBlock: 0,
    });
    expect(res.blocks).toHaveLength(4);
    const areas = res.blocks.map((b) => area(b.rect));
    const maxA = Math.max(...areas);
    const minA = Math.min(...areas);
    expect(maxA - minA).toBeLessThan(1e-6);
  });

  it('stack 空输入 / 退化容器 → 空结果,不崩溃', () => {
    expect(layoutReport([], container, 'stack').blocks).toEqual([]);
    const one: LayoutGroup[] = [{ key: 'k', label: 'k', nodes: [{ id: 'x', weight: 1 }] }];
    expect(layoutReport(one, { x: 0, y: 0, w: 0, h: 0 }, 'treemap').blocks).toEqual([]);
  });
});
