import { ok, type ToolResult } from './types';

/**
 * check_compliance:确定性红线检测(设计 §8)。终局闸门,遵循"宁可误伤降级、不可硬发红线"。
 *
 * 关键边界(对抗式复审修正):红线是**保费/价格数字**,不是一切数字。
 * 条款要点(责任/免赔/除外)天然带**保额/赔偿限额/免赔额/人数/注册资本**等金额——这些是合规内容,不得误伤。
 * 故 R1 只在**价格语境**下命中数字:货币符号/外币,或**保费类线索词近旁**的数字;裸"数字+万/元"不再一律拦。
 *
 * 两级:violations=硬拦(clean=false);suspected=可疑触发(转人工复核,不自动拦,clean 不受影响)。
 */
export interface ComplianceInput {
  text: string;
}
export interface ComplianceViolation {
  rule: 'R1_premium' | 'R2_cta' | 'R3_mandate' | 'R4_named_quote' | 'R5_absolute';
  match: string;
}
export interface ComplianceOutput {
  clean: boolean;
  violations: ComplianceViolation[];
  /** 可疑触发词:非硬违规,列此供人工/judge 复核,不影响 clean(设计 §4.2.4 两级) */
  suspected: Array<{ rule: string; match: string }>;
}

// ── 复用零件 ──
const DIG = '0-9０-９';
const D = `[${DIG}]`;
const NUM = `[${DIG}][${DIG},，.．]*`;
const SYM = '[¥￥$＄€£]';
const FOREIGN = '(?:美元|美金|港币|港元|欧元|日元|英镑|USD|EUR|HKD|GBP)';
const CNLEAD = '[一二两三四五六七八九十]';
const CN = '[一二两三四五六七八九十百千万零]';
const CNAMT = `${CNLEAD}${CN}*`;
// 金额 token(数字或中文数字,可带国内单位)
const AMT = `(?:${NUM}(?:\\s*(?:万元|亿元|元|万|块))?|${CNAMT}(?:\\s*(?:元|万元|块))?)`;
// 保费类线索词(不含"保额/限额/赔偿/免赔"——那些是承保内容,非价格)
const PREMIUM_CUE = '(?:保费|费率|年缴|月缴|年费|月费|保费预算|投保预算|人均|每人|每年|每月|全年|一年|单价|报价|成交价|最优价|仅需|只需)';
// "金额后接的每单位"线索(五万元一年 / 300/人 / 5000元每年)
const PER_UNIT = '(?:一年|每年|全年|每月|每人|每位|/\\s*年|/\\s*人|/\\s*月)';
const STOP = '[^。；;\\n]';

const RULES: Array<{ rule: ComplianceViolation['rule']; re: RegExp }> = [
  // R1 保费/价格:仅在价格语境命中(货币符号/外币,或保费线索词近旁的数字)——不误伤保额/限额/免赔/人数
  {
    rule: 'R1_premium',
    re: new RegExp(
      [
        `${SYM}\\s*${D}`, // ¥5000 / $3000 / €200
        `${FOREIGN}\\s*${D}`, // USD 3000 / 美元 3000
        `${NUM}\\s*(?:${FOREIGN})`, // 3000美元 / 3000USD
        `${CNAMT}\\s*(?:${FOREIGN})`, // 五千美元
        `${PREMIUM_CUE}${STOP}{0,12}(?:${SYM}\\s*)?${AMT}`, // 年保费约 8000 / 保费约五万 / 全年…8000
        `${AMT}\\s*${PER_UNIT}`, // 五万元一年 / 300/人 / 5000元每年
      ].join('|'),
      'i',
    ),
  },
  // R2 招揽 CTA:副词/动作 + 投保动词结构
  {
    rule: 'R2_cta',
    re: /(?:立即|立刻|马上|现在|赶紧|尽快|速速|从速|扫码|一键|点击|在线)[^。；;\n]{0,4}(?:投保|购买|下单|购险|参保|抢购)/,
  },
  // R3 监管强制暗示
  {
    rule: 'R3_mandate',
    re: /(?:监管|法律|政策|国家|依法)(?:要求|规定|强制|需|应)[^。；;\n]{0,10}(?:投保|参保|购买保险|买保险|配置[^。\n]{0,6}保险|购置[^。\n]{0,6}保险|办理[^。\n]{0,6}保险)|必须(?:投保|参保|购买本?保险|买这个?保险|配置[^。\n]{0,6}保险)/,
  },
  // R4 具体保司 + 可成交报价(终值含全角/中文数字)
  {
    rule: 'R4_named_quote',
    re: new RegExp(
      `(?:中国人保|人保财险|平安|太保|太平洋|中国人寿|泰康|中华联合)[^。；;\\n]{0,14}(?:报价|成交价|最优价|仅需|只需|保费为)[^。；;\\n]{0,6}[¥￥$＄€£0-9０-９一二两三四五六七八九十]`,
    ),
  },
  // R5 绝对化承诺(保证赔/必赔/100%/稳赔)——硬拦
  {
    rule: 'R5_absolute',
    re: /(?:保证|承诺|一定|必定|百分之?百|100\s*%|全额)\s*(?:赔|获赔|理赔|赔付|给付)|稳赔|必赔|包赔|保证理赔|闭眼(?:买|入)/,
  },
];

// 可疑触发(转人工,不硬拦)
const SUSPECTED: Array<{ rule: string; re: RegExp }> = [
  { rule: 'S_cta', re: /赶紧|别犹豫|错过|超值|划算|限时|名额有限|优惠力度/ },
  { rule: 'S_absolute', re: /放心|无忧|全包|稳赚|绝对靠谱|零风险/ },
];

export function checkCompliance(input: ComplianceInput): ToolResult<ComplianceOutput> {
  const violations: ComplianceViolation[] = [];
  for (const { rule, re } of RULES) {
    const m = re.exec(input.text);
    if (m) violations.push({ rule, match: m[0] });
  }
  const suspected: Array<{ rule: string; match: string }> = [];
  for (const { rule, re } of SUSPECTED) {
    const m = re.exec(input.text);
    if (m) suspected.push({ rule, match: m[0] });
  }
  return ok({ clean: violations.length === 0, violations, suspected });
}
