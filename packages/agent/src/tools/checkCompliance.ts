import { ok, type ToolResult } from './types';

/**
 * check_compliance:确定性红线检测(设计 §8)。检测生成文本是否泄漏合规红线。
 * 生成 LLM 本就不该写任何金额(数字走确定性组装),故文本里出现保费/成交价/招揽 CTA 即视为泄漏。
 * 仅正则,不判语义(语义曲解由 judge 忠实度维负责)。作为终局闸门,遵循"宁可误伤降级、不可硬发红线"。
 *
 * 覆盖(对抗式复审加固):阿拉伯 + 全角数字、中文数字、外币($/美元/USD/…)、
 * 价格线索词(保费/费率/…)近旁的裸数字、招揽 CTA 的副词+动词结构、监管强制的参保/配置措辞。
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

// ── 复用零件 ──
const DIG = '0-9０-９'; // 阿拉伯 + 全角数字(裸区间,供拼进字符类,勿写成嵌套 [ ])
const D = `[${DIG}]`;
const NUM = `[${DIG}][${DIG},，.．]*`; // 数字串(容分隔符)
const SYM = '[¥￥$＄€£]'; // 货币符号
const CURWORD = '(?:美元|美金|港币|港元|欧元|日元|英镑|人民币|USD|EUR|HKD|GBP|RMB|CNY)';
const UNIT = '(?:万元|亿元|元|万|块|美元|美金|港币|港元|欧元|日元|英镑|USD|EUR|HKD|GBP|RMB|CNY)';
const CNLEAD = '[一二两三四五六七八九十]'; // 中文数字起首量词(规避"百万医疗/千万不要"误伤)
const CN = '[一二两三四五六七八九十百千万零]';
const CNAMT = `${CNLEAD}${CN}*`; // 中文数量(如 五万/十万/两百)
const CUE = '(?:保费|费率|保额|年缴|月缴|报价|成交价|最优价|仅需|只需|单价)'; // 价格线索词
const STOP = '[^。；;\\n]'; // 近旁窗口(不跨句)

const RULES: Array<{ rule: ComplianceViolation['rule']; re: RegExp }> = [
  // R1 保费/金额:生成文本本不该出现任何金额。覆盖符号/单位/中文数字/外币,以及价格线索词近旁的裸数字。
  {
    rule: 'R1_premium',
    re: new RegExp(
      [
        `${SYM}\\s*${D}`, // ¥5000 / ￥５０００ / $3000 / €200
        `${CURWORD}\\s*${D}`, // USD 3000 / 美元 3000
        `${NUM}\\s*${UNIT}`, // 5000元 / ５０００万 / 3000美元 / 3000USD / 1,200元
        `${CNAMT}\\s*(?:元|万元|块)`, // 五元 / 五万元 / 十万元
        `${CUE}${STOP}{0,6}(?:${SYM}\\s*)?(?:${NUM}|${CNAMT})`, // 年保费约 8000 / 保费约五万 / 人均保费约 300
      ].join('|'),
      'i',
    ),
  },
  // R2 招揽 CTA:副词/动作 + 投保动词结构(不再枚举固定短语)
  {
    rule: 'R2_cta',
    re: /(?:立即|立刻|马上|现在|赶紧|尽快|速速|从速|扫码|一键|点击|在线)[^。；;\n]{0,4}(?:投保|购买|下单|购险|参保|抢购)/,
  },
  // R3 监管强制暗示:含 参保/配置/购置/办理 等措辞
  {
    rule: 'R3_mandate',
    re: /(?:监管|法律|政策|国家|依法)(?:要求|规定|强制|需|应)[^。；;\n]{0,10}(?:投保|参保|购买保险|买保险|配置[^。\n]{0,6}保险|购置[^。\n]{0,6}保险|办理[^。\n]{0,6}保险)|必须(?:投保|参保|购买本?保险|买这个?保险|配置[^。\n]{0,6}保险)/,
  },
  // R4 具体保司 + 可成交报价(终值放宽:含全角数字与中文数字)
  {
    rule: 'R4_named_quote',
    re: new RegExp(
      `(?:中国人保|人保财险|平安|太保|太平洋|中国人寿|泰康|中华联合)[^。；;\\n]{0,14}(?:报价|成交价|最优价|仅需|只需|保费为)[^。；;\\n]{0,6}[¥￥$＄€£0-9０-９一二两三四五六七八九十]`,
    ),
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
