/**
 * 前端侧方案类型 —— 与后端 @ensureok/agent 的 Proposal 契约对齐(本地声明,前端不依赖后端包)。
 * PR4b 只消费这些字段做展示/打印;字段来源见后端 pipeline。
 */
export type ProposalTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';
export type GapUrgency = 'mandatory' | 'high' | 'advice';

export interface RecommendedProduct {
  insurer: string;
  sourceFile: string;
  /** 该保司为何匹配(可选;后端可产出)——短句/悬浮说明,缺省则只显示保司名 */
  matchReason?: string;
}

/** 理由锚点:把"推荐理由"落到具体的缺口 / 画像 / 条款上(可选,三项至少有一项) */
export interface RationaleDriver {
  /** 触发缺口,如"雇主责任险未覆盖" */
  gap?: string;
  /** 命中画像,如"有专利" */
  profile?: string;
  /** 关联条款,如"承保工伤赔偿" */
  clause?: string;
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

// ── 对抗式生成「信任层」字段(PR7/PR8 消费;均为后端可选产出,老响应没有) ──

/** 条款忠实度三态:entailed 忠实 / unverified 待核 / not-supported 无支撑 / contradicted 讲反 */
export type Faithfulness = 'entailed' | 'unverified' | 'not-supported' | 'contradicted';
/** 条款类型 */
export type ClauseType = '责任' | '除外' | '免赔' | '其他';

/** 结构化条款要点(带证据引用 + 忠实度);扁平 keyClauses 仍保留做兼容 */
export interface KeyClauseDetailed {
  text: string;
  /** 支撑证据的 chunkId(真实、已校验) */
  evidenceRefs: string[];
  faithfulness?: Faithfulness;
  clauseType?: ClauseType;
}

/** 评分五维 */
export type ScoreDimension = 'compliance' | 'accuracy' | 'pricing' | 'fidelity' | 'persuasion';
export type ScoreVerdict = 'pass' | 'fail';

export interface DimensionScore {
  /** 0–5 */
  score: number;
  verdict?: ScoreVerdict;
  notes: string[];
}

export interface RevisionInstruction {
  target: string;
  action: string;
  reason: string;
}

/** 一次评分卡(可观测/顾问版) */
export interface ScoreCard {
  dimensions: Record<ScoreDimension, DimensionScore>;
  /** 0–100 */
  weightedScore: number;
  verdict: ScoreVerdict;
  gateFailed: string[];
  revisionInstructions: RevisionInstruction[];
}

/** 概览级组合说明(可能尚未产出;有才渲染) */
export interface Portfolio {
  summary?: string;
  overlaps?: { lines: string[]; note: string }[];
  layering?: string;
  bundles?: { name: string; lines: string[] }[];
}

export interface ProposalItem {
  lineId: string;
  lineName: string;
  urgency: GapUrgency;
  tier: ProposalTier;
  gapTitles: string[];
  coverageDirection: string;
  rationale: string;
  /** 理由锚点 chips(可选;后端可产出)——把 rationale 落到具体缺口/画像/条款 */
  rationaleDrivers?: RationaleDriver[];
  keyClauses: string[];
  recommendedProducts: RecommendedProduct[];
  pricing: PricingHint;
  drilldownSourceFile: string | null;
  citations: Citation[];
  evidenceInsufficient: boolean;

  // ── 信任层(对抗式生成开启时才有;全部可选) ──
  /** 结构化条款要点(带 evidenceRefs / faithfulness / clauseType) */
  keyClausesDetailed?: KeyClauseDetailed[];
  /** 采纳版加权总分 0–100(信任信号,非排名) */
  qualityScore?: number;
  /** 逐轮评分卡(顾问版/可观测) */
  scoreCards?: ScoreCard[];
  /** 降级/待核(封顶不达标或合规拦截) */
  degraded?: boolean;
  degradedReason?: string;
  /** 命中的合规红线(内容已隐去) */
  complianceFlags?: string[];
  /** 重写次数(顾问版) */
  revisions?: number;
  /** 本险种 LLM 调用数(顾问版) */
  callsUsed?: number;
}

export interface Proposal {
  meta: {
    documentName: '保障方案建议' | '风险保障方向说明';
    company: string;
    generatedAt: string;
    engine: string;
    llmModel: string;
    ragModel: string;
    /** 对抗 loop 开启时的评分模型 */
    judgeModel?: string;
  };
  clientSummary: string;
  items: ProposalItem[];
  disclaimer: string;
  /** 概览级组合说明(可选) */
  portfolio?: Portfolio;
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
    // ── 稳定结构化信号(确定性打分用;镜像后端契约,无价格、不进 LLM)──
    industryValue?: 'saas' | 'ai' | 'hardware' | 'fintech' | 'health' | 'ecom' | 'other';
    headcountValue?: string;
    fundingValue?: string;
    hasPhysicalProduct?: boolean;
    overseas?: boolean;
    dataSensitive?: boolean;
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
