/**
 * 保障体检报告 —— 独立的全屏「体检舱」页面(进入即换页,电影级过渡)。
 *
 * 设计取向(design-taste-frontend + emil-design-eng):
 *   - MOTION_INTENSITY 8:进入以自定义 ease-out 幕帘展开;方块 spring 错峰进场;
 *     点方块 → 共享元素(layoutId)放大成详情(Motion 形变,非淡入淡出)。
 *   - 暖调深色「舱」(ink-900),方块暖→冷阶(白字对比已核 ≥4.5:1);克制留白 + 微光晕。
 *   - 全部动画尊重 prefers-reduced-motion:退化为不位移的透明度过渡。
 * 布局用零依赖 treemapLayout;不出现任何保费数字;合规免责固定可见。
 */
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blockColor, buildReportGroups, itemWeight } from './reportModel';
import { layoutReport, type LayoutMode } from './treemapLayout';
import type { Proposal, ProposalItem } from './types';
import { BlockDetailBody } from './BlockDetail';
import { ReportChatPanel } from './ReportChat';
import './report.css';

const EASE_OUT = [0.22, 1, 0.36, 1] as const; // 强 ease-out(emil:内建太弱)
const GAP = 8;
const STACK_BP = 640;

export interface ReportProposalState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  proposal?: Proposal;
  taskId?: string;
  error?: string;
}

export function ReportPage({
  state,
  onClose,
  onRetry,
}: {
  state: ReportProposalState;
  onClose: () => void;
  onRetry: () => void;
}): React.ReactElement {
  const reduce = useReducedMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // Esc 关闭(有详情先关详情);锁背景滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (chatOpen) setChatOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selected, chatOpen, onClose]);

  return (
    <motion.div
      className="rp-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.15 : 0.32, ease: 'linear' }}
      role="dialog"
      aria-modal="true"
      aria-label="保障体检报告"
    >
      <motion.div
        className="rp-chamber"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.985, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.99, filter: 'blur(6px)' }}
        transition={{ duration: reduce ? 0.15 : 0.62, ease: EASE_OUT }}
      >
        <Header company={state.proposal?.meta.company} onClose={onClose} />

        {state.status === 'loading' || state.status === 'idle' ? (
          <ChamberLoading reduce={!!reduce} />
        ) : state.status === 'error' ? (
          <ErrorState message={state.error} onRetry={onRetry} />
        ) : state.proposal ? (
          <ReportBody
            proposal={state.proposal}
            taskId={state.taskId}
            reduce={!!reduce}
            selected={selected}
            onSelect={setSelected}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((v) => !v)}
          />
        ) : null}
      </motion.div>
    </motion.div>
  );
}

function Header({ company, onClose }: { company?: string; onClose: () => void }): React.ReactElement {
  return (
    <header className="rp-header">
      <div className="rp-header-l">
        <span className="rp-kicker">保障体检报告</span>
        {company ? <span className="rp-company">{company}</span> : null}
      </div>
      <button type="button" className="rp-close" onClick={onClose} aria-label="返回">
        <span aria-hidden="true">返回</span>
      </button>
    </header>
  );
}

function ChamberLoading({ reduce }: { reduce: boolean }): React.ReactElement {
  return (
    <div className="rp-loading">
      <div className={`rp-scan${reduce ? ' rp-scan-static' : ''}`} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="rp-loading-title">正在组装你的保障体检报告</p>
      <p className="rp-loading-sub">结合产品库与条款检索、逐险种自检合规与忠实度,请稍候。</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }): React.ReactElement {
  return (
    <div className="rp-loading">
      <p className="rp-loading-title">报告生成中断</p>
      <p className="rp-loading-sub">{message ? message.slice(0, 160) : '请稍后重试。'}</p>
      <button type="button" className="rp-retry" onClick={onRetry}>
        重新生成
      </button>
    </div>
  );
}

// ─────────────────────────── 报告主体(treemap + 详情 + chat) ───────────────────────────

interface Placed {
  item: ProposalItem;
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
}

function ReportBody({
  proposal,
  taskId,
  reduce,
  selected,
  onSelect,
  chatOpen,
  onToggleChat,
}: {
  proposal: Proposal;
  taskId?: string;
  reduce: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}): React.ReactElement {
  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const itemById = useMemo(() => new Map(proposal.items.map((it) => [it.lineId, it])), [proposal.items]);

  const { placed, groups, height } = useMemo(() => {
    const grps = buildReportGroups(proposal.items);
    if (grps.length === 0 || width <= 0) return { placed: [] as Placed[], groups: [] as { key: string; label: string; x: number; y: number }[], height: 0 };
    const mode: LayoutMode = width < STACK_BP ? 'stack' : 'treemap';
    const layoutGroups = grps.map((g) => ({ key: g.key, label: g.label, nodes: g.nodes }));
    const containerH = mode === 'stack' ? Math.max(proposal.items.length, 1) * 88 : clamp(width * 0.52, 320, 520);
    const res = layoutReport(layoutGroups, { x: 0, y: 0, w: width, h: containerH }, mode, { gap: GAP, minBlock: mode === 'stack' ? 60 : 74 });
    // 权重降序 → 大块先进场(错峰);建立 id→delay
    const order = [...proposal.items].map((it) => it.lineId).sort((a, b) => itemWeight(itemById.get(b) as ProposalItem) - itemWeight(itemById.get(a) as ProposalItem));
    const delayOf = new Map(order.map((id, i) => [id, i]));
    const placedArr: Placed[] = res.blocks
      .map((b) => {
        const item = itemById.get(b.id);
        if (!item) return null;
        return { item, x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h, delay: (delayOf.get(b.id) ?? 0) * 0.05 };
      })
      .filter((x): x is Placed => x !== null);
    const h = mode === 'stack' ? res.blocks.reduce((mx, b) => Math.max(mx, b.rect.y + b.rect.h), 0) + GAP : containerH;
    return { placed: placedArr, groups: res.groups.map((g) => ({ key: g.key, label: g.label, x: g.rect.x, y: g.rect.y })), height: h };
  }, [proposal.items, width, itemById]);

  const selectedItem = selected ? itemById.get(selected) : undefined;

  if (proposal.items.length === 0) {
    return (
      <div className="rp-body">
        <div className="rp-summary">{proposal.clientSummary}</div>
        <div className="rp-loading">
          <p className="rp-loading-title">按你提交的画像,暂未识别到需要展示的险种</p>
          <p className="rp-loading-sub">这通常意味着高优先敞口不突出;仍建议由持牌经纪结合贵司情况做一次完整评估。</p>
        </div>
        <p className="rp-disclaimer">{proposal.disclaimer}</p>
      </div>
    );
  }

  return (
    <div className="rp-body">
      <div className="rp-summary">{proposal.clientSummary}</div>

      <LayoutGroup>
        <div className="rp-stage" ref={stageRef} style={{ height: height || 360 }}>
          {groups.map((g) => (
            <span key={g.key} className="rp-grouplabel" style={{ left: Math.round(g.x) + 10, top: Math.round(g.y) + 10 }}>
              {g.label} · {countIn(proposal.items, g.key)}
            </span>
          ))}
          {placed.map((p) => {
            if (selected === p.item.lineId) return <span key={p.item.lineId} style={{ position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h }} aria-hidden="true" />;
            const small = p.w < 132 || p.h < 96;
            const c = blockColor(p.item.urgency, p.item.qualityScore);
            return (
              <motion.button
                key={p.item.lineId}
                layoutId={`rp-block-${p.item.lineId}`}
                type="button"
                className={`rp-block${small ? ' rp-block-sm' : ''}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h, background: c.fill, boxShadow: `0 8px 26px ${c.glow}` }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={reduce ? { duration: 0.2, delay: p.delay } : { type: 'spring', duration: 0.62, bounce: 0.16, delay: p.delay }}
                whileTap={reduce ? undefined : { scale: 0.985 }}
                onClick={() => onSelect(p.item.lineId)}
                aria-label={`${p.item.lineName}，${p.item.degraded ? '含待核项,' : ''}查看该险种详情`}
                title={p.item.lineName}
              >
                {p.item.degraded && <span className="rp-flag" aria-hidden="true">待核</span>}
                <span className="rp-block-inner">
                  <span className="rp-block-name">{p.item.lineName}</span>
                  {!small && p.item.coverageDirection && <span className="rp-block-snippet">{p.item.coverageDirection}</span>}
                </span>
                {!small && (
                  <span className="rp-block-foot">
                    <span className="rp-block-tier">{TIER_LABEL[p.item.tier] ?? p.item.tier}</span>
                    {typeof p.item.qualityScore === 'number' && <span className="rp-block-score">可信度 {p.item.qualityScore}</span>}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        <AnimatePresence>
          {selectedItem && (
            <motion.div
              key={selectedItem.lineId}
              layoutId={`rp-block-${selectedItem.lineId}`}
              className="rp-detail"
              style={{ background: blockColor(selectedItem.urgency, selectedItem.qualityScore).fill }}
              transition={{ type: 'spring', duration: reduce ? 0.2 : 0.55, bounce: reduce ? 0 : 0.12 }}
            >
              <BlockDetailBody item={selectedItem} taskId={taskId} onClose={() => onSelect(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>

      <p className="rp-hint">点方块进入该险种详情。面积越大 = 越紧迫、越应优先关注;色越暖 = 越紧迫。</p>

      <p className="rp-disclaimer">{proposal.disclaimer}</p>

      {/* 总览 chat:悬浮触发 + 面板 */}
      <button type="button" className="rp-chat-fab" onClick={onToggleChat} aria-expanded={chatOpen}>
        {chatOpen ? '收起解读' : '问问这份报告'}
      </button>
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            className="rp-chat-dock"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: reduce ? 0.15 : 0.28, ease: EASE_OUT }}
          >
            <ReportChatPanel taskId={taskId} scope="report" title="报告总览解读" onClose={onToggleChat} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TIER_LABEL: Record<string, string> = { tier1: '核心', tier2: '重点', tier3: '补充', tier4: '可选' };

function countIn(items: ProposalItem[], key: string): number {
  return items.filter((i) => i.urgency === key).length;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
