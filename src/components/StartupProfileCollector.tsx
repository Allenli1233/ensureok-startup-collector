/**
 * StartupProfileCollector —— 创业公司保障画像采集器(国内版 · 独立站,移植自主站 /qiye/profile)
 *
 * 三段式采集(联系人档案 → 公司基本盘 → 三条需求线)→ 确定性缺口诊断预览 →
 * 「预约顾问」留资。字段/规则/合规文案全部在 src/config/startupProfileCollector.ts,
 * 本组件只做渲染、条件展开与提交。
 *
 * 与 /qiye(StartupGapCheck)的关系:同一条 PMF 业务线的深版采集器,复用
 * startup_leads 落库(多传 profile 全量画像)与 tracker 埋点管道。
 *
 * 埋点(北极星漏斗):
 *   startup_profile.page_view(挂载)→ startup_profile.preview_viewed(诊断完成率分子/
 *   留资转化率分母,ref 只触发一次)→ startup_profile.lead_submitted(北极星分子)。
 *
 * 合规红线(P0):不出现保费金额、不出现「具体产品+保司」报价、无「立即投保/购买」CTA;
 * CTA 仅为「预约顾问领取完整体检报告」,持牌出单披露见 COLLECTOR_DISCLAIMER。
 *
 * 纪律同 /qiye:不接 i18n(单市场 PMF,中文硬编码)、不引新依赖、无 OCR/agent/账号/支付。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogoMark } from './LogoMark';
import { apiUrl } from '../api/config';
import { track } from '../api/tracker';
import { useProposal } from '../proposal/useProposal';
import { buildProposalRequest } from '../proposal/buildRequest';
import { ProposalView } from '../proposal/ProposalView';
import {
  OVERSEAS_COUNTRIES,
  COLLECTOR_PRIVACY_NOTICE,
  COLLECTOR_DISCLAIMER,
  COLLECTOR_SUCCESS_TITLE,
  COLLECTOR_SUCCESS_SUB,
  URGENCY_META,
  visibleQuestions,
  diagnoseGaps,
  hitLines,
  type CollectorAnswers,
  type QuestionDef,
  type QuestionId,
} from '../config/startupProfileCollector';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const SECTION_META: Record<QuestionDef['section'], { title: string; sub?: string }> = {
  company: { title: '公司基本盘' },
  lineA: { title: '线 A · 劳动用工', sub: '覆盖面最广的一条线' },
  lineB: { title: '线 B · 出海合同', sub: '有海外业务才展开细问' },
  lineC: { title: '线 C · 数据与合规' },
};

const URGENCY_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  mandatory: { color: '#b42318', bg: '#fef3f2', border: '#fecdca' },
  high: { color: '#b54708', bg: '#fffaeb', border: '#fedf89' },
  advice: { color: 'var(--ink-700)', bg: 'var(--soft)', border: 'var(--sand-300)' },
};

export function StartupProfileCollector() {
  // ── 第一段 · 联系人档案 ──
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [wechat, setWechat] = useState('');
  // ── 第二/三段答案 ──
  const [answers, setAnswers] = useState<CollectorAnswers>({});
  const [industryOther, setIndustryOther] = useState('');
  // ── 诊断与提交 ──
  const [showPreview, setShowPreview] = useState(false);
  const [validationMsg, setValidationMsg] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const previewFiredRef = useRef(false);
  const previewAnchorRef = useRef<HTMLDivElement | null>(null);
  const contactCardRef = useRef<HTMLDivElement | null>(null);

  // 方案生成(提交成功后异步:后端 Agent 结合诊断+RAG+产品库生成一份风险保障方向说明)
  const proposal = useProposal();

  useEffect(() => {
    track('startup_profile.page_view');
  }, []);

  const visible = useMemo(() => visibleQuestions(answers), [answers]);
  const diagnosis = useMemo(() => diagnoseGaps(answers), [answers]);

  const setAnswer = (id: QuestionId, value: string) => {
    // 已出预览后改答案 → 预览实时跟随(diagnosis 是 useMemo 纯函数,天然一致)
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setValidationMsg('');
  };

  const contactOk = phone.trim().length > 0 || wechat.trim().length > 0;
  // optional 题(如出海国家多选)不纳入必答;其余可见题需有答案
  const answersOk = visible.every((q) => q.optional || !!answers[q.id]);
  // 诊断只依赖问卷答案(纯前端确定性规则)——联系方式不是获取诊断的条件,
  // 与隐私声明逐字一致;联系人必填校验推迟到「预约顾问」提交步(服务端本就强制)。
  // 这同时保证 preview_viewed 分母与 /qiye 基线口径可比(无留资摩擦污染)。
  const canDiagnose = answersOk;

  const handleDiagnose = () => {
    if (!answersOk) {
      setValidationMsg('还有问题未作答,请补全后生成诊断');
      return;
    }
    setValidationMsg('');
    setShowPreview(true);
    if (!previewFiredRef.current) {
      previewFiredRef.current = true;
      track('startup_profile.preview_viewed', {
        lines: hitLines(diagnosis),
        total: diagnosis.total,
        mandatory: diagnosis.mandatoryCount,
      });
    }
    // 下一帧滚到预览区(元素渲染后)
    requestAnimationFrame(() => {
      previewAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleSubmit = async () => {
    if (submitState === 'submitting') return;
    // 联系人必填校验在此(而非诊断步):称呼/公司/联系方式是预约顾问的前提
    if (!name.trim() || !company.trim() || !contactOk) {
      setSubmitState('error');
      setErrorMsg(
        !name.trim() || !company.trim()
          ? '请回到第 1 步填写称呼与公司名称'
          : '请回到第 1 步填写手机号或微信号(顾问联系用)',
      );
      contactCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitState('submitting');
    setErrorMsg('');

    const source = (() => {
      try {
        return new URLSearchParams(window.location.search).get('src') || undefined;
      } catch {
        return undefined;
      }
    })();

    const contactType = phone.trim() ? 'phone' : 'wechat';
    // 按当前可见性剪枝:总闸收起后的陈旧答案(如 b0 改回否后的 b1–b3)不落库,
    // 避免顾问读到 b0=否 与 b1=是 并存的自相矛盾画像
    const prunedAnswers = Object.fromEntries(
      visible.map((q) => [q.id, answers[q.id]]).filter(([, v]) => !!v),
    );
    const body = {
      selectedEvents: hitLines(diagnosis),
      gapSnapshot: diagnosis.findings.map((f) => ({ eventId: f.line, title: f.title })),
      name: name.trim(),
      company: company.trim(),
      contact: phone.trim() || wechat.trim(),
      contactType,
      // 画像(collector v1 契约):可见答案 + 双联系方式,落 startup_leads.profile_json
      profile: {
        version: 'collector_v1',
        answers: prunedAnswers,
        industryOther:
          answers.industry === 'other' && industryOther.trim() ? industryOther.trim() : undefined,
        // 有融资时才带融资额;未融资/留空不带
        fundingAmount:
          answers.funding && answers.funding !== 'none' && answers.fundingAmount?.trim()
            ? answers.fundingAmount.trim()
            : undefined,
        // 出海(b0=yes)且选了国家才带;b0 改回否时不落库(与 prune 同纪律)
        overseasCountries:
          answers.b0 === 'yes' && answers.overseasCountries && answers.overseasCountries.length > 0
            ? answers.overseasCountries
            : undefined,
        phone: phone.trim() || undefined,
        wechat: wechat.trim() || undefined,
      },
      ...(source ? { source } : {}),
    };

    try {
      const res = await fetch(apiUrl('/api/startup-leads'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; id?: string; error?: string }
        | null;
      if (res.ok && data?.ok) {
        setSubmitState('success');
        track('startup_profile.lead_submitted', {
          lines: hitLines(diagnosis),
          contactType,
          mandatory: diagnosis.mandatoryCount,
        });
        // 提交成功 → 触发方案生成(不含 PII,只发脱敏画像+诊断)
        void proposal.start(
          buildProposalRequest({ company: company.trim(), answers, industryOther, diagnosis }),
        );
      } else {
        setSubmitState('error');
        setErrorMsg(data?.error || '提交失败,请稍后再试。');
      }
    } catch {
      setSubmitState('error');
      setErrorMsg('网络异常,请检查连接后重试。');
    }
  };

  // 按 section 分组渲染(保持 COLLECTOR_QUESTIONS 声明顺序)
  const sections: Array<{ key: QuestionDef['section']; questions: QuestionDef[] }> = (
    ['company', 'lineA', 'lineB', 'lineC'] as const
  ).map((key) => ({ key, questions: visible.filter((q) => q.section === key) }));

  return (
    <div style={styles.container}>
      {/* ── 品牌行(复用 /qiye 观感) ── */}
      <div style={styles.header}>
        <div style={styles.brandRow}>
          <div style={styles.logoBox}>
            <LogoMark size={30} title="EnsureOK.ai · 创业公司保障画像" />
          </div>
          <span style={styles.trustBadge}>先诊断 · 不推销</span>
        </div>
        <h1 style={styles.title}>创业公司保障画像 · 3 分钟</h1>
        <p style={styles.subtitle}>
          围绕初创绕不开的三条风险线——劳动用工 · 出海合同 · 数据合规,
          约 3 分钟生成你公司的保障缺口诊断,再由顾问出完整体检报告。
        </p>
      </div>

      {/* ── 第 1 段 · 联系人档案 ── */}
      <div style={styles.sectionLabel}>第 1 步 · 联系人档案</div>
      <div ref={contactCardRef} style={styles.card}>
        <input
          style={styles.input}
          placeholder="你的称呼"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="称呼"
        />
        <input
          style={styles.input}
          placeholder="公司名称"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          aria-label="公司名称"
        />
        <input
          style={styles.input}
          placeholder="手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-label="手机号"
          inputMode="tel"
        />
        <input
          style={{ ...styles.input, marginBottom: 0 }}
          placeholder="微信号(与手机号至少填一项)"
          value={wechat}
          onChange={(e) => setWechat(e.target.value)}
          aria-label="微信号"
        />
        <p style={styles.privacyNote}>{COLLECTOR_PRIVACY_NOTICE}</p>
      </div>

      {/* ── 第 2 步 · 公司基本盘 / 第 3 步 · 三条需求线 ── */}
      {sections.map(({ key, questions }, idx) => {
        if (questions.length === 0) return null;
        const meta = SECTION_META[key];
        return (
          <div key={key} style={styles.section}>
            <div style={styles.sectionLabel}>
              {key === 'company' ? '第 2 步 · ' : idx === 1 ? '第 3 步 · 三条风险线快测 —— ' : ''}
              {meta.title}
              {meta.sub && <span style={styles.sectionSub}>{meta.sub}</span>}
            </div>
            {questions.map((q) => (
              <div key={q.id} style={styles.questionBlock}>
                <div style={styles.questionLabel}>
                  {q.label}
                  {q.sub && <span style={styles.questionSub}>{q.sub}</span>}
                </div>
                {q.widget === 'countries' ? (
                  <CountryMultiSelect
                    value={answers.overseasCountries ?? []}
                    onChange={(next) => {
                      setAnswers((prev) => ({ ...prev, overseasCountries: next }));
                      setValidationMsg('');
                    }}
                  />
                ) : (
                  <div style={styles.chipRow}>
                    {q.options.map((opt) => {
                      const active = answers[q.id] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setAnswer(q.id, opt.value)}
                          style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {q.allowOtherText && answers[q.id] === 'other' && (
                  <input
                    style={{ ...styles.input, marginTop: 10, marginBottom: 0 }}
                    placeholder="行业补充说明(选填)"
                    value={industryOther}
                    onChange={(e) => setIndustryOther(e.target.value)}
                    aria-label="行业补充"
                  />
                )}
                {q.amountInput && answers[q.id] && answers[q.id] !== q.amountInput.showWhenNot && (
                  <input
                    style={{ ...styles.input, marginTop: 10, marginBottom: 0 }}
                    placeholder={q.amountInput.placeholder}
                    value={answers.fundingAmount ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, fundingAmount: e.target.value }))
                    }
                    aria-label="融资额"
                    inputMode="numeric"
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}

      {/* ── 生成诊断 ── */}
      {!showPreview && (
        <div style={styles.diagnoseBox}>
          {validationMsg && (
            <div style={styles.errorText} role="alert">
              {validationMsg}
            </div>
          )}
          <button
            type="button"
            style={{ ...styles.primaryBtn, opacity: canDiagnose ? 1 : 0.55 }}
            onClick={handleDiagnose}
          >
            生成保障缺口诊断
          </button>
          <div style={styles.formHint}>诊断为规则化风险提示,不涉及任何产品与价格。</div>
        </div>
      )}

      {/* ── 缺口预览 + 预约 CTA ── */}
      {showPreview && (
        <div ref={previewAnchorRef} style={styles.previewSection}>
          <div style={styles.sectionLabel}>你的保障缺口预览</div>
          <div style={styles.summaryLine}>
            {diagnosis.total > 0 ? (
              <>
                你有 <strong>{diagnosis.total}</strong> 项敞口待评估
                {diagnosis.mandatoryCount > 0 && (
                  <>
                    ,其中 <strong style={{ color: '#b42318' }}>{diagnosis.mandatoryCount}</strong>{' '}
                    项属合同/合规强制型
                  </>
                )}
                。
              </>
            ) : (
              <>按你提交的画像,暂未命中高优先级敞口——仍建议由顾问做一次完整体检确认。</>
            )}
          </div>

          <div style={styles.gapList}>
            {diagnosis.findings.map((f) => {
              const u = URGENCY_STYLE[f.urgency];
              return (
                <div
                  key={f.id}
                  style={{
                    ...styles.gapCard,
                    ...(f.urgency === 'mandatory' ? { borderColor: u.border } : {}),
                  }}
                >
                  <div style={styles.gapHead}>
                    <span
                      style={{
                        ...styles.urgencyBadge,
                        color: u.color,
                        background: u.bg,
                        borderColor: u.border,
                      }}
                    >
                      {URGENCY_META[f.urgency].label}
                    </span>
                    <span style={styles.gapTitle}>{f.title}</span>
                  </div>
                  <div style={styles.gapWhy}>{f.desc}</div>
                  <div style={styles.gapCoverage}>建议保障大类:{f.coverage}</div>
                  {f.subsidy && <div style={styles.subsidyPill}>补贴提示 · {f.subsidy}</div>}
                  {f.note && <div style={styles.gapNote}>{f.note}</div>}
                </div>
              );
            })}
          </div>

          <p style={styles.disclaimer}>{COLLECTOR_DISCLAIMER}</p>

          <div style={styles.ctaSection}>
            {submitState === 'success' ? (
              <>
                <div style={styles.successBox}>
                  <div style={styles.successTitle}>{COLLECTOR_SUCCESS_TITLE}</div>
                  <div style={styles.successSub}>{COLLECTOR_SUCCESS_SUB}</div>
                </div>
                {proposal.status === 'loading' && (
                  <div style={{ ...styles.formHint, marginTop: 16 }}>
                    正在为你生成初步保障方向说明(结合产品库与条款检索,约需 1–3 分钟,请勿关闭页面)…
                  </div>
                )}
                {proposal.status === 'error' && (
                  <div style={{ marginTop: 16 }}>
                    <div style={styles.errorText} role="alert">
                      方案生成失败:{proposal.error}
                    </div>
                    <button
                      type="button"
                      style={styles.primaryBtn}
                      onClick={() =>
                        void proposal.start(
                          buildProposalRequest({ company: company.trim(), answers, industryOther, diagnosis }),
                        )
                      }
                    >
                      重试生成方案
                    </button>
                  </div>
                )}
                {proposal.status === 'ready' && proposal.proposal && (
                  <ProposalView proposal={proposal.proposal} />
                )}
              </>
            ) : (
              <>
                {submitState === 'error' && errorMsg && (
                  <div style={styles.errorText} role="alert">
                    {errorMsg}
                  </div>
                )}
                <button
                  type="button"
                  style={{ ...styles.primaryBtn, opacity: submitState === 'submitting' ? 0.6 : 1 }}
                  onClick={handleSubmit}
                  disabled={submitState === 'submitting'}
                >
                  {submitState === 'submitting' ? '提交中…' : '预约顾问领取完整体检报告'}
                </button>
                <div style={styles.formHint}>
                  顾问 24 小时内联系;联系方式仅用于本次诊断沟通,不对外展示、不群发。
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 国家/地区多选控件(可复用):常见出海国家勾选 + 自由文字输入自定义,全部多选。
 * value 是已选集合(勾选项的 value + 自定义文字条目);onChange 回传新集合。
 */
function CountryMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [custom, setCustom] = useState('');
  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  const addCustom = () => {
    const t = custom.trim();
    // 去重,且不与预设国家的中文名重复(避免同一国家两种表示)
    if (t && !value.includes(t) && !OVERSEAS_COUNTRIES.some((c) => c.label === t)) {
      onChange([...value, t]);
    }
    setCustom('');
  };
  const customEntries = value.filter((v) => !OVERSEAS_COUNTRIES.some((c) => c.value === v));
  return (
    <div>
      <div style={styles.chipRow}>
        {OVERSEAS_COUNTRIES.map((c) => {
          const active = value.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(c.value)}
              style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      {customEntries.length > 0 && (
        <div style={{ ...styles.chipRow, marginTop: 8 }}>
          {customEntries.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              style={{ ...styles.chip, ...styles.chipActive }}
              aria-label={`移除 ${v}`}
            >
              {v} ✕
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          style={{ ...styles.input, flex: 1, marginBottom: 0 }}
          placeholder="其它国家 / 地区,回车或点添加"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          aria-label="自定义国家"
        />
        <button type="button" onClick={addCustom} style={{ ...styles.chip, flexShrink: 0 }}>
          添加
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    // #root 是 height:100%+overflow:hidden(SiliconApp 自管滚动);本页直接挂 root，
    // 必须自己成为滚动容器,否则长表单超一屏后会被 root 裁掉且整页不可滚。
    // border-box 让 padding 计入 100% 高度,不撑破 root。
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    padding: '24px',
    maxWidth: '640px',
    margin: '0 auto',
  },

  header: { textAlign: 'center', marginBottom: '24px', width: '100%' },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 18,
  },
  logoBox: {
    width: 46,
    height: 46,
    borderRadius: 13,
    background: 'var(--soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustBadge: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink-700)',
    background: 'var(--soft)',
    border: '1px solid var(--sand-300)',
    borderRadius: 999,
    padding: '5px 14px',
    letterSpacing: '0.02em',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: 900,
    lineHeight: 1.25,
    letterSpacing: '-.01em',
    margin: '0 0 12px',
    color: 'var(--ink-900)',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'var(--font-sans)',
    fontSize: '15px',
    lineHeight: 1.7,
    color: 'var(--fg2)',
    margin: 0,
    maxWidth: 480,
    marginLeft: 'auto',
    marginRight: 'auto',
  },

  section: { width: '100%', marginTop: 8 },
  sectionLabel: {
    width: '100%',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--fg3)',
    letterSpacing: '0.02em',
    margin: '16px 0 12px',
  },
  sectionSub: { marginLeft: 8, fontWeight: 500, color: 'var(--fg3)', fontSize: 12 },

  card: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '16px 16px 14px',
    background: 'var(--surface)',
    border: '1px solid var(--sand-300)',
    borderRadius: 16,
    boxShadow: 'var(--shadow-xs)',
  },
  privacyNote: {
    fontSize: 12,
    lineHeight: 1.7,
    color: 'var(--fg3)',
    margin: '12px 0 0',
  },

  questionBlock: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--sand-300)',
    borderRadius: 14,
    marginBottom: 10,
    boxShadow: 'var(--shadow-xs)',
  },
  questionLabel: { fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', lineHeight: 1.5 },
  questionSub: { marginLeft: 8, fontSize: 12, fontWeight: 500, color: 'var(--fg3)' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    padding: '8px 14px',
    borderRadius: 999,
    border: '1.5px solid var(--sand-300)',
    background: 'var(--surface)',
    color: 'var(--fg2)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 160ms ease',
  },
  chipActive: {
    borderColor: 'var(--ui-primary)',
    background: 'var(--soft)',
    color: 'var(--ink-900)',
    fontWeight: 700,
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 14px',
    marginBottom: 10,
    borderRadius: 12,
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--fg1)',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'var(--font-sans)',
  },

  diagnoseBox: { width: '100%', marginTop: 20 },
  primaryBtn: {
    width: '100%',
    padding: '13px 16px',
    borderRadius: 12,
    border: 'none',
    background: 'var(--ui-primary)',
    color: 'var(--ui-primary-fg)',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  formHint: {
    fontSize: 12,
    color: 'var(--fg3)',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 1.6,
  },
  errorText: {
    fontSize: 13,
    color: 'var(--danger, #d9534f)',
    marginBottom: 8,
    lineHeight: 1.5,
  },

  previewSection: { width: '100%', marginTop: 24, scrollMarginTop: 16 },
  summaryLine: {
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--ink-900)',
    marginBottom: 14,
  },
  gapList: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
  gapCard: {
    padding: '16px 18px',
    background: 'var(--surface)',
    border: '1px solid var(--sand-300)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-xs)',
  },
  gapHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  urgencyBadge: {
    fontSize: 12,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
    border: '1px solid',
    flexShrink: 0,
  },
  gapTitle: { fontSize: 15, fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1.4 },
  gapWhy: { fontSize: 14, lineHeight: 1.7, color: 'var(--fg2)' },
  gapCoverage: { marginTop: 8, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-700)', fontWeight: 600 },
  subsidyPill: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 1.6,
    color: '#067647',
    background: '#ecfdf3',
    border: '1px solid #abefc6',
    borderRadius: 10,
    padding: '8px 12px',
  },
  gapNote: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 1.6,
    color: 'var(--ink-700)',
    background: 'var(--soft)',
    borderRadius: 10,
    padding: '8px 12px',
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 1.7,
    color: 'var(--fg3)',
    margin: '16px 0 0',
    padding: '12px 14px',
    background: 'var(--surface-soft)',
    border: '1px solid var(--border)',
    borderRadius: 12,
  },

  ctaSection: {
    width: '100%',
    marginTop: 24,
    paddingTop: 22,
    borderTop: '1px solid var(--border)',
  },
  successBox: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '24px 20px',
    background: 'var(--soft)',
    border: '1px solid var(--sand-300)',
    borderRadius: 16,
    textAlign: 'center',
  },
  successTitle: { fontSize: 17, fontWeight: 800, color: 'var(--ink-900)', marginBottom: 8 },
  successSub: { fontSize: 14, lineHeight: 1.7, color: 'var(--fg2)' },
};

export default StartupProfileCollector;
