import type { Proposal, ProposalRequest, ProposalTier } from './types';

const tierFor = (u: string): ProposalTier => (u === 'mandatory' ? 'tier1' : u === 'high' ? 'tier2' : 'tier3');

/** 假数据提供方(VITE_PROPOSAL_PROVIDER=mock):无后端也能演示流程,方案为示例内容。 */
export async function mockRequest(req: ProposalRequest): Promise<Proposal> {
  await new Promise((r) => setTimeout(r, 1200));
  const items = req.diagnosis.findings.slice(0, 4).map((f, i) => ({
    lineId: `mock_${i}`,
    lineName: f.title,
    urgency: f.urgency,
    tier: tierFor(f.urgency),
    gapTitles: [f.title],
    coverageDirection: `(示例)${f.coverage} 的主流承保方向与保障结构`,
    rationale: '(示例)结合企业画像与检索到的条款证据给出的推荐理由。',
    keyClauses: ['(示例)条款要点一', '(示例)条款要点二'],
    recommendedProducts: [
      { insurer: '中国人保', sourceFile: 'mock' },
      { insurer: '平安', sourceFile: 'mock' },
    ],
    pricing: {
      display: '参考价位区间约 1万元–500万元(示例,精确见下钻价格表)',
      disclaimer: '参考区间 · 以保司实际报价为准 · 非成交报价,承保由合作持牌经纪机构完成',
      unavailable: false,
    },
    drilldownSourceFile: '保险产品数据库/示例产品数据.md',
    citations: [{ sourceFile: '保险资料/示例条款.md', headingPath: ['一、保险责任'], insuranceLine: f.title, docCategory: '法律法规' }],
    evidenceInsufficient: false,
  }));

  return {
    meta: {
      documentName: '保障方案建议',
      company: req.company,
      generatedAt: new Date().toISOString(),
      engine: 'mock',
      llmModel: 'mock',
      ragModel: 'mock',
    },
    clientSummary: `${req.profile.industry ?? '企业'} · 诊断缺口 ${req.diagnosis.total} 项(示例数据)`,
    items,
    disclaimer: '(示例)本文为方向性风险建议,不构成投保建议,不涉及成交报价;承保由合作持牌保险经纪机构完成。',
  };
}
