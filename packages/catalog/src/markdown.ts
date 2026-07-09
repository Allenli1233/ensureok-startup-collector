import { INSURER_NAMES } from './lines';

/** 表格分隔行,如 |---|:---:| */
const SEPARATOR_RE = /^\s*\|?\s*:?-{2,}/;

/**
 * 金额/价格单元格形态:货币符号,或『数字 + 元/万/万元』。
 * 刻意不匹配裸百分比(如市场渗透率 44%),避免把非金额表误判为价格表;
 * 费率表通常同时给出 ¥/万 金额示例,仍会被正确识别。
 */
export const PRICE_CELL_RE = /[¥$]|\d[\d,]*\s*(?:元|万元|万)/;

/** 是否为 Markdown 表格分隔行 */
export function isSeparatorLine(line: string): boolean {
  return SEPARATOR_RE.test(line) && line.includes('-');
}

/** 按 | 切分一行表格为单元格(去掉首尾竖线与两侧空白) */
export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * 识别文本中的保司名并去重。
 * 处理包含关系:若「中国人保」与「人保」都命中,只保留更长的「中国人保」。
 */
export function identifyInsurers(text: string): string[] {
  const present = INSURER_NAMES.filter((n) => text.includes(n));
  return present.filter((n) => !present.some((m) => m !== n && m.includes(n)));
}
