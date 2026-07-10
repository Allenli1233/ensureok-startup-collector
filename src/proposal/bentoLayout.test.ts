import { describe, expect, it } from 'vitest';
import { bentoLayout, type BentoItem } from './bentoLayout';

const items = (weights: number[]): BentoItem[] => weights.map((w, i) => ({ id: `L${i}`, weight: w, order: i }));
const CONT = { width: 1000, height: 600 };

describe('bentoLayout — squarified 完全密铺', () => {
  it('空输入 → []', () => {
    expect(bentoLayout([], CONT)).toEqual([]);
  });

  it('容器无面积 → []', () => {
    expect(bentoLayout(items([1, 2, 3]), { width: 0, height: 600 })).toEqual([]);
  });

  it('单项 → 铺满整个容器(去 gap)', () => {
    const [r] = bentoLayout(items([5]), CONT, { gap: 8 });
    expect(r.x).toBeCloseTo(4, 3);
    expect(r.y).toBeCloseTo(4, 3);
    expect(r.w).toBeCloseTo(992, 3);
    expect(r.h).toBeCloseTo(592, 3);
    expect(r.rank).toBe(0);
  });

  it('N 项 → N 个矩形,权重最高者 rank 0', () => {
    const rects = bentoLayout(items([1, 9, 3, 5]), CONT);
    expect(rects.length).toBe(4);
    const hero = rects.find((r) => r.rank === 0);
    expect(hero?.id).toBe('L1'); // weight 9 最高
  });

  it('gap=0 时完全铺满:总面积 ≈ 容器面积,块面积 ∝ 权重', () => {
    const rects = bentoLayout(items([4, 3, 2, 1]), CONT, { gap: 0 });
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(CONT.width * CONT.height, 0); // 无空洞、无溢出
    const areaOf = (id: string) => {
      const r = rects.find((x) => x.id === id)!;
      return r.w * r.h;
    };
    expect(areaOf('L0')).toBeGreaterThan(areaOf('L1'));
    expect(areaOf('L1')).toBeGreaterThan(areaOf('L2'));
    expect(areaOf('L2')).toBeGreaterThan(areaOf('L3'));
  });

  it('所有矩形都在容器边界内(gap=0)', () => {
    const rects = bentoLayout(items([5, 4, 4, 3, 2, 2, 1, 1]), CONT, { gap: 0 });
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(CONT.width + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(CONT.height + 1e-6);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it('确定性:同输入同输出', () => {
    const a = bentoLayout(items([3, 1, 4, 1, 5, 9, 2]), CONT);
    const b = bentoLayout(items([3, 1, 4, 1, 5, 9, 2]), CONT);
    expect(a).toEqual(b);
  });

  it('并列权重按 order 稳定 tiebreak', () => {
    const rects = bentoLayout(
      [
        { id: 'a', weight: 5, order: 0 },
        { id: 'b', weight: 5, order: 1 },
      ],
      CONT,
    );
    expect(rects.find((r) => r.id === 'a')!.rank).toBe(0);
    expect(rects.find((r) => r.id === 'b')!.rank).toBe(1);
  });
});
