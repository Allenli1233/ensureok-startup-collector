import { describe, expect, it } from 'vitest';
import {
  URGENCY_BASE,
  TIER_MULT,
  itemWeight,
  buildReportGroups,
  blockColor,
  mixHex,
  parseHex,
} from './reportModel';
import type { ProposalItem } from './types';

/** 造一个最小 ProposalItem(只填 treemap 关心的字段) */
function mk(lineId: string, urgency: ProposalItem['urgency'], tier: ProposalItem['tier'], extra: Partial<ProposalItem> = {}): ProposalItem {
  return {
    lineId,
    lineName: `险种_${lineId}`,
    urgency,
    tier,
    gapTitles: [],
    coverageDirection: '',
    rationale: '',
    keyClauses: [],
    recommendedProducts: [],
    pricing: { display: '', disclaimer: '', unavailable: true },
    drilldownSourceFile: null,
    citations: [],
    evidenceInsufficient: false,
    ...extra,
  };
}

describe('itemWeight — 紧迫度基权 × tier 系数(§3.1)', () => {
  it('基权与系数按契约取值', () => {
    expect(URGENCY_BASE).toEqual({ mandatory: 64, high: 52, advice: 40 });
    expect(TIER_MULT).toEqual({ tier1: 1.12, tier2: 1.06, tier3: 1.0, tier4: 0.96 });
  });

  it('使用压缩后的面积权重,同时保留紧迫度和层级差异', () => {
    expect(itemWeight(mk('a', 'mandatory', 'tier1'))).toBeCloseTo(71.68, 5);
    expect(itemWeight(mk('b', 'high', 'tier2'))).toBeCloseTo(55.12, 5);
    expect(itemWeight(mk('c', 'advice', 'tier3'))).toBe(40);
    expect(itemWeight(mk('d', 'advice', 'tier4'))).toBeCloseTo(38.4, 5);
  });

  it('更紧迫 / 更高层级 → 权重更大(面积更大的单调性)', () => {
    expect(itemWeight(mk('x', 'mandatory', 'tier1'))).toBeGreaterThan(itemWeight(mk('y', 'high', 'tier1')));
    expect(itemWeight(mk('x', 'high', 'tier1'))).toBeGreaterThan(itemWeight(mk('y', 'high', 'tier3')));
  });

  it('字段异常时退回中性默认,永不 0 / NaN', () => {
    const weird = mk('w', 'unknown' as ProposalItem['urgency'], 'tierX' as ProposalItem['tier']);
    const w = itemWeight(weird);
    expect(Number.isFinite(w)).toBe(true);
    expect(w).toBeGreaterThan(0);
  });
});

describe('buildReportGroups — 分组顺序 / 空组 / 单组', () => {
  it('固定顺序 强制→高优先→建议,node.id = lineId', () => {
    const items = [
      mk('adv', 'advice', 'tier3'),
      mk('man', 'mandatory', 'tier1'),
      mk('hi', 'high', 'tier2'),
    ];
    const groups = buildReportGroups(items);
    expect(groups.map((g) => g.key)).toEqual(['mandatory', 'high', 'advice']);
    expect(groups[0].nodes[0].id).toBe('man');
    expect(groups[0].nodes[0].weight).toBeCloseTo(71.68, 5);
  });

  it('空组不产出(全部 advice → 只有一组)', () => {
    const groups = buildReportGroups([mk('a', 'advice', 'tier3'), mk('b', 'advice', 'tier4')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('advice');
    expect(groups[0].nodes).toHaveLength(2);
  });

  it('单险种 → 单组单节点仍成立', () => {
    const groups = buildReportGroups([mk('only', 'mandatory', 'tier1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodes).toHaveLength(1);
  });

  it('空 items → 空数组(不崩)', () => {
    expect(buildReportGroups([])).toEqual([]);
  });

  it('同组内保持传入顺序', () => {
    const groups = buildReportGroups([mk('m1', 'mandatory', 'tier1'), mk('m2', 'mandatory', 'tier2')]);
    expect(groups[0].nodes.map((n) => n.id)).toEqual(['m1', 'm2']);
  });
});

describe('blockColor — 深红→浅灰红 + qualityScore 微调 + 缺省降级', () => {
  it('缺 qualityScore → 使用强制深红 / 高优先正红 / 建议浅灰红,互不相同', () => {
    const man = blockColor('mandatory').fill;
    const hi = blockColor('high').fill;
    const adv = blockColor('advice').fill;
    expect(man).toBe('#9F2F2A');
    expect(hi).toBe('#B54335');
    expect(adv).toBe('#80635F');
    expect(new Set([man, hi, adv]).size).toBe(3);
  });

  it('WCAG:白字(#fbf6f0)对比在基色与任意 qualityScore 微调下均 ≥4.5:1(回归)', () => {
    const relLum = (hex: string): number => {
      const [r, g, b] = parseHex(hex).map((v) => v / 255);
      const f = (x: number): number => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: string, b: string): number => {
      const la = relLum(a) + 0.05;
      const lb = relLum(b) + 0.05;
      return la > lb ? la / lb : lb / la;
    };
    for (const u of ['mandatory', 'high', 'advice'] as const) {
      for (const q of [undefined, 0, 55, 75, 95, 100]) {
        expect(ratio(blockColor(u, q).fill, '#fbf6f0')).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('高分更暖亮、低分更克制:同紧迫度不同分 → 填充色不同', () => {
    const high = blockColor('mandatory', 95).fill;
    const low = blockColor('mandatory', 55).fill;
    expect(high).not.toBe(low);
    // 都是合法 6 位 hex
    expect(high).toMatch(/^#[0-9a-f]{6}$/i);
    expect(low).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('glow 是低透明度 rgba(用于光晕 box-shadow)', () => {
    expect(blockColor('advice').glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.42\)$/);
  });

  it('未知紧迫度 → 退回 advice 基色,不崩', () => {
    expect(blockColor('nope' as never).fill).toBe('#80635F');
  });
});

describe('颜色工具纯函数', () => {
  it('parseHex 支持 3 / 6 位', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#B85C3C')).toEqual([184, 92, 60]);
  });
  it('mixHex t=0 得 a,t=1 得 b,中点在两端之间', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
