import type { InsuranceLineId } from './types';

export interface LineDef {
  /** 目录前缀,如 "01" */
  folderPrefix: string;
  lineId: InsuranceLineId;
  lineName: string;
}

/** 保险产品数据库 01–12 目录 → 险种定义。16-推荐引擎规则库 等非险种目录不在此表内,解析时跳过。 */
export const INSURANCE_LINES: LineDef[] = [
  { folderPrefix: '01', lineId: 'employer_liability', lineName: '雇主责任险' },
  { folderPrefix: '02', lineId: 'product_liability', lineName: '产品责任险' },
  { folderPrefix: '03', lineId: 'public_liability', lineName: '公众责任险' },
  { folderPrefix: '04', lineId: 'group_accident', lineName: '团体意外险' },
  { folderPrefix: '05', lineId: 'directors_officers', lineName: '董责险D&O' },
  { folderPrefix: '06', lineId: 'cyber', lineName: '网络安全险' },
  { folderPrefix: '07', lineId: 'ip', lineName: '知识产权保险' },
  { folderPrefix: '08', lineId: 'tech_eo', lineName: 'Tech E&O' },
  { folderPrefix: '09', lineId: 'ai_liability', lineName: 'AI服务责任险' },
  { folderPrefix: '10', lineId: 'cargo', lineName: '货物运输险' },
  { folderPrefix: '11', lineId: 'credit_surety', lineName: '信用保证保险' },
  { folderPrefix: '12', lineId: 'environmental', lineName: '环境污染责任险' },
];

export const LINE_BY_PREFIX: Map<string, LineDef> = new Map(
  INSURANCE_LINES.map((l) => [l.folderPrefix, l]),
);

export const LINE_BY_ID: Map<InsuranceLineId, LineDef> = new Map(
  INSURANCE_LINES.map((l) => [l.lineId, l]),
);

/**
 * 已知保险公司名 —— 从产品数据里识别承保方。
 * 长名在前(如 "中国人保" 先于 "人保"),identifyInsurers 会用「已命中长名则跳过其子串」的策略去重。
 */
export const INSURER_NAMES: string[] = [
  '中国人保财险',
  '中国人保',
  '人保财险',
  '人保',
  '中国人寿',
  '中国平安',
  '平安',
  '太平洋',
  '太保',
  '泰康',
  '中华联合',
  '华农',
  '利宝',
  '大地',
  '阳光',
  '众安',
  '太平',
  '中银',
  '安盛',
  '苏黎世',
  '安联',
  '三井住友',
  '东京海上',
  'Chubb',
  '安达',
  'AIG',
  '美亚',
];
