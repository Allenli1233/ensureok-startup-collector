/**
 * 创业公司保障画像采集器 —— 配置层单测
 *
 * 见 src/config/startupProfileCollector.ts。覆盖:
 *   - visibleQuestions 条件展开:B1–B3 需 B0=是;C3 仅 AI 行业;
 *   - diagnoseGaps 三条线规则:每条缺口的触发/不触发边界、紧迫度分级、
 *     强制型置顶排序、补贴提示、反选择附注;
 *   - 合规护栏(P0 红线):文案不出现保费金额与「立即投保/购买」措辞、
 *     隐私声明与披露声明含关键合规词。
 * 文案本体可热改,护栏只钉不变量(触发条件 / 分级 / 合规词),不锁具体措辞。
 */
import { describe, it, expect } from 'vitest';
import {
  COLLECTOR_QUESTIONS,
  COLLECTOR_PRIVACY_NOTICE,
  COLLECTOR_DISCLAIMER,
  visibleQuestions,
  diagnoseGaps,
  hitLines,
  type CollectorAnswers,
} from '../src/config/startupProfileCollector';

/** 一份「全部低风险」基线答案,单测在其上做单点翻转 */
const baseline = (): CollectorAnswers => ({
  headcount: 'lt10',
  industry: 'other',
  funding: 'none',
  patent: 'none',
  a1: 'yes',
  a2: 'no',
  b0: 'no',
  c1: 'no',
  c2: 'no',
});

describe('COLLECTOR_QUESTIONS / visibleQuestions(条件展开)', () => {
  it('问题定义约 13 条(4 基本盘 + 2A + 4B + 3C),id 互不重复', () => {
    const ids = COLLECTOR_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(13);
  });

  it('B0=否 时 B1–B3 隐藏;B0=是 时展开', () => {
    const closed = visibleQuestions({ ...baseline(), b0: 'no' }).map((q) => q.id);
    expect(closed).not.toContain('b1');
    expect(closed).not.toContain('b2');
    expect(closed).not.toContain('b3');
    const open = visibleQuestions({ ...baseline(), b0: 'yes' }).map((q) => q.id);
    expect(open).toEqual(expect.arrayContaining(['b1', 'b2', 'b3']));
  });

  it('C3 仅 AI 行业展开', () => {
    expect(visibleQuestions({ ...baseline(), industry: 'saas' }).map((q) => q.id)).not.toContain('c3');
    expect(visibleQuestions({ ...baseline(), industry: 'ai' }).map((q) => q.id)).toContain('c3');
  });

  it('每题 label 非空且 ≥2 个选项', () => {
    for (const q of COLLECTOR_QUESTIONS) {
      expect(q.label.trim().length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('diagnoseGaps · 线 A 劳动用工', () => {
  it('人数 ≥10 且 A1=否 → 高优先级雇主责任缺口', () => {
    const d = diagnoseGaps({ ...baseline(), headcount: '10to30', a1: 'no' });
    const f = d.findings.find((x) => x.id === 'er_gap');
    expect(f).toBeTruthy();
    expect(f!.urgency).toBe('high');
    expect(f!.line).toBe('line_a');
  });

  it('人数 1–9 且 A1=否 → 建议级(敞口较低但仍建议)', () => {
    const d = diagnoseGaps({ ...baseline(), headcount: 'lt10', a1: 'no' });
    const f = d.findings.find((x) => x.id === 'er_gap_small');
    expect(f).toBeTruthy();
    expect(f!.urgency).toBe('advice');
  });

  it('A1=是 → 不出雇主责任缺口', () => {
    const d = diagnoseGaps({ ...baseline(), headcount: 'gt100', a1: 'yes' });
    expect(d.findings.some((x) => x.id.startsWith('er_gap'))).toBe(false);
  });

  it('A2=是 → 附注含痛感锚点与「不作承保依据」反选择声明', () => {
    const d = diagnoseGaps({ ...baseline(), headcount: '10to30', a1: 'no', a2: 'yes' });
    const f = d.findings.find((x) => x.id === 'er_gap');
    expect(f!.note).toBeTruthy();
    expect(f!.note!).toContain('不作承保依据');
  });
});

describe('diagnoseGaps · 线 B 出海合同(最高价值线)', () => {
  it('B0=是 → 高优先级出海保障包(含 COI 出具服务)', () => {
    const d = diagnoseGaps({ ...baseline(), b0: 'yes', b1: 'not_yet' });
    const f = d.findings.find((x) => x.id === 'overseas_pkg');
    expect(f).toBeTruthy();
    expect(f!.urgency).toBe('high');
    expect(f!.coverage).toContain('COI');
  });

  it('B1=是(对方要求过 COI)→ 升级为合同强制型 mandatory', () => {
    const d = diagnoseGaps({ ...baseline(), b0: 'yes', b1: 'yes' });
    const f = d.findings.find((x) => x.id === 'overseas_pkg');
    expect(f!.urgency).toBe('mandatory');
    expect(f!.note!).toContain('窗口以天计');
  });

  it('B0=否 → 不出出海缺口', () => {
    const d = diagnoseGaps({ ...baseline(), b0: 'no' });
    expect(d.findings.some((x) => x.id === 'overseas_pkg')).toBe(false);
  });

  it('B2=是 → coverage 强调实体产品出口;B3 市场影响附注', () => {
    const d = diagnoseGaps({ ...baseline(), b0: 'yes', b2: 'yes', b3: 'na' });
    const f = d.findings.find((x) => x.id === 'overseas_pkg');
    expect(f!.coverage).toContain('实体产品出口');
    expect(f!.note!).toContain('北美');
  });
});

describe('diagnoseGaps · 融资/专利/线 C', () => {
  it('IPO/对赌路径 → 董责险 mandatory;B 轮 → high;Pre-A → advice;未融资 → 无', () => {
    expect(diagnoseGaps({ ...baseline(), funding: 'ipo' }).findings.find((x) => x.id === 'dno_ipo')!.urgency).toBe('mandatory');
    expect(diagnoseGaps({ ...baseline(), funding: 'b_plus' }).findings.find((x) => x.id === 'dno_b')!.urgency).toBe('high');
    expect(diagnoseGaps({ ...baseline(), funding: 'pre_a' }).findings.find((x) => x.id === 'dno_pre')!.urgency).toBe('advice');
    expect(diagnoseGaps({ ...baseline(), funding: 'none' }).findings.some((x) => x.id.startsWith('dno'))).toBe(false);
  });

  it('已授权专利 → 知识产权险 + 张江/浦东补贴提示', () => {
    const f = diagnoseGaps({ ...baseline(), patent: 'granted' }).findings.find((x) => x.id === 'ip_ins');
    expect(f).toBeTruthy();
    expect(f!.subsidy).toContain('张江');
  });

  it('C1=是且 C2 未做/不了解 → 高优先级数据安全敞口', () => {
    for (const c2 of ['no', 'unknown'] as const) {
      const f = diagnoseGaps({ ...baseline(), c1: 'yes', c2 }).findings.find((x) => x.id === 'cyber_gap');
      expect(f).toBeTruthy();
      expect(f!.urgency).toBe('high');
    }
  });

  it('C1=是且 C2=在做 → 高优先级(合规联动)+ 补贴;刻意不标 mandatory(等保不强制投保,避免监管强制暗示)', () => {
    const f = diagnoseGaps({ ...baseline(), c1: 'yes', c2: 'yes' }).findings.find((x) => x.id === 'cyber_comp');
    expect(f).toBeTruthy();
    expect(f!.urgency).toBe('high');
    expect(f!.subsidy).toBeTruthy();
  });

  it('强制型(mandatory)只可能来自 COI 合同强制与 IPO 董责两类(中立红线护栏)', () => {
    // 构造除 B1/IPO 外全部高命中的画像,断言无 mandatory
    const d = diagnoseGaps({
      ...baseline(),
      headcount: 'gt100', a1: 'no', a2: 'yes',
      industry: 'ai', c3: 'yes', c1: 'yes', c2: 'yes',
      patent: 'granted', funding: 'b_plus',
      b0: 'yes', b1: 'not_yet', b2: 'yes', b3: 'na',
    });
    expect(d.mandatoryCount).toBe(0);
  });

  it('AI 行业且 C3=是 → 候补名单卡,note 声明不构成产品承诺', () => {
    const f = diagnoseGaps({ ...baseline(), industry: 'ai', c3: 'yes' }).findings.find((x) => x.id === 'ai_liability');
    expect(f).toBeTruthy();
    expect(f!.note!).toContain('候补');
    expect(f!.note!).toContain('不构成');
  });

  it('非 AI 行业即使 c3=yes 也不出 AI 候补卡(防脏数据)', () => {
    const d = diagnoseGaps({ ...baseline(), industry: 'saas', c3: 'yes' });
    expect(d.findings.some((x) => x.id === 'ai_liability')).toBe(false);
  });
});

describe('diagnoseGaps · 排序 / 汇总 / hitLines', () => {
  it('强制型标红置顶:mandatory 排最前,advice 排最后', () => {
    const d = diagnoseGaps({
      ...baseline(),
      headcount: '10to30', a1: 'no',          // high
      b0: 'yes', b1: 'yes',                    // mandatory
      patent: 'granted',                       // advice
    });
    expect(d.findings[0].urgency).toBe('mandatory');
    expect(d.findings[d.findings.length - 1].urgency).toBe('advice');
    expect(d.mandatoryCount).toBe(1);
    expect(d.total).toBe(d.findings.length);
  });

  it('全低风险画像 → 可为空缺口;hitLines 回退 ["none"]', () => {
    const d = diagnoseGaps(baseline());
    expect(d.findings).toHaveLength(0);
    expect(hitLines(d)).toEqual(['none']);
  });

  it('hitLines 输出命中线集合(去重)', () => {
    const d = diagnoseGaps({ ...baseline(), headcount: '10to30', a1: 'no', b0: 'yes' });
    const lines = hitLines(d);
    expect(lines).toEqual(expect.arrayContaining(['line_a', 'line_b']));
  });
});

describe('合规护栏(P0 红线)', () => {
  it('全部诊断文案不出现具体保费金额(「X 元」)与「立即投保/立即购买」', () => {
    // 穷举有代表性的高命中画像,聚合全部输出文案做红线扫描
    const profiles: CollectorAnswers[] = [
      { ...baseline(), headcount: 'gt100', a1: 'no', a2: 'yes', b0: 'yes', b1: 'yes', b2: 'yes', b3: 'na', funding: 'ipo', patent: 'granted', c1: 'yes', c2: 'yes', industry: 'ai', c3: 'yes' },
      { ...baseline(), headcount: '31to100', a1: 'no', funding: 'b_plus', industry: 'fintech', c1: 'yes', c2: 'unknown' },
      { ...baseline(), industry: 'ecom', funding: 'pre_a' },
    ];
    const all = profiles
      .flatMap((p) => diagnoseGaps(p).findings)
      .flatMap((f) => [f.title, f.desc, f.coverage, f.subsidy || '', f.note || ''])
      .join('\n');
    expect(all).not.toMatch(/\d+(\.\d+)?\s*(元|万元|块钱)/);
    expect(all).not.toMatch(/立即(投保|购买|下单)/);
  });

  it('隐私声明含个保法关键要素(用途限定/可删除/同意非前提)', () => {
    expect(COLLECTOR_PRIVACY_NOTICE).toContain('仅用于');
    expect(COLLECTOR_PRIVACY_NOTICE).toContain('删除');
    expect(COLLECTOR_PRIVACY_NOTICE).toContain('同意不是获取诊断的条件');
  });

  it('披露声明含「不构成投保建议」与持牌出单披露', () => {
    expect(COLLECTOR_DISCLAIMER).toContain('不构成投保建议');
    expect(COLLECTOR_DISCLAIMER).toContain('持牌');
    expect(COLLECTOR_DISCLAIMER).toContain('不销售保险产品');
  });
});
