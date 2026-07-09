import type { InsuranceLineId } from '@ensureok/catalog';

export type GapUrgency = 'mandatory' | 'high' | 'advice';

/** 前端诊断输出的缺口(与采集器 GapFinding 对齐的子集;PR4 接前端时统一到 shared) */
export interface GapFinding {
  id: string;
  line: 'line_a' | 'line_b' | 'line_c' | 'company';
  title: string;
  desc: string;
  coverage: string;
  urgency: GapUrgency;
}

export interface CollectorDiagnosis {
  findings: GapFinding[];
  total: number;
  mandatoryCount: number;
}

/** Agent 输入(不含 PII:无姓名/电话/微信) */
export interface ProposalRequest {
  /** 抬头展示用;不进 LLM 事实推断 */
  company: string;
  profile: {
    industry?: string;
    headcount?: string;
    funding?: string;
    hasPatent?: boolean;
    overseasCountries?: string[];
  };
  diagnosis: CollectorDiagnosis;
}

export type ProposalTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export interface RecommendedProduct {
  insurer: string;
  source: 'product_db';
  sourceFile: string;
}

export interface PricingHint {
  /** 参考价位展示串(来自产品库价格表;非成交报价) */
  display: string;
  minCny?: number;
  maxCny?: number;
  source: 'product_db';
  collectedAt?: string;
  /** 强制护栏文案 */
  disclaimer: string;
  /** 无价目表(如 AI 险)时为 true,display 为引导语 */
  unavailable: boolean;
}

export interface Citation {
  sourceFile: string;
  headingPath: string[];
  insuranceLine: string | null;
  docCategory: string;
}

export interface ProposalItem {
  lineId: InsuranceLineId;
  lineName: string;
  urgency: GapUrgency;
  tier: ProposalTier;
  /** 触发本险种的缺口标题 */
  gapTitles: string[];
  /** 承保方向/该险种要点(LLM 基于证据生成) */
  coverageDirection: string;
  /** 推荐理由(LLM 基于画像+证据) */
  rationale: string;
  /** 条款要点(LLM 摘自 RAG 证据) */
  keyClauses: string[];
  /** 推荐保司(结构化来自产品库,非 LLM 编) */
  recommendedProducts: RecommendedProduct[];
  /** 参考价位(数字来自产品库价格表) */
  pricing: PricingHint;
  /** 下钻:该险种完整产品/价格来源指针(前端据此展开价格表) */
  drilldownSourceFile: string | null;
  /** RAG 证据引用 */
  citations: Citation[];
  /** 证据不足 → 内容降级为"建议顾问补充评估" */
  evidenceInsufficient: boolean;
}

export interface Proposal {
  meta: {
    documentName: '保障方案建议' | '风险保障方向说明';
    company: string;
    /** 由调用方注入(脚本 stamp),库内不取系统时间 */
    generatedAt: string;
    engine: string;
    llmModel: string;
    ragModel: string;
  };
  /** 画像回显(无 PII) */
  clientSummary: string;
  items: ProposalItem[];
  disclaimer: string;
}
