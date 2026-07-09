import { describe, expect, it } from 'vitest';
import { mockRequest } from './mockProvider';
import type { ProposalRequest } from './types';

const req: ProposalRequest = {
  company: '测试公司',
  profile: { industry: 'SaaS' },
  diagnosis: {
    total: 2,
    mandatoryCount: 1,
    findings: [
      { id: 'a', line: 'line_b', title: '出海保障缺口', desc: '', coverage: '出海保障包', urgency: 'mandatory' },
      { id: 'b', line: 'company', title: '知识产权保障未配置', desc: '', coverage: '知识产权保险', urgency: 'advice' },
    ],
  },
};

describe('mockRequest', () => {
  it('返回结构合法的 Proposal', async () => {
    const p = await mockRequest(req);
    expect(p.meta.documentName).toBe('保障方案建议');
    expect(p.meta.company).toBe('测试公司');
    expect(p.items).toHaveLength(2);
  });

  it('每个 item 含产品/价位/护栏', async () => {
    const p = await mockRequest(req);
    const it0 = p.items[0];
    expect(it0.recommendedProducts.length).toBeGreaterThan(0);
    expect(it0.pricing.display).toContain('参考价位区间');
    expect(it0.pricing.disclaimer).toContain('承保由合作持牌');
    expect(it0.tier).toBe('tier1'); // mandatory → tier1
  });

  it('信任层:首项带可信度分 + 结构化条款忠实度四态(含 contradicted 讲反)', async () => {
    const p = await mockRequest(req);
    const it0 = p.items[0];
    expect(typeof it0.qualityScore).toBe('number');
    expect(it0.keyClausesDetailed?.length).toBe(4);
    const states = it0.keyClausesDetailed?.map((c) => c.faithfulness);
    expect(states).toEqual(['entailed', 'unverified', 'not-supported', 'contradicted']);
    // 忠实条带真实 evidenceRefs;无支撑条为空
    expect(it0.keyClausesDetailed?.[0].evidenceRefs.length).toBeGreaterThan(0);
    expect(it0.keyClausesDetailed?.[2].evidenceRefs.length).toBe(0);
  });

  it('理由锚点:首项带 rationaleDrivers(缺口/画像/条款)', async () => {
    const p = await mockRequest(req);
    const drivers = p.items[0].rationaleDrivers;
    expect(drivers?.length).toBeGreaterThan(0);
    // 三类锚点各出现至少一次
    expect(drivers?.some((d) => d.gap)).toBe(true);
    expect(drivers?.some((d) => d.profile)).toBe(true);
    expect(drivers?.some((d) => d.clause)).toBe(true);
  });

  it('保司 matchReason:首项每家保司带匹配理由', async () => {
    const p = await mockRequest(req);
    const products = p.items[0].recommendedProducts;
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((r) => typeof r.matchReason === 'string' && r.matchReason.length > 0)).toBe(true);
  });

  it('渐进降级:次项(非增强项)不带新可选字段', async () => {
    const p = await mockRequest(req);
    // 第 2 项是降级项,不应有 rationaleDrivers / matchReason,UI 需按缺省渲染
    expect(p.items[1].rationaleDrivers).toBeUndefined();
    expect(p.items[1].recommendedProducts.every((r) => r.matchReason === undefined)).toBe(true);
  });

  it('信任层:次项为降级/待核', async () => {
    const p = await mockRequest(req);
    expect(p.items[1].degraded).toBe(true);
    expect(p.items[1].degradedReason).toBeTruthy();
  });

  it('概览:多条线时给出组合说明', async () => {
    const p = await mockRequest(req);
    expect(p.portfolio?.summary).toBeTruthy();
    expect(p.portfolio?.overlaps?.length).toBeGreaterThan(0);
  });
});
