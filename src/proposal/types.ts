/**
 * 前端侧方案类型 —— 与后端 @ensureok/agent 的 Proposal 契约对齐(本地声明,前端不依赖后端包)。
 * PR4b 只消费这些字段做展示/打印;字段来源见后端 pipeline。
 */
export type ProposalTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';
export type GapUrgency = 'mandatory' | 'high' | 'advice';

export interface RecommendedProduct {
  insurer: string;
  sourceFile: string;
}

export interface PricingHint {
  display: string;
  disclaimer: string;
  unavailable: boolean;
  collectedAt?: string;
}

export interface Citation {
  sourceFile: string;
  headingPath: string[];
  insuranceLine: string | null;
  docCategory: string;
}

export interface ProposalItem {
  lineId: string;
  lineName: string;
  urgency: GapUrgency;
  tier: ProposalTier;
  gapTitles: string[];
  coverageDirection: string;
  rationale: string;
  keyClauses: string[];
  recommendedProducts: RecommendedProduct[];
  pricing: PricingHint;
  drilldownSourceFile: string | null;
  citations: Citation[];
  evidenceInsufficient: boolean;
}

export interface Proposal {
  meta: {
    documentName: '保障方案建议' | '风险保障方向说明';
    company: string;
    generatedAt: string;
    engine: string;
    llmModel: string;
    ragModel: string;
  };
  clientSummary: string;
  items: ProposalItem[];
  disclaimer: string;
}

/** Agent 输入契约(不含 PII) */
export interface ProposalRequest {
  company: string;
  profile: {
    industry?: string;
    headcount?: string;
    funding?: string;
    hasPatent?: boolean;
    overseasCountries?: string[];
  };
  diagnosis: {
    total: number;
    mandatoryCount: number;
    findings: Array<{
      id: string;
      line: string;
      title: string;
      desc: string;
      coverage: string;
      urgency: GapUrgency;
    }>;
  };
}
