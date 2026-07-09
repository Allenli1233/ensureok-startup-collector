import { describe, expect, it } from 'vitest';
import { diagnoseGaps, type CollectorAnswers } from '../config/startupProfileCollector';
import { buildProposalRequest } from './buildRequest';

const answers: CollectorAnswers = {
  headcount: '31to100',
  industry: 'saas',
  funding: 'pre_a',
  patent: 'granted',
  a1: 'no',
  b0: 'yes',
  b1: 'yes',
  overseasCountries: ['us', 'sg'],
  c1: 'yes',
};

describe('buildProposalRequest', () => {
  const req = buildProposalRequest({ company: '示例科技 ', answers, diagnosis: diagnoseGaps(answers) });

  it('公司抬头 trim', () => {
    expect(req.company).toBe('示例科技');
  });

  it('画像映射为人话标签', () => {
    expect(req.profile.industry).toBe('SaaS / 软件');
    expect(req.profile.headcount).toBe('31–100 人');
    expect(req.profile.funding).toBe('Pre-A / A 轮');
    expect(req.profile.hasPatent).toBe(true);
    expect(req.profile.overseasCountries).toEqual(['美国', '新加坡']);
  });

  it('诊断缺口透传', () => {
    expect(req.diagnosis.findings.length).toBeGreaterThan(0);
    expect(req.diagnosis.findings[0]).toHaveProperty('coverage');
  });

  it('★ 绝不含任何 PII(姓名/手机/微信)', () => {
    const json = JSON.stringify(req);
    expect(json).not.toMatch(/phone|wechat|微信|手机|name"/i);
    expect(req.profile).not.toHaveProperty('phone');
    expect(req.profile).not.toHaveProperty('wechat');
  });

  it('未出海时不带出海国家', () => {
    const r2 = buildProposalRequest({ company: 'X', answers: { ...answers, b0: 'no' }, diagnosis: diagnoseGaps(answers) });
    expect(r2.profile.overseasCountries).toBeUndefined();
  });
});
