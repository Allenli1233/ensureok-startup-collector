import type { InsuranceLineId } from '@ensureok/catalog';
import type { ProposalRequest } from './types';

/**
 * 画像 → 险种确定性打分(方案 B 候选池)。
 * 纯函数,无副作用、无 LLM、无网络、**不读任何价格字段**。
 * 只读 profile 的结构化布尔/枚举信号(§6),label 文本不参与(本地化串不稳定)。
 * 输出只含 score>0 的险种;调用方按 THRESH 阈值过滤。
 */
export interface LineRelevance {
  score: number;
  reasons: string[];
}

type Profile = ProposalRequest['profile'];
type Industry = NonNullable<Profile['industryValue']>;

/** score ≥ THRESH 的险种进候选池 */
export const RELEVANCE_THRESHOLD = 2;

/** headcountValue → 序数(人数越多越高);未知/缺省 → 0 */
function hc(v: string | undefined): number {
  switch (v) {
    case 'lt10':
      return 1;
    case '10to30':
      return 2;
    case '31to100':
      return 3;
    case 'gt100':
      return 4;
    default:
      return 0;
  }
}

/** fundingValue → 序数;未知/缺省 → 0 */
function fund(v: string | undefined): number {
  switch (v) {
    case 'none':
      return 0;
    case 'angel':
      return 1;
    case 'pre_a':
      return 2;
    case 'b_plus':
      return 3;
    case 'ipo':
      return 4;
    default:
      return 0;
  }
}

const HEADCOUNT_LABEL: Record<string, string> = {
  lt10: '1–9 人',
  '10to30': '10–30 人',
  '31to100': '31–100 人',
  gt100: '100 人以上',
};

const cap4 = (n: number): number => Math.min(n, 4);
const has = (ind: Industry | undefined, set: readonly Industry[]): boolean => ind !== undefined && set.includes(ind);

/**
 * 12 险种确定性打分。返回 Map<lineId, {score, reasons}>,只含 score>0 的项。
 * 打分表见 spec §4.3(基线分 + 触发加权),reason 为可解释中文短句(不含价格)。
 */
export function lineRelevance(profile: Profile | undefined): Map<InsuranceLineId, LineRelevance> {
  const out = new Map<InsuranceLineId, LineRelevance>();
  if (!profile) return out;

  const ind = profile.industryValue;
  const headScore = hc(profile.headcountValue);
  const fundScore = fund(profile.fundingValue);
  const overseas = Boolean(profile.overseas);
  const physical = Boolean(profile.hasPhysicalProduct);
  const dataSensitive = Boolean(profile.dataSensitive);
  const hasPatent = Boolean(profile.hasPatent);
  const overseasPhysical = overseas && physical;

  const add = (lineId: InsuranceLineId, score: number, reason: string): void => {
    if (score <= 0) return;
    const cur = out.get(lineId);
    if (cur) {
      cur.score += score;
      cur.reasons.push(reason);
    } else {
      out.set(lineId, { score, reasons: [reason] });
    }
  };
  /** 单条命中(带 cap):直接写入(不累加),reasons 为该条明细 */
  const set = (lineId: InsuranceLineId, score: number, reasons: string[]): void => {
    if (score <= 0) return;
    out.set(lineId, { score, reasons });
  };

  // employer_liability:有员工恒基线(人数越多越高)。headScore>0 即视为有雇员。
  if (headScore > 0) {
    const label = HEADCOUNT_LABEL[profile.headcountValue ?? ''] ?? '';
    add('employer_liability', 2 + headScore, label ? `有雇员(雇主责任基线)· 人数 ${label}` : '有雇员(雇主责任基线)');
  }

  // group_accident:团队 ≥10 人(headScore ≥ 2)
  if (headScore >= 2) add('group_accident', headScore, '团队 ≥10 人,团体意外保障');

  // tech_eo:saas / ai / fintech
  if (has(ind, ['saas', 'ai', 'fintech'])) add('tech_eo', 3, '技术/软件服务责任(Tech E&O)');

  // cyber:dataSensitive 或 ind ∈ {saas, ai, fintech, health, ecom},cap 4
  {
    const indHit = has(ind, ['saas', 'ai', 'fintech', 'health', 'ecom']);
    const reasons: string[] = [];
    let s = 0;
    if (indHit) {
      s += 2;
      reasons.push('数字化业务网络责任');
    }
    if (dataSensitive) {
      s += 2;
      reasons.push('处理敏感数据');
    }
    set('cyber', cap4(s), reasons);
  }

  // product_liability:ind ∈ {hardware, ecom} 或 (overseas && hasPhysicalProduct),cap 4
  {
    const reasons: string[] = [];
    let s = 0;
    if (has(ind, ['hardware', 'ecom'])) {
      s += 3;
      reasons.push('实体产品责任');
    }
    if (overseasPhysical) {
      s += 2;
      reasons.push('出口产品责任');
    }
    set('product_liability', cap4(s), reasons);
  }

  // public_liability:ind ∈ {ecom, hardware}
  if (has(ind, ['ecom', 'hardware'])) add('public_liability', 3, '经营场所/第三者责任');

  // directors_officers:funding ≥ pre_a(fundScore ≥ 2),ipo 最高
  if (fundScore >= 2) add('directors_officers', fundScore, '融资阶段董监高责任(D&O)');

  // ip:hasPatent 或 ind ∈ {ai, hardware},cap 4
  {
    const reasons: string[] = [];
    let s = 0;
    if (hasPatent) {
      s += 3;
      reasons.push('有专利');
    }
    if (has(ind, ['ai', 'hardware'])) {
      s += 2;
      reasons.push('技术密集知识产权敞口');
    }
    set('ip', cap4(s), reasons);
  }

  // ai_liability:ind = ai(tier4)
  if (ind === 'ai') add('ai_liability', 3, 'AI 输出责任(品类共创)');

  // cargo:(overseas && hasPhysicalProduct) 或 ind ∈ {hardware, ecom},cap 4
  {
    const reasons: string[] = [];
    let s = 0;
    if (overseasPhysical) {
      s += 3;
      reasons.push('跨境货物运输');
    }
    if (has(ind, ['hardware', 'ecom'])) {
      s += 2;
      reasons.push('硬件/电商物流');
    }
    set('cargo', cap4(s), reasons);
  }

  // environmental:ind = hardware
  if (ind === 'hardware') add('environmental', 3, '硬件制造环境责任');

  // credit_surety:overseas 或 ind ∈ {ecom, hardware},cap 4
  {
    const reasons: string[] = [];
    let s = 0;
    if (overseas) {
      s += 2;
      reasons.push('出海应收/信用');
    }
    if (has(ind, ['ecom', 'hardware'])) {
      s += 2;
      reasons.push('贸易信用保证');
    }
    set('credit_surety', cap4(s), reasons);
  }

  return out;
}
