import { describe, expect, it } from 'vitest';
import { bentoLayout, type BentoItem, type Placement } from './bentoLayout';

/** 造一批权重递减的 item(order = 传入序) */
function mk(weights: number[]): BentoItem[] {
  return weights.map((weight, i) => ({ id: `n${i}`, weight, order: i }));
}
function area(p: Placement): number {
  return p.colSpan * p.rowSpan;
}
function byId(res: Placement[], id: string): Placement {
  const p = res.find((x) => x.id === id);
  if (!p) throw new Error(`placement ${id} not found`);
  return p;
}

describe('bentoLayout — hero 与排名', () => {
  it('rank 0 = 全局最大权重、且 span==="2x2"(hero)', () => {
    // 传入序打乱:最大权重不在首位
    const items: BentoItem[] = [
      { id: 'small', weight: 30, order: 0 },
      { id: 'big', weight: 140, order: 1 },
      { id: 'mid', weight: 72, order: 2 },
    ];
    const res = bentoLayout(items);
    const hero = res.find((p) => p.rank === 0)!;
    expect(hero.id).toBe('big');
    expect(hero.span).toBe('2x2');
  });

  it('并列权重:order 较小者排前(确定性 tiebreak)', () => {
    const items: BentoItem[] = [
      { id: 'b', weight: 100, order: 5 },
      { id: 'a', weight: 100, order: 2 },
    ];
    const res = bentoLayout(items);
    expect(res[0].id).toBe('a');
    expect(res[0].rank).toBe(0);
    expect(res[1].id).toBe('b');
  });
});

describe('bentoLayout — 单调性(权重越大块不越小)', () => {
  it('hero 面积 ≥ 任意非 hero', () => {
    const res = bentoLayout(mk([140, 120, 100, 60, 40, 20]));
    const hero = res.find((p) => p.rank === 0)!;
    for (const p of res) {
      if (p.rank !== 0) expect(area(hero)).toBeGreaterThanOrEqual(area(p));
    }
  });

  it('按 rank 递增,面积单调不增(更大权重不给更小档)', () => {
    const res = bentoLayout(mk([140, 130, 100, 80, 55, 40, 20, 10]));
    // res 已按 rank 升序
    for (let i = 1; i < res.length; i++) {
      expect(area(res[i])).toBeLessThanOrEqual(area(res[i - 1]));
    }
  });
});

describe('bentoLayout — 分档边界', () => {
  const max = 100;
  it('r ≥ 0.8 → 2x2', () => {
    // rank0=max(hero), 第二项 r=0.85 → 2x2
    const res = bentoLayout(mk([max, 85]));
    expect(byId(res, 'n1').span).toBe('2x2');
  });

  it('0.55 ≤ r < 0.8 → 交替 2x1(偶)/ 1x2(奇)', () => {
    // 两个都落在 [0.55,0.8):第一个非 hero(i=0,偶)→2x1,第二个(i=1,奇)→1x2
    const res = bentoLayout(mk([max, 70, 60]));
    expect(byId(res, 'n1').span).toBe('2x1');
    expect(byId(res, 'n2').span).toBe('1x2');
  });

  it('0.35 ≤ r < 0.55 → 1x2', () => {
    const res = bentoLayout(mk([max, 40]));
    expect(byId(res, 'n1').span).toBe('1x2');
  });

  it('r < 0.35 → 1x1', () => {
    const res = bentoLayout(mk([max, 20]));
    expect(byId(res, 'n1').span).toBe('1x1');
  });
});

describe('bentoLayout — 窄屏 columns:2', () => {
  it('所有 colSpan ≤ 2;hero 仍 2x2', () => {
    const res = bentoLayout(mk([140, 130, 100, 80, 55, 40, 20]), { columns: 2 });
    const hero = res.find((p) => p.rank === 0)!;
    expect(hero.span).toBe('2x2');
    for (const p of res) expect(p.colSpan).toBeLessThanOrEqual(2);
  });

  it('非 hero 的 2x2 在 2 列下收成 2x1(rowSpan 降为 1)', () => {
    // n1 权重 0.9*max → 4 列本是 2x2;2 列降级 → 2x1
    const res = bentoLayout(mk([100, 90]), { columns: 2 });
    expect(byId(res, 'n1').span).toBe('2x1');
    expect(byId(res, 'n1').rowSpan).toBe(1);
  });
});

describe('bentoLayout — 边界', () => {
  it('空输入 → []', () => {
    expect(bentoLayout([])).toEqual([]);
  });

  it('单险种 → 单 hero 2x2', () => {
    const res = bentoLayout(mk([100]));
    expect(res).toHaveLength(1);
    expect(res[0].rank).toBe(0);
    expect(res[0].span).toBe('2x2');
  });

  it('确定性:同输入同输出', () => {
    const items = mk([140, 72, 72, 30, 30, 10]);
    expect(bentoLayout(items)).toEqual(bentoLayout(items));
  });
});
