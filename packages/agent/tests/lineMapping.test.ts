import { describe, expect, it } from 'vitest';
import { MAX_LINES, mapCoverageToLines, planLines } from '../src/lineMapping';
import type { GapFinding, ProposalRequest } from '../src/types';

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

type Profile = ProposalRequest['profile'];
const prof = (over: Partial<Profile>): Profile => ({ ...over });

describe('planLines — 画像打分合并/去重/封顶', () => {
  it('不传 profile → 纯 findings 行为(老缺口线不回归)', () => {
    const planned = planLines([f('a', '网络安全保险(Cyber)', 'high')]);
    expect(planned.map((x) => x.lineId)).toEqual(['cyber']);
    expect(planned[0].urgency).toBe('high');
    expect(planned[0].source).toBe('finding');
    expect(planned[0].relevanceScore).toBeUndefined();
  });

  it('同一 lineId 既是 finding(high)又被打分命中 → 一条,不降级,source=both', () => {
    // cyber:finding high + fintech 画像打分命中
    const planned = planLines([f('a', '网络安全保险(Cyber)', 'high')], prof({ industryValue: 'fintech' }));
    const cyber = planned.filter((x) => x.lineId === 'cyber');
    expect(cyber.length).toBe(1);
    expect(cyber[0].urgency).toBe('high'); // 打分线默认 advice 不下拉
    expect(cyber[0].source).toBe('both');
    expect(cyber[0].relevanceScore).toBeGreaterThanOrEqual(2);
  });

  it('finding mandatory 的线,打分同命中 → 仍 mandatory(不降级)', () => {
    const planned = planLines([f('a', '产品责任保险', 'mandatory')], prof({ industryValue: 'hardware' }));
    const pl = planned.find((x) => x.lineId === 'product_liability');
    expect(pl?.urgency).toBe('mandatory');
    expect(pl?.tier).toBe('tier1');
    expect(pl?.source).toBe('both');
  });

  it('纯 hardware 画像 + 无关 findings → 打分独立补线(含 environmental/cargo)', () => {
    const planned = planLines([], prof({ industryValue: 'hardware' }));
    const ids = planned.map((x) => x.lineId);
    expect(ids).toContain('environmental');
    expect(ids).toContain('cargo');
    const env = planned.find((x) => x.lineId === 'environmental');
    expect(env?.urgency).toBe('advice');
    expect(env?.tier).toBe('tier3');
    expect(env?.source).toBe('relevance');
    expect(env?.gapTitles).toEqual([]);
    expect(env?.relevanceReasons?.length).toBeGreaterThan(0);
  });

  it('ai 画像 → ai_liability 恒 tier4', () => {
    const planned = planLines([], prof({ industryValue: 'ai' }));
    const ai = planned.find((x) => x.lineId === 'ai_liability');
    expect(ai?.tier).toBe('tier4');
  });

  it('封顶 ≤8:大量候选 → 长度受限,mandatory/high 全保留,advice 按分截断', () => {
    // 4 条强 findings(mandatory/high)+ 富画像触发一堆 advice 打分线
    const findings = [
      f('a', '雇主责任险', 'mandatory'),
      f('b', '团体福利保障', 'high'),
      f('c', '产品责任保险', 'mandatory'),
      f('d', '公众责任保险', 'high'),
    ];
    const planned = planLines(
      findings,
      prof({
        industryValue: 'hardware',
        headcountValue: 'gt100',
        fundingValue: 'ipo',
        hasPatent: true,
        overseas: true,
        hasPhysicalProduct: true,
        dataSensitive: true,
      }),
    );
    expect(planned.length).toBeLessThanOrEqual(MAX_LINES);
    // 强制/高线全在
    for (const id of ['employer_liability', 'group_accident', 'product_liability', 'public_liability']) {
      expect(planned.map((x) => x.lineId)).toContain(id);
    }
    // 没有降级:mandatory 仍在最前
    expect(planned[0].urgency).toBe('mandatory');
  });

  it('封顶时 findings 诊断的 advice 缺口不被纯画像推断线挤掉', () => {
    // D&O 仅由 finding(advice)触达(angel < pre_a,画像不打分命中 directors_officers);
    // 富 hardware 画像产出 >8 条 relevance advice(score 3–4),若无 source 优先则 D&O(地板分)被挤出。
    const planned = planLines(
      [f('dno', '关键人保障 + 董责险(认知铺垫)', 'advice')],
      prof({
        industryValue: 'hardware',
        headcountValue: 'gt100',
        fundingValue: 'angel',
        hasPatent: true,
        overseas: true,
        hasPhysicalProduct: true,
        dataSensitive: true,
      }),
    );
    expect(planned.length).toBe(MAX_LINES); // 候选足够多,恰好截到上限
    const dno = planned.find((x) => x.lineId === 'directors_officers');
    expect(dno).toBeDefined(); // 诊断缺口被保留
    expect(dno?.source).toBe('finding');
  });

  it('封顶时 advice 线按分数优先保留(高分不被低分挤掉)', () => {
    // 无 findings,富画像触发 >8 打分线;断言长度 8 且高分线(如 employer_liability gt100=6)在内
    const planned = planLines(
      [],
      prof({
        industryValue: 'hardware',
        headcountValue: 'gt100',
        fundingValue: 'ipo',
        hasPatent: true,
        overseas: true,
        hasPhysicalProduct: true,
        dataSensitive: true,
      }),
    );
    expect(planned.length).toBeLessThanOrEqual(MAX_LINES);
    expect(planned.map((x) => x.lineId)).toContain('employer_liability');
  });
});
