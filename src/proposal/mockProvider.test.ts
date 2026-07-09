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
});
