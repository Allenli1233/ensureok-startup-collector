import type { Proposal, ProposalItem, ProposalRequest, ProposalTier } from './types';

const tierFor = (u: string): ProposalTier => (u === 'mandatory' ? 'tier1' : u === 'high' ? 'tier2' : 'tier3');

/** 假数据提供方(VITE_PROPOSAL_PROVIDER=mock):无后端也能演示流程,方案为示例内容。 */
export async function mockRequest(req: ProposalRequest): Promise<Proposal> {
  await new Promise((r) => setTimeout(r, 1200));
  const items: ProposalItem[] = req.diagnosis.findings.slice(0, 4).map((f, i) => {
    const base: ProposalItem = {
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
      citations: [
        { sourceFile: '保险资料/示例条款.md', headingPath: ['一、保险责任'], insuranceLine: f.title, docCategory: '法律法规' },
      ],
      evidenceInsufficient: false,
    };

    // 第 1 项:演示信任层——结构化条款(忠实/待核/无支撑三态)+ 证据下钻 + 可信度分
    if (i === 0) {
      return {
        ...base,
        qualityScore: 92,
        keyClausesDetailed: [
          {
            text: '(示例)赔偿限额:每人每次事故限额与累计限额',
            evidenceRefs: ['chunk_emp_001', 'chunk_emp_002'],
            faithfulness: 'entailed',
            clauseType: '责任',
          },
          {
            text: '(示例)高风险工种是否纳入承保,需与保司核对',
            evidenceRefs: ['chunk_emp_010'],
            faithfulness: 'unverified',
            clauseType: '除外',
          },
          {
            text: '(示例)免赔额 / 自负比例',
            evidenceRefs: [],
            faithfulness: 'not-supported',
            clauseType: '免赔',
          },
        ],
        revisions: 1,
        callsUsed: 4,
      };
    }

    // 第 2 项:演示降级/待核(证据不足,内容降级为方向性建议)
    if (i === 1) {
      return {
        ...base,
        qualityScore: 63,
        degraded: true,
        degradedReason: '(示例)检索证据不足,已降级为方向性建议,待持牌顾问补充核对。',
        keyClauses: [],
        revisions: 3,
        callsUsed: 7,
      };
    }

    return base;
  });

  const proposal: Proposal = {
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

  // 有多条线时演示概览级组合说明
  if (req.diagnosis.findings.length > 1) {
    proposal.portfolio = {
      summary: '(示例)三条风险线可打包投保;雇主责任与团体意外在身故/伤残责任上有部分重叠,建议分层配置。',
      overlaps: [
        { lines: ['雇主责任险', '团体意外险'], note: '(示例)身故/伤残责任部分重叠,避免重复投保。' },
      ],
      layering: '(示例)基础层团意 + 责任层雇主责任 + 专项层数据合规。',
      bundles: [{ name: '初创基础包', lines: ['雇主责任险', '团体意外险'] }],
    };
  }

  return proposal;
}
