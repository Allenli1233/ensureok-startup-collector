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

/** 条款忠实度状态(PR4 judge 填;PR3 仅占位:entailed 忠实 / unverified 待核 / not-supported 无支撑 / contradicted 讲反) */
export type Faithfulness = 'entailed' | 'unverified' | 'not-supported' | 'contradicted';
/** 条款类型(用于 §5.2 结构化 heading 比对) */
export type ClauseType = '责任' | '除外' | '免赔' | '其他';

/** 结构化条款要点:文本 + 证据引用(真实 chunkId,已校验;挂空/不存在的已剔除) */
export interface KeyClause {
  text: string;
  /** 该条支撑证据的 chunkId(来自 retrieve 的真实 id;LLM 引的 E 标签/无效 id 已解析或剔除) */
  evidenceRefs: string[];
  /** 忠实度状态(PR4 judge 核对后填) */
  faithfulness?: Faithfulness;
  /** 条款类型(LLM 标注,供结构化比对) */
  clauseType?: ClauseType;
}

/** 对抗式生成的质检评分(软维度:忠实度 + 说服力,各 0–5) */
export interface QualityScore {
  fidelity: number;
  persuasion: number;
  /** 总分(fidelity + persuasion,满 10) */
  total: number;
  passed: boolean;
  feedback: { fidelity: string; persuasion: string };
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
  /** 条款要点扁平串(= keyClausesDetailed 的 text;保留兼容现前端) */
  keyClauses: string[];
  /** 条款要点结构化(带校验过的 evidenceRefs / clauseType;前端可下钻原文,PR4 可填 faithfulness) */
  keyClausesDetailed?: KeyClause[];
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

  // ── 对抗式生成产出(开启 loop 时填充;未开启则缺省) ──
  /** 质检评分(judge 打分) */
  qualityScore?: QualityScore;
  /** 重写次数 */
  revisions?: number;
  /** 本险种实际 LLM 调用数(generate + judge 累计;可观测,治静默降级) */
  callsUsed?: number;
  /** 封顶仍不达标 / 合规拦截 → 降级 */
  degraded?: boolean;
  degradedReason?: string;
  /** 终局合规闸门命中的红线规则(正常应为空) */
  complianceFlags?: string[];
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
    /** 对抗 loop 开启时的评分模型 */
    judgeModel?: string;
  };
  /** 画像回显(无 PII) */
  clientSummary: string;
  items: ProposalItem[];
  disclaimer: string;
}
