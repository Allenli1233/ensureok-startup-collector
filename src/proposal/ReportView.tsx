/**
 * ReportView —— 保障体检报告主页(替代 ProposalView 成为 ready 落地视图)。
 *
 * 组成:
 *   - Treemap 总览(大方块=紧迫分层,小方块=险种;面积∝权重;暖黑配色 + 错峰进场/hover/点击 zoom)。
 *   - 总览 chat(scope='report',浮层);次要 tab:对比表;导出 PDF(打印结构化附录,客户/顾问双版)。
 *   - 点小方块 → BlockDetail(该险种详情 + 该险种 chat scope=lineId)。
 *   - 可选中性联系入口(选填,填了才留资);可选调参重生成。
 *   - 窄屏(<720px)treemap 换加权竖排堆叠。
 *
 * 红线:方块 / chat 绝不显示保费或成交数字(仅参考区间标签);合规免责固定可见。
 * 零新依赖:纯 CSS transform/transition 动画,尊重 prefers-reduced-motion。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './report.css';
import { apiUrl } from '../api/config';
import { track } from '../api/tracker';
import type { GapUrgency, Proposal, ProposalItem, ProposalRequest } from './types';
import { layoutReport, type LayoutMode, type PlacedBlock, type Rect } from './treemapLayout';
import {
  URGENCY_ORDER,
  blockColor,
  buildReportGroups,
  itemWeight,
  TIER_LABEL,
  URGENCY_META,
} from './reportModel';
import { CompareTable, LineDetailBody, PortfolioBlock } from './reportShared';
import { BlockDetail } from './BlockDetail';
import { ReportChat } from './ReportChat';

const STACK_BREAKPOINT = 720;
const GAP = 10;

type Variant = 'client' | 'advisor';

export function ReportView({
  proposal,
  taskId,
  onRegenerate,
  currentProfile,
  previousLineNames,
}: {
  proposal: Proposal;
  /** 报告解读 chat 用(POST /agent/proposals/:id/chat);mock 模式为占位 id */
  taskId?: string;
  onRegenerate?: (profile: ProposalRequest['profile']) => void;
  currentProfile?: ProposalRequest['profile'];
  previousLineNames?: string[];
}): React.ReactElement {
  const [view, setView] = useState<'map' | 'table'>('map');
  const [variant, setVariant] = useState<Variant>('client');
  const [onlyMandatory, setOnlyMandatory] = useState(false);
  const [hideDegraded, setHideDegraded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ xPct: number; yPct: number } | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [width, setWidth] = useState(0);

  const roRef = useRef<ResizeObserver | null>(null);
  // 回调 ref:测量节点每次挂载/卸载都重挂 ResizeObserver(视图切换 / 空→有 时也能重新测宽,
  // 否则 treemap↔竖排的响应式切换会在重挂后静默失效)
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const advisor = variant === 'advisor';

  const itemById = useMemo(() => {
    const m = new Map<string, ProposalItem>();
    for (const it of proposal.items) m.set(it.lineId, it);
    return m;
  }, [proposal.items]);

  // 进场:mount 后下一帧触发错峰展开
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const mode: LayoutMode = width > 0 && width < STACK_BREAKPOINT ? 'stack' : 'treemap';

  // 布局 + 进场延迟表
  const layout = useMemo(() => {
    const groups = buildReportGroups(proposal.items);
    if (groups.length === 0 || width <= 0) {
      return { blocks: [] as PlacedBlock[], groups: [] as { key: string; label: string; rect: Rect }[], height: 0 };
    }
    const containerH =
      mode === 'stack'
        ? Math.max(proposal.items.length, 1) * 92
        : clamp(width * 0.58, 380, 560);
    const res = layoutReport(groups, { x: 0, y: 0, w: width, h: containerH }, mode, {
      gap: GAP,
      minBlock: mode === 'stack' ? 58 : 66,
    });
    // 竖排:实际高度由块堆叠撑开
    let height = containerH;
    if (mode === 'stack') {
      height = res.blocks.reduce((mx, b) => Math.max(mx, b.rect.y + b.rect.h), 0) + GAP;
    }
    return { blocks: res.blocks, groups: res.groups, height };
  }, [proposal.items, width, mode]);

  // 进场错峰:权重越大越先出(§3.5)
  const delayById = useMemo(() => {
    const ranked = proposal.items
      .map((it) => ({ id: it.lineId, w: itemWeight(it) }))
      .sort((a, b) => b.w - a.w);
    const m = new Map<string, number>();
    ranked.forEach((r, i) => m.set(r.id, Math.min(i * 42, 520)));
    return m;
  }, [proposal.items]);

  const degradedCount = proposal.items.filter((i) => i.degraded).length;

  const diff = useMemo(() => {
    if (!previousLineNames || previousLineNames.length === 0) return null;
    const now = proposal.items.map((i) => i.lineName);
    const added = now.filter((n) => !previousLineNames.includes(n));
    const removed = previousLineNames.filter((n) => !now.includes(n));
    if (added.length === 0 && removed.length === 0) return null;
    return { added, removed };
  }, [previousLineNames, proposal.items]);

  const selectedItem = selected ? itemById.get(selected) ?? null : null;
  const isEmpty = proposal.items.length === 0;

  const openBlock = (lineId: string, e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    setOrigin({ xPct: ((r.left + r.width / 2) / vw) * 100, yPct: ((r.top + r.height / 2) / vh) * 100 });
    setSelected(lineId);
  };

  return (
    <div className="proposal-print" style={styles.root}>
      {/* ═══ 屏幕视图 ═══ */}
      <div className="rv-screen no-print" style={styles.screen}>
        <header style={styles.head}>
          <div style={styles.docName}>{proposal.meta.documentName}</div>
          <h1 style={styles.company}>{proposal.meta.company}</h1>
          <p style={styles.summary}>{proposal.clientSummary}</p>
        </header>

        {!advisor && (
          <div style={styles.complianceLine}>已通过合规与条款核对 · 生成过程细节见「顾问版」。</div>
        )}

        {degradedCount > 0 && (
          <div style={styles.degradedNote}>
            其中 <strong>{degradedCount}</strong> 项建议由持牌顾问补充 / 待核,已在对应方块角标标注——如实呈现,便于你与顾问重点确认。
          </div>
        )}
        {diff && (
          <div style={styles.diffNote}>
            已按新画像重新生成。
            {diff.added.length > 0 && <>新增:{diff.added.join('、')}。</>}
            {diff.removed.length > 0 && <>移除:{diff.removed.join('、')}。</>}
          </div>
        )}

        {/* 工具条 */}
        <div style={styles.toolbar}>
          <SegToggle
            label="视图"
            value={view}
            options={[
              { value: 'map', label: '总览图' },
              { value: 'table', label: '对比表' },
            ]}
            onChange={(v) => setView(v as 'map' | 'table')}
          />
          <SegToggle
            label="版本"
            value={variant}
            options={[
              { value: 'client', label: '客户版' },
              { value: 'advisor', label: '顾问版' },
            ]}
            onChange={(v) => setVariant(v as Variant)}
          />
          {view === 'table' && (
            <div style={styles.filterChips}>
              <FilterChip active={onlyMandatory} onClick={() => setOnlyMandatory((v) => !v)}>
                仅强制
              </FilterChip>
              <FilterChip active={hideDegraded} onClick={() => setHideDegraded((v) => !v)}>
                隐藏降级项
              </FilterChip>
            </div>
          )}
          <div style={{ flex: 1 }} />
          {onRegenerate && (
            <button type="button" style={styles.ghostBtn} onClick={() => setDrawerOpen(true)}>
              调整画像重新生成
            </button>
          )}
          <button type="button" style={styles.printBtn} onClick={() => window.print()}>
            导出 PDF / 打印
          </button>
        </div>

        {/* 主体 */}
        {view === 'table' ? (
          <div style={styles.tablePanel}>
            <CompareTable
              items={proposal.items}
              portfolio={proposal.portfolio}
              advisor={advisor}
              onlyMandatory={onlyMandatory}
              hideDegraded={hideDegraded}
              onPick={(id) => setSelected(id)}
            />
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <Legend />
            <div
              ref={measureRef}
              className="rv-canvas"
              data-entered={entered ? 'true' : 'false'}
              style={{ height: layout.height || 420 }}
            >
              {layout.groups.map((g) => (
                <span
                  key={g.key}
                  className="rv-group-label"
                  style={{ left: Math.round(g.rect.x) + 8, top: Math.round(g.rect.y) + 8 }}
                >
                  {g.label} · {countIn(proposal.items, g.key as GapUrgency)}
                </span>
              ))}
              {layout.blocks.map((b) => {
                const item = itemById.get(b.id);
                if (!item) return null;
                const small = b.rect.w < 118 || b.rect.h < 88;
                const c = blockColor(item.urgency, item.qualityScore);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`rv-block${small ? ' rv-block-sm' : ''}`}
                    style={{
                      left: Math.round(b.rect.x),
                      top: Math.round(b.rect.y),
                      width: Math.round(b.rect.w),
                      height: Math.round(b.rect.h),
                      background: c.fill,
                      boxShadow: `0 6px 20px ${c.glow}`,
                      transitionDelay: `${delayById.get(b.id) ?? 0}ms`,
                    }}
                    onClick={(e) => openBlock(b.id, e)}
                    aria-label={`${item.lineName} · ${URGENCY_META[item.urgency].label}${
                      item.degraded ? ' · 待核' : ''
                    },查看详情`}
                    title={item.lineName}
                  >
                    {item.degraded && <span className="rv-block-flag">待核</span>}
                    <span className="rv-block-name">{item.lineName}</span>
                    {!small && (
                      <span className="rv-block-meta">
                        <span className="rv-block-tier">{TIER_LABEL[item.tier]}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p style={styles.canvasHint}>点方块查看该险种的保障方向、条款与参考区间。面积越大 = 越紧迫、越优先关注。</p>
          </>
        )}

        {proposal.portfolio && (
          <div style={{ marginTop: 16 }}>
            <PortfolioBlock portfolio={proposal.portfolio} />
          </div>
        )}

        {/* 可选中性联系入口(选填,不留资也能看报告) */}
        <ReportLeadCapture proposal={proposal} />

        <p style={styles.disclaimer}>{proposal.disclaimer}</p>
        <div style={styles.foot}>
          生成引擎 {proposal.meta.engine} · 模型 {proposal.meta.llmModel} · {proposal.meta.generatedAt.slice(0, 10)}
        </div>
      </div>

      {/* ═══ 打印视图(结构化附录,屏幕隐藏) ═══ */}
      <PrintAppendix proposal={proposal} advisor={advisor} />

      {/* ═══ 浮层:总览 chat ═══ */}
      <div className="no-print">
        {chatOpen ? (
          <div className="rv-chat-pop" style={styles.chatDock}>
            <button type="button" style={styles.chatClose} onClick={() => setChatOpen(false)} aria-label="收起报告解读">
              收起 ✕
            </button>
            <ReportChat
              taskId={taskId}
              scope="report"
              title="报告解读员"
              intro="就整份报告提问:哪些最紧迫、各险种为什么被列入、组合怎么搭。只解读报告、不做投保建议,答案附合规免责。"
              suggestions={['哪几项最该先处理?', '这些险种之间有重叠吗?']}
            />
          </div>
        ) : (
          <button type="button" style={styles.chatFab} onClick={() => setChatOpen(true)} aria-label="打开报告解读">
            <span style={styles.chatFabDot} />
            解读这份报告
          </button>
        )}
      </div>

      {/* ═══ 下钻详情 ═══ */}
      {selectedItem && (
        <BlockDetail
          item={selectedItem}
          advisor={advisor}
          taskId={taskId}
          origin={origin}
          onClose={() => setSelected(null)}
        />
      )}

      {/* ═══ 调参重生成抽屉 ═══ */}
      {drawerOpen && onRegenerate && (
        <RegenerateDrawer
          currentProfile={currentProfile}
          onClose={() => setDrawerOpen(false)}
          onSubmit={(profile) => {
            setDrawerOpen(false);
            onRegenerate(profile);
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 图例 / 空态
// ────────────────────────────────────────────────────────────────────────────

function Legend(): React.ReactElement {
  return (
    <div style={styles.legend} aria-hidden="true">
      {URGENCY_ORDER.map((u) => (
        <span key={u} style={styles.legendItem}>
          <span style={{ ...styles.legendSwatch, background: blockColor(u).fill }} />
          {URGENCY_META[u].label}
        </span>
      ))}
      <span style={styles.legendNote}>面积 ∝ 紧迫度 × 层级</span>
    </div>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div style={styles.empty}>
      <div style={styles.emptyTitle}>暂未命中高优先敞口</div>
      <p style={styles.emptyP}>
        按你提交的画像,这次没有识别到需要立刻处理的保障缺口。仍建议由持牌顾问做一次完整体检,确认没有遗漏。
      </p>
    </div>
  );
}

function countIn(items: ProposalItem[], u: GapUrgency): number {
  return items.filter((i) => i.urgency === u).length;
}

// ────────────────────────────────────────────────────────────────────────────
// 打印附录(暖纸,信息完整;客户/顾问双版由 variant 决定)
// ────────────────────────────────────────────────────────────────────────────

function PrintAppendix({ proposal, advisor }: { proposal: Proposal; advisor: boolean }): React.ReactElement {
  const ordered = proposal.items
    .slice()
    .sort((a, b) => URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency));
  return (
    <div className="rv-print">
      <div style={styles.docName}>{proposal.meta.documentName}</div>
      <h1 style={{ ...styles.company, marginTop: 4 }}>{proposal.meta.company}</h1>
      <p style={styles.summary}>{proposal.clientSummary}</p>
      {!advisor && <div style={styles.complianceLine}>已通过合规与条款核对 · 生成过程细节见「顾问版」。</div>}

      {proposal.portfolio && (
        <div style={{ marginTop: 12 }}>
          <PortfolioBlock portfolio={proposal.portfolio} />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <CompareTable
          items={proposal.items}
          portfolio={proposal.portfolio}
          advisor={advisor}
          onlyMandatory={false}
          hideDegraded={false}
        />
      </div>

      <div style={{ marginTop: 8 }}>
        {ordered.map((item) => {
          const u = URGENCY_META[item.urgency];
          return (
            <div key={item.lineId} className="rv-print-line" style={styles.printLine}>
              <div style={styles.printLineHead}>
                <span style={{ ...styles.pill, color: u.color, background: u.bg }}>{u.label}</span>
                <span style={styles.printLineName}>{item.lineName}</span>
                <span style={styles.printLineTier}>{TIER_LABEL[item.tier]}</span>
              </div>
              <LineDetailBody item={item} advisor={advisor} />
            </div>
          );
        })}
      </div>

      <p style={styles.disclaimer}>{proposal.disclaimer}</p>
      <div style={styles.foot}>
        生成引擎 {proposal.meta.engine} · 模型 {proposal.meta.llmModel} · {proposal.meta.generatedAt.slice(0, 10)}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 可选中性联系入口(D3-B):选填,填了才 POST /api/startup-leads
// ────────────────────────────────────────────────────────────────────────────

function ReportLeadCapture({ proposal }: { proposal: Proposal }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = contact.trim();
    if (!c) {
      setMsg('留个手机号或微信即可(选填,不填也能继续看报告)。');
      return;
    }
    setState('submitting');
    setMsg('');
    const contactType = /^\d[\d\s-]{6,}$/.test(c) ? 'phone' : 'wechat';
    const source = (() => {
      try {
        return new URLSearchParams(window.location.search).get('src') || undefined;
      } catch {
        return undefined;
      }
    })();
    const body = {
      selectedEvents: proposal.items.map((i) => i.lineName),
      name: name.trim() || undefined,
      company: proposal.meta.company,
      contact: c,
      contactType,
      profile: { version: 'report_v1', company: proposal.meta.company },
      ...(source ? { source } : {}),
    };
    try {
      const res = await fetch(apiUrl('/api/startup-leads'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setState('success');
        track('startup_profile.lead_submitted', { contactType, lines: proposal.items.map((i) => i.lineName) });
      } else {
        setState('error');
        setMsg(data?.error || '提交失败,请稍后再试。');
      }
    } catch {
      setState('error');
      setMsg('网络异常,请检查连接后重试。');
    }
  };

  if (state === 'success') {
    return (
      <div className="no-print" style={styles.leadDone}>
        已收到,持牌经纪会在合适的时间跟进。你可以继续浏览这份报告。
      </div>
    );
  }

  return (
    <div className="no-print" style={styles.leadWrap}>
      {!open ? (
        <button type="button" style={styles.leadToggle} onClick={() => setOpen(true)}>
          需要持牌经纪跟进?留个联系方式(选填)
        </button>
      ) : (
        <form style={styles.leadForm} onSubmit={submit}>
          <div style={styles.leadHint}>选填。留下后由持牌经纪在合适时间联系你解读报告;不填也能继续看。</div>
          <div style={styles.leadRow}>
            <input
              style={styles.leadInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="称呼(选填)"
              aria-label="称呼"
              autoComplete="name"
            />
            <input
              style={styles.leadInput}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="手机号或微信"
              aria-label="手机号或微信"
              inputMode="tel"
            />
            <button type="submit" style={styles.leadSubmit} disabled={state === 'submitting'}>
              {state === 'submitting' ? '提交中…' : '提交'}
            </button>
          </div>
          {msg && (
            <div style={styles.leadMsg} role="alert">
              {msg}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 调参重生成抽屉
// ────────────────────────────────────────────────────────────────────────────

function RegenerateDrawer({
  currentProfile,
  onClose,
  onSubmit,
}: {
  currentProfile?: ProposalRequest['profile'];
  onClose: () => void;
  onSubmit: (profile: ProposalRequest['profile']) => void;
}): React.ReactElement {
  const [industry, setIndustry] = useState(currentProfile?.industry ?? '');
  const [headcount, setHeadcount] = useState(currentProfile?.headcount ?? '');
  const [funding, setFunding] = useState(currentProfile?.funding ?? '');
  const [hasPatent, setHasPatent] = useState(!!currentProfile?.hasPatent);
  const [overseas, setOverseas] = useState((currentProfile?.overseasCountries ?? []).join('、'));
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // 进场把焦点移入抽屉,卸载归还焦点(仅挂载一次)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const countries = overseas
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSubmit({
      industry: industry.trim() || undefined,
      headcount: headcount.trim() || undefined,
      funding: funding.trim() || undefined,
      hasPatent,
      overseasCountries: countries.length ? countries : undefined,
    });
  };

  return (
    <div className="no-print" style={styles.drawerMask} onClick={onClose} role="presentation">
      <div ref={drawerRef} tabIndex={-1} style={styles.drawer} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="调整画像重新生成">
        <div style={styles.drawerTitle}>调整画像 · 重新生成</div>
        <div style={styles.drawerHint}>改动画像后走与首次一致的完整重生成流程;完成后自动对比新增/移除的险种。</div>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>行业</span>
          <input style={styles.fieldInput} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="如 SaaS / 智能硬件" />
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>规模</span>
          <input style={styles.fieldInput} value={headcount} onChange={(e) => setHeadcount(e.target.value)} placeholder="如 11-50 人" />
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>融资阶段</span>
          <input style={styles.fieldInput} value={funding} onChange={(e) => setFunding(e.target.value)} placeholder="如 天使轮 / A 轮" />
        </label>
        <label style={{ ...styles.field, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={hasPatent} onChange={(e) => setHasPatent(e.target.checked)} />
          <span style={styles.fieldLabel}>已有授权专利</span>
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>出海国家/地区(顿号或逗号分隔)</span>
          <input style={styles.fieldInput} value={overseas} onChange={(e) => setOverseas(e.target.value)} placeholder="如 美国、欧盟" />
        </label>
        <div style={styles.drawerActions}>
          <button type="button" style={styles.drawerCancel} onClick={onClose}>
            取消
          </button>
          <button type="button" style={styles.drawerSubmit} onClick={submit}>
            按新画像重新生成
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 小控件
// ────────────────────────────────────────────────────────────────────────────

function SegToggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div style={styles.seg}>
      <span style={styles.segLabel}>{label}</span>
      <div style={styles.segGroup}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{ ...styles.filterChip, ...(active ? styles.filterChipActive : {}) }}
    >
      {children}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ────────────────────────────────────────────────────────────────────────────
// 样式
// ────────────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100%', marginTop: 24 },
  // 报告屏幕视图打破 640 窄栏,居中占更宽舞台(treemap 需要宽度)
  screen: {
    width: 'min(1080px, calc(100vw - 32px))',
    position: 'relative',
    left: '50%',
    transform: 'translateX(-50%)',
    boxSizing: 'border-box',
  },

  head: { marginBottom: 14, textAlign: 'center' },
  docName: { fontSize: 12.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--fg3)', textTransform: 'uppercase' },
  company: {
    fontFamily: 'var(--font-display)',
    fontSize: 30,
    fontWeight: 900,
    lineHeight: 1.2,
    letterSpacing: '-0.015em',
    color: 'var(--ink-900)',
    margin: '6px 0 0',
    textWrap: 'balance',
  } as React.CSSProperties,
  summary: {
    fontSize: 14,
    lineHeight: 1.7,
    color: 'var(--fg2)',
    margin: '10px auto 0',
    maxWidth: 620,
  },
  complianceLine: { marginTop: 10, fontSize: 12.5, color: 'var(--fg3)', textAlign: 'center' },

  degradedNote: {
    marginTop: 14,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#b54708',
    background: '#fffaeb',
    border: '1px solid #fedf89',
    borderRadius: 12,
  },
  diffNote: {
    marginTop: 14,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#067647',
    background: '#ecfdf3',
    border: '1px solid #abefc6',
    borderRadius: 12,
  },

  toolbar: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '16px 0 12px' },
  seg: { display: 'flex', alignItems: 'center', gap: 6 },
  segLabel: { fontSize: 12, color: 'var(--fg3)' },
  segGroup: { display: 'inline-flex', border: '1px solid var(--border-strong)', borderRadius: 9, overflow: 'hidden' },
  segBtn: {
    padding: '6px 13px',
    fontSize: 12.5,
    fontWeight: 600,
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-700)',
    cursor: 'pointer',
    transition: 'background 160ms ease, color 160ms ease',
  },
  segBtnActive: { background: 'var(--ui-primary)', color: 'var(--ui-primary-fg)' },
  filterChips: { display: 'flex', gap: 6 },
  filterChip: {
    padding: '5px 11px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 999,
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--ink-700)',
    cursor: 'pointer',
  },
  filterChipActive: { borderColor: 'var(--ui-primary)', background: 'var(--soft)' },
  ghostBtn: {
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--ink-700)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  printBtn: {
    padding: '8px 16px',
    borderRadius: 10,
    border: '1.5px solid var(--ui-primary)',
    background: 'var(--surface)',
    color: 'var(--ink-900)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },

  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    margin: '4px 0 10px',
    fontSize: 12,
    color: 'var(--fg2)',
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
  legendSwatch: { width: 12, height: 12, borderRadius: 4, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)' },
  legendNote: { marginLeft: 'auto', color: 'var(--fg3)' },

  canvasHint: { margin: '10px 0 0', fontSize: 12, color: 'var(--fg3)', textAlign: 'center' },

  tablePanel: {
    marginTop: 4,
    padding: '6px 14px 14px',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 14,
  },

  empty: {
    marginTop: 8,
    padding: '32px 24px',
    textAlign: 'center',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: 800, color: 'var(--ink-900)' },
  emptyP: { fontSize: 14, lineHeight: 1.75, color: 'var(--fg2)', margin: '10px auto 0', maxWidth: 460 },

  leadWrap: { marginTop: 18 },
  leadToggle: {
    width: '100%',
    padding: '11px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink-700)',
    background: 'var(--surface-soft)',
    border: '1px dashed var(--border-strong)',
    borderRadius: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  leadForm: {
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 12,
  },
  leadHint: { fontSize: 12, lineHeight: 1.6, color: 'var(--fg3)', marginBottom: 10 },
  leadRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  leadInput: {
    flex: '1 1 140px',
    minWidth: 0,
    padding: '9px 12px',
    fontSize: 13,
    color: 'var(--fg1)',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'var(--font-sans)',
  },
  leadSubmit: {
    flexShrink: 0,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--ui-primary-fg)',
    background: 'var(--ui-primary)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  },
  leadMsg: { marginTop: 8, fontSize: 12.5, color: 'var(--danger)' },
  leadDone: {
    marginTop: 18,
    padding: '12px 14px',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#067647',
    background: '#ecfdf3',
    border: '1px solid #abefc6',
    borderRadius: 12,
  },

  disclaimer: {
    fontSize: 11.5,
    lineHeight: 1.75,
    color: 'var(--fg3)',
    margin: '18px 0 0',
    padding: '12px 14px',
    background: 'var(--surface-soft)',
    border: '1px solid var(--border)',
    borderRadius: 12,
  },
  foot: { fontSize: 11, color: 'var(--fg3)', marginTop: 10, textAlign: 'center' },

  pill: { fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' },
  printLine: {
    marginTop: 12,
    padding: '12px 0 4px',
    borderTop: '1px solid var(--border)',
  },
  printLineHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  printLineName: { fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' },
  printLineTier: { fontSize: 12, fontWeight: 700, color: 'var(--fg3)' },

  // 浮层 chat
  chatFab: {
    position: 'fixed',
    right: 20,
    bottom: 20,
    zIndex: 55,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 18px',
    fontSize: 13.5,
    fontWeight: 700,
    color: 'var(--ui-primary-fg)',
    background: 'var(--ui-primary)',
    border: 'none',
    borderRadius: 999,
    boxShadow: '0 10px 30px rgba(30, 18, 10, 0.34)',
    cursor: 'pointer',
  },
  chatFabDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: '#B85C3C',
    boxShadow: '0 0 0 3px rgba(184,92,60,0.28)',
  },
  chatDock: {
    position: 'fixed',
    right: 20,
    bottom: 20,
    zIndex: 55,
    width: 'min(390px, calc(100vw - 32px))',
    maxHeight: 'min(560px, calc(100vh - 40px))',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 18px 50px rgba(30, 18, 10, 0.32)',
    borderRadius: 16,
    overflow: 'hidden',
    background: 'var(--surface)',
  },
  chatClose: {
    alignSelf: 'flex-end',
    margin: '8px 10px 0 0',
    padding: '4px 10px',
    fontSize: 11.5,
    fontWeight: 600,
    color: 'var(--fg3)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },

  // 抽屉
  drawerMask: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(24,20,17,0.4)',
    display: 'flex',
    justifyContent: 'flex-end',
    zIndex: 60,
  },
  drawer: {
    width: 'min(420px, 92vw)',
    height: '100%',
    overflowY: 'auto',
    background: 'var(--surface)',
    padding: '20px 22px',
    boxShadow: '-8px 0 30px rgba(30,18,10,0.18)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  drawerTitle: { fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' },
  drawerHint: { fontSize: 12, lineHeight: 1.6, color: 'var(--fg3)' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700)' },
  fieldInput: {
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid var(--border-strong)',
    borderRadius: 8,
    background: 'var(--surface)',
    color: 'var(--ink-900)',
    fontFamily: 'var(--font-sans)',
  },
  drawerActions: { display: 'flex', gap: 10, marginTop: 8 },
  drawerCancel: {
    flex: 1,
    padding: '9px 14px',
    borderRadius: 10,
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--ink-700)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  drawerSubmit: {
    flex: 2,
    padding: '9px 14px',
    borderRadius: 10,
    border: '1.5px solid var(--ui-primary)',
    background: 'var(--ui-primary)',
    color: 'var(--ui-primary-fg)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
};

export default ReportView;
