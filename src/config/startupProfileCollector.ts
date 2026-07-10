/**
 * 创业公司保障画像采集器(国内版)—— 配置层
 *
 * 围绕中国初创三条跑不掉的风险线:劳动仲裁 · 出海合同 · 监管合规。
 * 终点是「保障缺口诊断 + 顾问预约」,不是自动核保报价(无承保牌照,合规红线)。
 * 联系人 4 字段 + 13 题(条件展开,最少 9 题)· 约 3 分钟 · PMF 验证导向。
 * 参照 Corgi 表单结构重构为中国三需求线。
 *
 * 设计要点(与 startupGapMap.ts 同纪律):
 *   - 纯数据 + 纯函数(diagnoseGaps),改文案不改逻辑,可不发版热改;
 *   - 诊断是 Deterministic 规则匹配,非 LLM 判断;
 *   - 合规红线(P0):全程不出现保费金额、不出现「具体产品+保司」的可成交报价、
 *     无「立即投保/购买」CTA。定位为风险诊断工具,出单由合作持牌机构完成。
 *   - 险种准确性与话术合规性以持牌顾问终审为准。
 */

// ═══════════════════════════════════════════════════════════════
// 问题与选项定义(第二段·公司基本盘 + 第三段·三条需求线)
// ═══════════════════════════════════════════════════════════════

export type QuestionId =
  | 'headcount' | 'industry' | 'funding' | 'patent'          // 第二段
  | 'a1' | 'a2'                                              // 线 A · 劳动用工
  | 'b0' | 'b1' | 'b2' | 'b3'                                // 线 B · 出海合同
  | 'c1' | 'c2' | 'c3';                                      // 线 C · 数据与合规

/** 答案集合:questionId → 选项 value;industryOther 为「其他」行业的补充文本 */
export type CollectorAnswers = Partial<Record<QuestionId, string>> & {
  industryOther?: string;
  /** 有融资时的融资额(自由文本,纯采集给顾问,不进确定性诊断) */
  fundingAmount?: string;
  /** 出海目标国家/地区多选:勾选项的 value + 自定义文字条目 */
  overseasCountries?: string[];
};

export type QuestionOption = { value: string; label: string };

export type QuestionDef = {
  id: QuestionId;
  /** 展示分组:company=公司基本盘,lineA/B/C=三条需求线 */
  section: 'company' | 'lineA' | 'lineB' | 'lineC';
  label: string;
  sub?: string;
  options: QuestionOption[];
  /** 条件展开:未定义 = 恒显示。B1–B3 需 B0=是;C3 仅 AI 行业展开 */
  visible?: (a: CollectorAnswers) => boolean;
  /** industry=other 时展示补充文本框 */
  allowOtherText?: boolean;
  /** 'countries' = 用国家多选控件渲染(答案存 overseasCountries,不占 answers[id]) */
  widget?: 'countries';
  /** 选了 ≠ showWhenNot 的值时,在该题下追加金额自由文本输入(存 fundingAmount) */
  amountInput?: { showWhenNot: string; placeholder: string };
  /** true = 不纳入必答校验(如国家多选属深挖细节,可留空) */
  optional?: boolean;
};

/** 出海目标国家/地区(勾选项)。value 稳定标识,region 供诊断生成市场提示;自定义国家走文字输入。 */
export const OVERSEAS_COUNTRIES: Array<{ value: string; label: string; region: string }> = [
  { value: 'us', label: '美国', region: 'na' },
  { value: 'ca', label: '加拿大', region: 'na' },
  { value: 'uk', label: '英国', region: 'eu' },
  { value: 'de', label: '德国', region: 'eu' },
  { value: 'fr', label: '法国', region: 'eu' },
  { value: 'nl', label: '荷兰', region: 'eu' },
  { value: 'jp', label: '日本', region: 'apac' },
  { value: 'kr', label: '韩国', region: 'apac' },
  { value: 'au', label: '澳大利亚', region: 'apac' },
  { value: 'sg', label: '新加坡', region: 'sea' },
  { value: 'my', label: '马来西亚', region: 'sea' },
  { value: 'id', label: '印尼', region: 'sea' },
  { value: 'th', label: '泰国', region: 'sea' },
  { value: 'ae', label: '阿联酋', region: 'mena' },
  { value: 'sa', label: '沙特', region: 'mena' },
];

export const COLLECTOR_QUESTIONS: QuestionDef[] = [
  // ── 第二段 · 公司基本盘 ──
  {
    id: 'headcount',
    section: 'company',
    label: '员工人数',
    sub: '劳动仲裁线核心',
    options: [
      { value: 'lt10', label: '1–9 人' },
      { value: '10to30', label: '10–30 人' },
      { value: '31to100', label: '31–100 人' },
      { value: 'gt100', label: '100 人以上' },
    ],
  },
  {
    id: 'industry',
    section: 'company',
    label: '行业类型',
    options: [
      { value: 'saas', label: 'SaaS / 软件' },
      { value: 'ai', label: 'AI / 大模型' },
      { value: 'hardware', label: '硬件 / 智能设备' },
      { value: 'fintech', label: '金融科技' },
      { value: 'health', label: '医疗健康' },
      { value: 'ecom', label: '电商 / 消费' },
      { value: 'other', label: '其他' },
    ],
    allowOtherText: true,
  },
  {
    id: 'funding',
    section: 'company',
    label: '融资阶段',
    options: [
      { value: 'none', label: '未融资' },
      { value: 'angel', label: '天使轮' },
      { value: 'pre_a', label: 'Pre-A / A 轮' },
      { value: 'b_plus', label: 'B 轮及以后' },
      { value: 'ipo', label: '已在 IPO / 对赌路径' },
    ],
    // 选了任一「有融资」档(≠未融资)→ 追加融资额输入(选填,纯采集给顾问)
    amountInput: { showWhenNot: 'none', placeholder: '本轮 / 累计融资额(选填,如 5000万人民币 / $8M)' },
  },
  {
    id: 'patent',
    section: 'company',
    label: '是否有专利',
    sub: '张江/浦东有专项补贴',
    options: [
      { value: 'granted', label: '有已授权专利' },
      { value: 'none', label: '仅申请中 / 无' },
    ],
  },

  // ── 线 A · 劳动用工(默认必答,覆盖面最广) ──
  {
    id: 'a1',
    section: 'lineA',
    label: '是否已为员工投保雇主责任险?',
    options: [
      { value: 'yes', label: '已投保' },
      { value: 'no', label: '未投保' },
    ],
  },
  {
    id: 'a2',
    section: 'lineA',
    label: '过去是否发生过劳动纠纷或仲裁?',
    // 反选择告知放在采集时点(而非仅诊断卡):已在仲裁中的个案不可保
    sub: '仅用于风险画像,不作承保依据;已在进行中的仲裁个案不可投保',
    options: [
      { value: 'yes', label: '发生过' },
      { value: 'no', label: '没有' },
      { value: 'private', label: '不便说' },
    ],
  },

  // ── 线 B · 出海合同(总闸 B0,命中深挖 —— 最高价值线) ──
  {
    id: 'b0',
    section: 'lineB',
    label: '是否有海外客户,或正在谈海外订单?',
    options: [
      { value: 'yes', label: '是' },
      { value: 'no', label: '否' },
    ],
  },
  {
    id: 'b1',
    section: 'lineB',
    label: '对方是否要求过保险证明 / COI?',
    options: [
      { value: 'yes', label: '要求过' },
      { value: 'no', label: '没有' },
      { value: 'not_yet', label: '还没到这步' },
    ],
    visible: (a) => a.b0 === 'yes',
  },
  {
    id: 'b2',
    section: 'lineB',
    label: '是否有硬件 / 实体产品销往海外?',
    options: [
      { value: 'yes', label: '有' },
      { value: 'no', label: '没有' },
    ],
    visible: (a) => a.b0 === 'yes',
  },
  {
    id: 'b3',
    section: 'lineB',
    label: '目标国家 / 地区(可多选)',
    sub: '勾选或手动输入,支持多选',
    options: [], // 用 widget:'countries' 渲染,答案存 overseasCountries
    widget: 'countries',
    optional: true, // 深挖细节,可留空,不阻断诊断
    visible: (a) => a.b0 === 'yes',
  },

  // ── 线 C · 数据与合规(C3 按行业智能展开) ──
  {
    id: 'c1',
    section: 'lineC',
    label: '是否处理用户敏感数据(隐私 / 支付 / 健康)?',
    options: [
      { value: 'yes', label: '是' },
      { value: 'no', label: '否' },
    ],
  },
  {
    id: 'c2',
    section: 'lineC',
    label: '是否正在做或计划做等保 / 个保合规?',
    options: [
      { value: 'yes', label: '在做 / 计划做' },
      { value: 'no', label: '没有' },
      { value: 'unknown', label: '不了解' },
    ],
  },
  {
    id: 'c3',
    section: 'lineC',
    label: '你们给客户提供 AI 服务,客户合同是否涉及 AI 输出责任?',
    options: [
      { value: 'yes', label: '涉及' },
      { value: 'no', label: '不涉及' },
      { value: 'unnoticed', label: '没注意过' },
    ],
    visible: (a) => a.industry === 'ai',
  },
];

/** 当前答案下需要作答的问题(条件展开求值),供页面渲染与必填校验共用 */
export function visibleQuestions(a: CollectorAnswers): QuestionDef[] {
  return COLLECTOR_QUESTIONS.filter((q) => !q.visible || q.visible(a));
}

// ═══════════════════════════════════════════════════════════════
// 缺口诊断引擎(Deterministic 规则,非 LLM 判断)
// ═══════════════════════════════════════════════════════════════

export type GapUrgency = 'mandatory' | 'high' | 'advice';

export type GapFinding = {
  id: string;
  /** 归属需求线,落库进 gap_snapshot.eventId,用于分析哪条线撬动留资 */
  line: 'line_a' | 'line_b' | 'line_c' | 'company';
  title: string;
  /** 敞口描述 */
  desc: string;
  /** 建议保障大类(只到大类,不含保司/产品/价格 —— 合规红线) */
  coverage: string;
  urgency: GapUrgency;
  /** 补贴提示(命中政策时展示) */
  subsidy?: string;
  /** 附注(痛感锚点 / 合同强制说明 / 共创候补声明等) */
  note?: string;
};

export type CollectorDiagnosis = {
  findings: GapFinding[];
  total: number;
  /** 合同/合规强制型数量(标红置顶) */
  mandatoryCount: number;
};

export const URGENCY_META: Record<GapUrgency, { label: string; rank: number }> = {
  mandatory: { label: '合同/合规强制型', rank: 0 },
  high: { label: '高优先级', rank: 1 },
  advice: { label: '建议关注', rank: 2 },
};

const REGION_NOTE: Record<string, string> = {
  na: '北美市场通常要求更高的责任限额与标准化 COI 格式。',
  eu: '欧洲市场普遍关注与数据合规(GDPR)联动的责任要求。',
  sea: '东南亚市场的合同保险要求差异较大,以具体合同条款为准。',
  apac: '亚太成熟市场对合同保险与数据合规均有较高要求。',
  mena: '中东市场的准入与合同要求差异较大,以具体项目条款为准。',
};

/** 出海目标国家 → 市场提示:列出选中市场 + 命中区域的通用提示(确定性,不涉产品/价格) */
function overseasNote(countries?: string[]): string | undefined {
  if (!countries || countries.length === 0) return undefined;
  const known = OVERSEAS_COUNTRIES.filter((c) => countries.includes(c.value));
  const customs = countries.filter((v) => !OVERSEAS_COUNTRIES.some((c) => c.value === v));
  const labels = [...known.map((c) => c.label), ...customs];
  const regionNotes = [...new Set(known.map((c) => c.region))]
    .map((r) => REGION_NOTE[r])
    .filter(Boolean);
  return [`目标市场:${labels.join('、')}。`, ...regionNotes].join(' ');
}

/**
 * 三条线规则匹配 → 敞口清单 + 紧迫度分级 + 补贴提示。
 * 排序稳定:强制型置顶,其后按 high → advice;同级按规则声明顺序。
 */
export function diagnoseGaps(a: CollectorAnswers): CollectorDiagnosis {
  const findings: GapFinding[] = [];

  // ── 线 A · 劳动用工 ──
  // 人数 ≥10 且 A1=否 → 高优先级「雇主责任险未覆盖」;1–9 人敞口较低但仍建议
  if (a.a1 === 'no') {
    const disputeNote =
      a.a2 === 'yes'
        ? '你提到此前发生过劳动纠纷/仲裁——历史敞口已现。注:已在进行中的仲裁个案不可投保,此信息仅用于风险画像,不作承保依据。'
        : undefined;
    if (a.headcount === '10to30') {
      findings.push({
        id: 'er_gap', line: 'line_a', urgency: 'high',
        title: '雇主责任险未覆盖',
        desc: '10–30 人正处劳动仲裁高发区间。员工工伤、职业病、上下班途中意外,企业需承担赔偿责任;工伤保险(社保)对停工留薪期工资、伤残就业补助、诉讼律师费等覆盖有限,差额由企业自付。',
        coverage: '雇主责任险',
        note: disputeNote,
      });
    } else if (a.headcount === '31to100') {
      findings.push({
        id: 'er_gap', line: 'line_a', urgency: 'high',
        title: '雇主责任险未覆盖',
        desc: '规模用工阶段,一起工伤致残案件社保赔付之外的企业自担部分可达数十万;团体保障缺位同时也是招人留人的短板。',
        coverage: '雇主责任险 + 团体福利保障',
        note: disputeNote,
      });
    } else if (a.headcount === 'gt100') {
      findings.push({
        id: 'er_gap', line: 'line_a', urgency: 'high',
        title: '用工风险管理缺口',
        desc: '百人以上用工体量,工伤赔偿、职业病与用工争议的年化敞口显著,建议建立整套用工风险管理(雇主责任 + 团体保障联动)。',
        coverage: '雇主责任险 + 团体保障(整套用工风险管理)',
        note: disputeNote,
      });
    } else if (a.headcount === 'lt10') {
      findings.push({
        id: 'er_gap_small', line: 'line_a', urgency: 'advice',
        title: '雇主责任敞口(人数较少,仍建议覆盖)',
        desc: '团队虽小,雇主责任敞口已存在——一起工伤事故对小团队的现金流冲击反而更大。',
        coverage: '雇主责任险',
        note: disputeNote,
      });
    }
  }

  // ── 线 B · 出海合同(最高价值线) ──
  // B0=是 → 高优先级「出海保障包」;B1=是 → 最高优先级·合同强制型·窗口以天计
  if (a.b0 === 'yes') {
    const coiForced = a.b1 === 'yes';
    const marketNote = overseasNote(a.overseasCountries);
    const notes: string[] = [];
    if (coiForced) notes.push('对方已要求保险证明(COI)——合同强制型缺口,窗口以天计,建议优先处理。');
    if (marketNote) notes.push(marketNote);
    findings.push({
      id: 'overseas_pkg', line: 'line_b', urgency: coiForced ? 'mandatory' : 'high',
      title: coiForced ? '出海保障缺口(合同强制 · COI 待出具)' : '出海保障缺口',
      desc: '海外客户合同通常以保险证明(COI)作为供应商准入/交付前提;境外索赔金额与诉讼成本远高于国内,一起海外责任索赔可能吞掉一整轮融资。',
      coverage:
        '出海保障包:职业责任(E&O)+ 网络安全' +
        (a.b2 === 'yes' ? ' + 产品责任(实体产品出口)' : ' + 产品责任') +
        ' + COI 出具服务',
      note: notes.length ? notes.join(' ') : undefined,
    });
  }

  // ── 融资阶段 → 董责险 ──
  if (a.funding === 'ipo') {
    findings.push({
      id: 'dno_ipo', line: 'company', urgency: 'mandatory',
      title: '董责险(D&O)缺口 —— IPO/对赌路径刚需',
      desc: 'IPO / 对赌路径下,董责险是科创板/北交所上市前置惯例;信息披露、对赌与股东争议使董事/高管个人财产直接暴露。',
      coverage: '董监事及高级管理人员责任保险(D&O)',
    });
  } else if (a.funding === 'b_plus') {
    findings.push({
      id: 'dno_b', line: 'company', urgency: 'high',
      title: '董责险(D&O)缺位',
      desc: '机构投资人入局后,董事会决策、信息披露与股东争议使董监高承担个人连带责任;D&O 是机构投资人常见的投后要求。',
      coverage: '董监事及高级管理人员责任保险(D&O)',
    });
  } else if (a.funding === 'pre_a') {
    findings.push({
      id: 'dno_pre', line: 'company', urgency: 'advice',
      title: '关键人与董责风险(提前建立认知)',
      desc: '创始人/核心技术人是公司价值锚;下一轮引入机构投资人时,关键人保障与 D&O 通常会进入投后要求清单。',
      coverage: '关键人保障 + 董责险(认知铺垫)',
    });
  }

  // ── 专利 → 知识产权险(补贴钩子) ──
  if (a.patent === 'granted') {
    findings.push({
      id: 'ip_ins', line: 'company', urgency: 'advice',
      title: '知识产权保障未配置',
      desc: '已授权专利存在双向敞口:被侵权时的维权成本,与被诉侵权时的抗辩及赔偿成本。',
      coverage: '知识产权保险',
      subsidy: '张江/浦东对科技型企业投保知识产权保险有专项补贴,可覆盖大部分保费成本。',
    });
  }

  // ── 线 C · 数据与合规 ──
  if (a.c1 === 'yes' && a.c2 === 'yes') {
    // 等保/个保合规进行中 → 高优先级(合规联动),叠补贴。
    // 刻意不标 mandatory:等保并不强制投保网络安全险,红标会构成「监管强制投保」
    // 暗示,踩中立红线(评审裁决);强制型仅保留 COI 合同强制与 IPO 董责两类。
    findings.push({
      id: 'cyber_comp', line: 'line_c', urgency: 'high',
      title: '数据安全保障缺口(等保/合规联动)',
      desc: '处理用户敏感数据且等保/个保合规已在进行——数据安全责任已进入监管视野,数据泄露的应急处置、第三方赔偿与监管应对需要保障兜底。',
      coverage: '网络安全保险(Cyber)',
      subsidy: '部分园区对完成等保测评的企业投保网络安全险有补贴,可叠加使用。',
    });
  } else if (a.c1 === 'yes') {
    // C1=是且 C2 未做/不了解 → 「数据安全敞口」
    findings.push({
      id: 'cyber_gap', line: 'line_c', urgency: 'high',
      title: '数据安全敞口',
      desc: '处理用户敏感数据但尚未进入等保/个保合规流程,数据泄露事件的应急处置费用、第三方赔偿与监管处罚应对均无覆盖。',
      coverage: '网络安全保险(Cyber)+ 等保/个保合规规划',
    });
  } else if (a.c2 === 'yes') {
    findings.push({
      id: 'cyber_only_comp', line: 'line_c', urgency: 'advice',
      title: '合规配套保障',
      desc: '等保/个保合规推进中,可同步评估网络安全保障与合规体系的联动配置。',
      coverage: '网络安全保险(Cyber)',
      subsidy: '部分园区对完成等保测评的企业投保网络安全险有补贴,可叠加使用。',
    });
  }

  // C3=是 → AI 责任候补名单(品类共创中,不承诺现有产品)
  if (a.industry === 'ai' && a.c3 === 'yes') {
    findings.push({
      id: 'ai_liability', line: 'line_c', urgency: 'advice',
      title: 'AI 输出责任(品类共创候补)',
      desc: '客户合同涉及 AI 输出责任——这是新兴风险品类,现有市场产品覆盖有限。',
      coverage: 'AI 服务责任(方案共创中)',
      // 「顾问沟通时确认加入」而非自动入名单:避免与隐私声明「仅用于生成诊断报告,
      // 不会用于其他目的」构成用途冲突(评审裁决)
      note: '如你希望进入 AI 服务责任候补名单,可在顾问沟通时确认加入,方案可用时优先获得评估;此处不构成对现有产品的承诺。',
    });
  }

  // ── 行业基线建议(仅在未被上面更具体的缺口覆盖时补充) ──
  const has = (id: string) => findings.some((f) => f.id === id);
  const hasCyber = has('cyber_comp') || has('cyber_gap') || has('cyber_only_comp');
  const hasOverseas = has('overseas_pkg');
  if ((a.industry === 'saas' || a.industry === 'ai') && !hasOverseas) {
    findings.push({
      id: 'teo_base', line: 'company', urgency: 'advice',
      title: '软件/技术服务责任基础敞口',
      desc: '软件故障、服务中断或交付缺陷导致客户损失的赔偿责任,是技术服务商业模式的基础敞口。',
      coverage: '科技类职业责任(Tech E&O)' + (hasCyber ? '' : ' + 网络安全'),
    });
  }
  if (a.industry === 'hardware' && !(a.b0 === 'yes' && a.b2 === 'yes')) {
    findings.push({
      id: 'product_base', line: 'company', urgency: 'advice',
      title: '产品责任基础敞口',
      desc: '硬件/智能设备造成人身或财产损害的赔偿责任,内销与出口都存在,出口市场尤甚。',
      coverage: '产品责任保险',
    });
  }
  if (a.industry === 'fintech' && !hasCyber) {
    findings.push({
      id: 'fintech_base', line: 'company', urgency: 'advice',
      title: '金融科技数据与资金风险敞口',
      desc: '支付与资金链路的数据安全事件、内外部欺诈是金融科技的两类高频敞口。',
      coverage: '网络安全保险(Cyber)',
    });
  }
  if (a.industry === 'health' && !hasCyber) {
    findings.push({
      id: 'health_base', line: 'company', urgency: 'advice',
      title: '医疗健康数据合规敞口',
      desc: '健康数据属最高敏感级,数据合规与服务责任是医疗健康赛道的准入型风险。',
      coverage: '网络安全保险(Cyber)+ 相关责任保障',
    });
  }
  if (a.industry === 'ecom') {
    findings.push({
      id: 'ecom_base', line: 'company', urgency: 'advice',
      title: '经营场景责任敞口',
      desc: '线下活动/仓储物流的第三者人身财产损害,与所售产品缺陷责任,是电商/消费业态的两类常见敞口。',
      coverage: '公众责任保险 + 产品责任保险',
    });
  }

  // 排序:强制型置顶 → high → advice;同级保持规则声明顺序(sort 稳定)
  findings.sort((x, y) => URGENCY_META[x.urgency].rank - URGENCY_META[y.urgency].rank);

  return {
    findings,
    total: findings.length,
    mandatoryCount: findings.filter((f) => f.urgency === 'mandatory').length,
  };
}

/** 命中的需求线集合(落库进 selected_events,与 /qiye 的事件语义对齐;空缺口时回退 'none') */
export function hitLines(d: CollectorDiagnosis): string[] {
  const lines = [...new Set(d.findings.map((f) => f.line))];
  return lines.length > 0 ? lines : ['none'];
}

// ═══════════════════════════════════════════════════════════════
// 合规文案(P0 红线;话术以持牌顾问/法务终审为准)
// ═══════════════════════════════════════════════════════════════

/** 隐私声明(个保法合规,第一段联系人档案处展示;逐字来自设计文档) */
export const COLLECTOR_PRIVACY_NOTICE =
  '提交即表示同意确石智能就保障诊断结果通过电话/微信与你联系。信息仅用于生成诊断报告,不会用于其他目的,可随时要求删除。同意不是获取诊断的条件。';

/** 诊断预览页固定声明:非投保建议 + 不涉及产品/价格 + 持牌出单披露(机构信息占位) */
export const COLLECTOR_DISCLAIMER =
  '本诊断为基于你提交信息的规则化风险提示,不构成投保建议,不涉及任何具体保险产品与价格;实际保障缺口与方案需由持牌保险顾问结合贵司具体情况评估。出单由合作持牌保险经纪机构完成,机构全称及许可证号将在顾问沟通时向你披露。保对了(EnsureOK)是独立第三方风险分析工具,不销售保险产品。';

/** 提交成功文案 */
export const COLLECTOR_SUCCESS_TITLE = '已收到,顾问会在 24 小时内联系你';
export const COLLECTOR_SUCCESS_SUB =
  '顾问将结合你的画像给出完整体检报告与保障方案评估;出单(如需)由合作持牌保险经纪机构完成。';
