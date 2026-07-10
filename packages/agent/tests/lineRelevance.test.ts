import { describe, expect, it } from 'vitest';
import { RELEVANCE_THRESHOLD, lineRelevance } from '../src/lineRelevance';
import type { ProposalRequest } from '../src/types';

type Profile = ProposalRequest['profile'];
const p = (over: Partial<Profile>): Profile => ({ ...over });
const score = (m: Map<string, { score: number }>, id: string): number => m.get(id)?.score ?? 0;

// 产品库 12 险种合法 key 集合
const VALID_LINES = new Set([
  'employer_liability',
  'product_liability',
  'public_liability',
  'group_accident',
  'directors_officers',
  'cyber',
  'ip',
  'tech_eo',
  'ai_liability',
  'cargo',
  'credit_surety',
  'environmental',
]);

describe('lineRelevance — 死库存接通(核心目标)', () => {
  it('hardware 画像 → environmental/cargo/product/public 均可达', () => {
    const m = lineRelevance(p({ industryValue: 'hardware' }));
    expect(score(m, 'environmental')).toBeGreaterThanOrEqual(2);
    expect(score(m, 'cargo')).toBeGreaterThanOrEqual(2);
    expect(score(m, 'product_liability')).toBeGreaterThanOrEqual(3);
    expect(score(m, 'public_liability')).toBeGreaterThanOrEqual(3);
    expect(score(m, 'credit_surety')).toBeGreaterThanOrEqual(2);
  });

  it('overseas && hasPhysicalProduct → cargo≥3、credit_surety≥2、product 命中', () => {
    const m = lineRelevance(p({ overseas: true, hasPhysicalProduct: true }));
    expect(score(m, 'cargo')).toBeGreaterThanOrEqual(3);
    expect(score(m, 'credit_surety')).toBeGreaterThanOrEqual(2);
    expect(score(m, 'product_liability')).toBeGreaterThanOrEqual(2);
  });

  it('ecom 画像 → credit_surety≥2、public≥3、cargo 命中', () => {
    const m = lineRelevance(p({ industryValue: 'ecom' }));
    expect(score(m, 'credit_surety')).toBeGreaterThanOrEqual(2);
    expect(score(m, 'public_liability')).toBeGreaterThanOrEqual(3);
    expect(score(m, 'cargo')).toBeGreaterThanOrEqual(2);
  });
});

describe('lineRelevance — fintech 不再引用不存在的 crime', () => {
  it('fintech → tech_eo + cyber,key 集合 ⊆ 合法 12 险种(无 crime/未知 key)', () => {
    const m = lineRelevance(p({ industryValue: 'fintech' }));
    expect(score(m, 'tech_eo')).toBe(3);
    expect(score(m, 'cyber')).toBeGreaterThanOrEqual(2);
    const keys = [...m.keys()] as string[];
    for (const key of keys) expect(VALID_LINES.has(key)).toBe(true);
    expect(keys).not.toContain('crime');
  });

  it('fintech + dataSensitive → cyber 加权到 4(cap)', () => {
    const m = lineRelevance(p({ industryValue: 'fintech', dataSensitive: true }));
    expect(score(m, 'cyber')).toBe(4);
  });
});

describe('lineRelevance — 基线与加权', () => {
  it('employer_liability 随人数单调递增', () => {
    const lo = score(lineRelevance(p({ headcountValue: 'lt10' })), 'employer_liability');
    const hi = score(lineRelevance(p({ headcountValue: 'gt100' })), 'employer_liability');
    expect(lo).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
    expect(hi).toBeGreaterThan(lo);
  });

  it('group_accident:hc<2 不出,hc≥2 出', () => {
    expect(score(lineRelevance(p({ headcountValue: 'lt10' })), 'group_accident')).toBe(0);
    expect(score(lineRelevance(p({ headcountValue: '10to30' })), 'group_accident')).toBeGreaterThanOrEqual(2);
  });

  it('directors_officers 随融资阶段增(pre_a < ipo),funding<pre_a 不出', () => {
    expect(score(lineRelevance(p({ fundingValue: 'angel' })), 'directors_officers')).toBe(0);
    const preA = score(lineRelevance(p({ fundingValue: 'pre_a' })), 'directors_officers');
    const ipo = score(lineRelevance(p({ fundingValue: 'ipo' })), 'directors_officers');
    expect(preA).toBeGreaterThanOrEqual(2);
    expect(ipo).toBeGreaterThan(preA);
  });

  it('ip:hasPatent 命中;ai/hardware 命中', () => {
    expect(score(lineRelevance(p({ hasPatent: true })), 'ip')).toBeGreaterThanOrEqual(3);
    expect(score(lineRelevance(p({ industryValue: 'ai' })), 'ip')).toBeGreaterThanOrEqual(2);
  });

  it('ai 画像 → ai_liability 命中(tier4 归属在 planLines)', () => {
    expect(score(lineRelevance(p({ industryValue: 'ai' })), 'ai_liability')).toBe(3);
  });
});

describe('lineRelevance — 缺省安全', () => {
  it('空 profile → 空 Map,不抛错', () => {
    expect(lineRelevance({}).size).toBe(0);
  });

  it('undefined profile → 空 Map', () => {
    expect(lineRelevance(undefined).size).toBe(0);
  });

  it('未知枚举值 → 落 0(不产生非法 key)', () => {
    const m = lineRelevance(p({ headcountValue: 'weird', fundingValue: 'nope' }));
    for (const key of m.keys()) expect(VALID_LINES.has(key)).toBe(true);
  });
});
