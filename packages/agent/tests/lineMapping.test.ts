import { describe, expect, it } from 'vitest';
import { mapCoverageToLines, planLines } from '../src/lineMapping';
import type { GapFinding } from '../src/types';

describe('mapCoverageToLines', () => {
  it('雇主 + 团体', () => {
    expect(mapCoverageToLines('雇主责任险 + 团体福利保障')).toEqual(
      expect.arrayContaining(['employer_liability', 'group_accident']),
    );
  });

  it('出海保障包 拆成 tech_eo/cyber/product', () => {
    const lines = mapCoverageToLines('出海保障包:职业责任(E&O)+ 网络安全 + 产品责任 + COI 出具服务');
    expect(lines).toEqual(expect.arrayContaining(['tech_eo', 'cyber', 'product_liability']));
    expect(new Set(lines).size).toBe(lines.length); // 去重
  });

  it('董责 → directors_officers', () => {
    expect(mapCoverageToLines('关键人保障 + 董责险(认知铺垫)')).toEqual(['directors_officers']);
  });

  it('网络安全(Cyber) → cyber', () => {
    expect(mapCoverageToLines('网络安全保险(Cyber)+ 等保/个保合规规划')).toEqual(['cyber']);
  });

  it('无匹配返回空', () => {
    expect(mapCoverageToLines('某种未知保障')).toEqual([]);
  });
});

const f = (id: string, coverage: string, urgency: GapFinding['urgency']): GapFinding => ({
  id,
  line: 'company',
  title: `缺口-${id}`,
  desc: '',
  coverage,
  urgency,
});

describe('planLines', () => {
  it('去重并取最紧迫 urgency', () => {
    const planned = planLines([
      f('a', '网络安全保险(Cyber)', 'high'),
      f('b', '出海保障包:网络安全', 'mandatory'),
    ]);
    const cyber = planned.find((p) => p.lineId === 'cyber');
    expect(cyber?.urgency).toBe('mandatory'); // high 与 mandatory 取 mandatory
    expect(cyber?.tier).toBe('tier1');
    expect(cyber?.gapTitles.length).toBe(2);
  });

  it('ai_liability 恒 tier4', () => {
    const planned = planLines([f('x', 'AI 服务责任(方案共创中)', 'advice')]);
    expect(planned[0].lineId).toBe('ai_liability');
    expect(planned[0].tier).toBe('tier4');
  });

  it('强制型排在前', () => {
    const planned = planLines([f('a', '知识产权保险', 'advice'), f('b', '产品责任保险', 'mandatory')]);
    expect(planned[0].urgency).toBe('mandatory');
  });
});
