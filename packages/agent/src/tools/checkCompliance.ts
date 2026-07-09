import { ok, type ToolResult } from './types';

/**
 * check_compliance:确定性红线检测(设计 §8)。检测生成文本是否泄漏合规红线。
 * 生成 LLM 本就不该写任何金额(数字走确定性组装),故文本里出现保费/成交价/招揽 CTA 即视为泄漏。
 * 含阿拉伯数字与中文数字。仅正则,不判语义(语义曲解由 judge 忠实度维负责)。
 */
export interface ComplianceInput {
  text: string;
}
export interface ComplianceViolation {
  rule: 'R1_premium' | 'R2_cta' | 'R3_mandate' | 'R4_named_quote';
  match: string;
}
export interface ComplianceOutput {
  clean: boolean;
  violations: ComplianceViolation[];
}

const CN = '[一二两三四五六七八九十百千万零]';

const RULES: Array<{ rule: ComplianceViolation['rule']; re: RegExp }> = [
  // R1 保费/金额:货币符号+数字,或 数字/中文数字 + 元/万元/万(生成文本本不该出现任何金额)
  {
    rule: 'R1_premium',
    re: new RegExp(`[¥￥]\\s*\\d|\\d[\\d,.]*\\s*(?:元|万元|万)|${CN}+\\s*(?:元|万元)`),
  },
  // R2 招揽 CTA
  { rule: 'R2_cta', re: /立即投保|马上投保|立即购买|马上购买|立即下单|一键投保|点击(购买|投保)|赶紧投保/ },
  // R3 监管强制暗示
  {
    rule: 'R3_mandate',
    re: /(监管|法律|政策|国家)(要求|规定|强制)[^。;\n]{0,8}(投保|购买保险|买保险)|必须(投保|购买本?保险|买这个?保险)/,
  },
  // R4 具体保司 + 可成交报价
  {
    rule: 'R4_named_quote',
    re: /(中国人保|人保财险|平安|太保|太平洋|中国人寿|泰康|中华联合)[^。;\n]{0,14}(报价|成交价|最优价|仅需|只需|保费为)[^。;\n]{0,6}[¥￥\d]/,
  },
];

export function checkCompliance(input: ComplianceInput): ToolResult<ComplianceOutput> {
  const violations: ComplianceViolation[] = [];
  for (const { rule, re } of RULES) {
    const m = re.exec(input.text);
    if (m) violations.push({ rule, match: m[0] });
  }
  return ok({ clean: violations.length === 0, violations });
}
