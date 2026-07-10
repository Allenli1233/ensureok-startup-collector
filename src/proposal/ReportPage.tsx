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
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
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

// 淡入上浮:进入视口时透明度 0→1 + 上移(reduced-motion 只淡入不位移)
function fadeUp(reduce: boolean, delay = 0) {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-40px' } as const,
    transition: { duration: reduce ? 0.2 : 0.5, ease: EASE_OUT, delay },
  };
}

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

  // 视差:背景光晕层随 chamber 滚动以更慢速率位移(净 ~0.77×),制造纵深
  const scrimRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrimRef });
  const bgY = useTransform(scrollY, [0, 700], [0, 160]);

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
      ref={scrimRef}
      className="rp-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0.15 : 0.32, ease: 'linear' }}
      role="dialog"
      aria-modal="true"
      aria-label="保障体检报告"
    >
      <motion.div className="rp-parallax" aria-hidden="true" style={reduce ? undefined : { y: bgY }} />
      <motion.div
        className="rp-chamber"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.985, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.99, filter: 'blur(6px)' }}
        transition={{ duration: reduce ? 0.15 : 0.62, ease: EASE_OUT }}
      >
        <Header
          company={state.proposal?.meta.company}
          onClose={onClose}
          onExport={state.status === 'ready' && state.proposal ? () => window.print() : undefined}
        />

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

function Header({ company, onClose, onExport }: { company?: string; onClose: () => void; onExport?: () => void }): React.ReactElement {
  return (
    <header className="rp-header">
      <div className="rp-header-l">
        <span className="rp-kicker">保障体检报告</span>
        {company ? <span className="rp-company">{company}</span> : null}
      </div>
      <div className="rp-header-actions">
        {onExport && (
          <button type="button" className="rp-close" onClick={onExport} aria-label="导出 PDF">
            <span aria-hidden="true">导出 PDF</span>
          </button>
        )}
        <button type="button" className="rp-close" onClick={onClose} aria-label="返回">
          <span aria-hidden="true">返回</span>
        </button>
      </div>
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
  scale: number; // 内容同比例放大系数(∝ √面积),1 = 基准,最大 1.85
  snipLines: number; // 承保方向摘要可见行数(块越大越多)
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
        // 同比例放大:以 √面积 相对基准 380px 计,clamp 到 [1, 1.85];行数随之增加
        const scale = clamp(Math.round((Math.sqrt(b.rect.w * b.rect.h) / 380) * 100) / 100, 1, 1.85);
        const snipLines = scale >= 1.5 ? 6 : scale >= 1.25 ? 4 : 3;
        return { item, x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h, delay: (delayOf.get(b.id) ?? 0) * 0.05, scale, snipLines };
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
      <motion.div className="rp-summary" {...fadeUp(reduce)}>{proposal.clientSummary}</motion.div>

      <PrintDoc proposal={proposal} />

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
            return <TreemapBlock key={p.item.lineId} p={p} small={small} reduce={reduce} onSelect={onSelect} />;
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

      <motion.p className="rp-hint" {...fadeUp(reduce)}>点方块进入该险种详情。面积越大 = 越紧迫、越应优先关注;色越暖 = 越紧迫。</motion.p>

      <motion.p className="rp-disclaimer" {...fadeUp(reduce)}>{proposal.disclaimer}</motion.p>

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

// ─────────────────────────── treemap 单块(波纹点击 + 同比例内容 + 淡入上浮）───────────────────────────

interface Ripple {
  id: number;
  x: number;
  y: number;
  d: number;
}

function TreemapBlock({
  p,
  small,
  reduce,
  onSelect,
}: {
  p: Placed;
  small: boolean;
  reduce: boolean;
  onSelect: (id: string | null) => void;
}): React.ReactElement {
  const c = blockColor(p.item.urgency, p.item.qualityScore);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const spawnRipple = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (reduce) return; // 尊重 prefers-reduced-motion
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 直径覆盖到最远角,保证波纹铺满
    const d = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;
    setRipples((rs) => [...rs, { id: nextId.current++, x, y, d }]);
  };
  const endRipple = (id: number) => setRipples((rs) => rs.filter((r) => r.id !== id));

  return (
    <motion.button
      layoutId={`rp-block-${p.item.lineId}`}
      type="button"
      className={`rp-block${small ? ' rp-block-sm' : ''}`}
      style={{
        left: p.x,
        top: p.y,
        width: p.w,
        height: p.h,
        background: c.fill,
        boxShadow: `0 8px 26px ${c.glow}`,
        ['--rp-s' as string]: p.scale,
        ['--rp-snip' as string]: p.snipLines,
      }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduce ? { duration: 0.2, delay: p.delay } : { type: 'spring', duration: 0.64, bounce: 0.16, delay: p.delay }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      onPointerDown={spawnRipple}
      onClick={() => onSelect(p.item.lineId)}
      aria-label={`${p.item.lineName}，${p.item.degraded ? '含待核项,' : ''}查看该险种详情`}
      title={p.item.lineName}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          className="rp-ripple"
          style={{ left: r.x, top: r.y, width: r.d, height: r.d }}
          onAnimationEnd={() => endRipple(r.id)}
          aria-hidden="true"
        />
      ))}
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
}

const TIER_LABEL: Record<string, string> = { tier1: '核心', tier2: '重点', tier3: '补充', tier4: '可选' };
const URGENCY_LABEL: Record<string, string> = { mandatory: '强制', high: '高优先', advice: '建议' };

// 打印专用的干净文档(屏幕上 display:none;仅 @media print 可见)。导出 PDF = window.print()。
function PrintDoc({ proposal }: { proposal: Proposal }): React.ReactElement {
  return (
    <div className="rp-print">
      <h1 className="rp-print-title">保障体检报告</h1>
      <p className="rp-print-meta">
        {proposal.meta.company ? `${proposal.meta.company} · ` : ''}
        {proposal.clientSummary}
      </p>
      {proposal.items.map((it) => {
        const clauses = it.keyClausesDetailed?.length ? it.keyClausesDetailed.map((c) => c.text) : it.keyClauses;
        return (
          <section key={it.lineId} className="rp-print-sec">
            <h2 className="rp-print-h2">
              {it.lineName}
              <span className="rp-print-badge">
                {URGENCY_LABEL[it.urgency] ?? it.urgency} · {TIER_LABEL[it.tier] ?? it.tier}
                {typeof it.qualityScore === 'number' ? ` · 可信度 ${it.qualityScore}` : ''}
              </span>
            </h2>
            {it.coverageDirection && (
              <p className="rp-print-p"><b>承保方向:</b>{it.coverageDirection}</p>
            )}
            {it.rationale && <p className="rp-print-p"><b>为什么推荐:</b>{it.rationale}</p>}
            {clauses.length > 0 && (
              <div className="rp-print-p">
                <b>条款要点:</b>
                <ul className="rp-print-ul">
                  {clauses.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {it.pricing?.display && (
              <p className="rp-print-p"><b>参考价位:</b>{it.pricing.display}(以保司实际报价为准,非成交报价)</p>
            )}
            {it.recommendedProducts.length > 0 && (
              <p className="rp-print-p">
                <b>产品库在售保司:</b>
                {it.recommendedProducts.slice(0, 3).map((r) => r.insurer).join('、')}
              </p>
            )}
          </section>
        );
      })}
      <p className="rp-print-disc">{proposal.disclaimer}</p>
    </div>
  );
}

function countIn(items: ProposalItem[], key: string): number {
  return items.filter((i) => i.urgency === key).length;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
