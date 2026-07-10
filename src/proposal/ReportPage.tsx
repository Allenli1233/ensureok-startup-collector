/**
 * 保障体检报告 —— 独立的全屏「体检舱」页面(进入即换页,电影级过渡)。
 *
 * 设计取向(design-taste-frontend + emil-design-eng):
 *   - 布局:Bento CSS Grid(bentoLayout 纯函数派 span);最紧迫/最高权重险种占 2×2 hero,
 *     其余按权重比值分档(2×2 / 2×1 / 1×2 / 1×1),grid-auto-flow: dense 自动回填。窄屏降 2 列。
 *   - 背景:自写 WebGL 鼠标跟随水波纹(RippleField)铺在 Bento 层背景,pointer-events:none。
 *   - 开场:文字按阅读顺序模糊浮现(BlurInText);非金额数字向上滚动计数(NumberTicker)。
 *   - 点方块 → 共享元素(layoutId)放大成详情,内容层加 scale/blur 流体过渡(emil)。
 *   - 全部动画尊重 prefers-reduced-motion:退化为不位移的透明度过渡。
 * 不出现任何保费数字(金额只在 BlockDetail 参考价位);合规免责固定可见;PDF 打印文档不受影响。
 */
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bentoLayout, type BentoRect } from './bentoLayout';
import { blockColor, buildReportGroups } from './reportModel';
import type { Proposal, ProposalItem } from './types';
import { BlockDetailBody } from './BlockDetail';
import { BlurInText } from './BlurInText';
import { NumberTicker } from './NumberTicker';
import { ReportChatPanel } from './ReportChat';
import { RippleField } from './RippleField';
import './report.css';

const EASE_OUT = [0.22, 1, 0.36, 1] as const; // 强 ease-out(emil:内建太弱)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const BENTO_BP = 720; // <720px 视为窄屏(容器更高,密铺更竖)
const BENTO_GAP = 8; // 相邻块间隙(走暗底,不再白斑)

/** 容器高度:宽屏偏横、窄屏偏竖;随险种数略增高,避免块过小。铺满由 squarify 保证。 */
function bentoHeight(width: number, count: number): number {
  if (width <= 0 || count === 0) return 0;
  const narrow = width < BENTO_BP;
  const base = narrow ? width * 1.25 : width * 0.56;
  const perItem = narrow ? count * 40 : count * 18;
  const lo = narrow ? 420 : 380;
  const hi = narrow ? 1200 : 760;
  return Math.round(Math.min(hi, Math.max(lo, base + perItem)));
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
        {/* 开场文字模糊浮现 · 阅读顺序第一段(startDelay 0) */}
        <BlurInText as="span" className="rp-kicker" text="保障体检报告" by="char" startDelay={0} stagger={0.04} />
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

// ─────────────────────────── 报告主体(Bento + 详情 + chat) ───────────────────────────

interface Cell {
  item: ProposalItem;
  rect: BentoRect; // 绝对定位矩形(完全铺满容器)
  scale: number; // 内容排版放大系数(∝ 块尺寸)
  small: boolean; // 小块:隐藏承保方向摘要
  snipLines: number; // 摘要可见行数
  delay: number; // 错峰进场
}

interface GroupCount {
  key: string;
  label: string;
  count: number;
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

  // 组计数(强制 / 高优先 / 建议),复用 buildReportGroups 的固定顺序与文案
  const groupCounts = useMemo<GroupCount[]>(
    () => buildReportGroups(proposal.items).map((g) => ({ key: g.key, label: g.label, count: g.nodes.length })),
    [proposal.items],
  );

  const bentoH = useMemo(() => bentoHeight(width, proposal.items.length), [width, proposal.items.length]);

  const cells = useMemo<Cell[]>(() => {
    const groups = buildReportGroups(proposal.items);
    if (groups.length === 0 || width <= 0 || bentoH <= 0) return [];
    // 各组 nodes 按传入顺序展开成扁平序列(每项已带 weight);order = 展开序
    const flat: { id: string; weight: number; order: number }[] = [];
    let order = 0;
    for (const g of groups) for (const n of g.nodes) flat.push({ id: n.id, weight: n.weight, order: order++ });

    const rects = bentoLayout(flat, { width, height: bentoH }, { gap: BENTO_GAP });

    return rects
      .map((rect, i) => {
        const item = itemById.get(rect.id);
        if (!item) return null;
        const side = Math.sqrt(rect.w * rect.h);
        const scale = clamp(Math.round((side / 300) * 100) / 100, 1, 1.5);
        const small = rect.w < 150 || rect.h < 108; // 太小 → 只显名,不显摘要
        const snipLines = rect.h > 300 ? 6 : rect.h > 210 ? 4 : rect.h > 150 ? 3 : 2;
        return { item, rect, scale, small, snipLines, delay: i * 0.04 };
      })
      .filter((c): c is Cell => c !== null);
  }, [proposal.items, width, bentoH, itemById]);

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
      {/* 摘要 · 阅读顺序第二段 */}
      <BlurInText as="div" className="rp-summary" text={proposal.clientSummary} by="line" startDelay={0.15} stagger={0.05} />

      {/* 组计数 chip 一排 · 阅读顺序第三段;计数用 NumberTicker(非金额) */}
      <div className="rp-groupbar">
        <span className="rp-groupchip rp-groupchip-total">
          <NumberTicker value={proposal.items.length} className="rp-groupchip-n" />
          <BlurInText as="span" className="rp-groupchip-lab" text="项待关注" startDelay={0.28} />
        </span>
        {groupCounts.map((g, i) => (
          <span key={g.key} className={`rp-groupchip rp-groupchip-${g.key}`}>
            <BlurInText as="span" className="rp-groupchip-lab" text={g.label} startDelay={0.28 + (i + 1) * 0.06} />
            <NumberTicker value={g.count} className="rp-groupchip-n" />
          </span>
        ))}
      </div>

      <PrintDoc proposal={proposal} />

      <LayoutGroup>
        <div className="rp-bento" ref={stageRef} style={{ height: bentoH || 360 }}>
          {cells.map((c) => {
            // 绝对定位密铺:选中项让位给 layoutId 形变,无需占位(兄弟不回流)
            if (selected === c.item.lineId) return null;
            return <BentoCell key={c.item.lineId} c={c} reduce={reduce} onSelect={onSelect} />;
          })}
          {/* 水波纹叠在方块之上(pointer-events:none,不挡点击):鼠标划过方块即有波纹,缝隙统一暗底 */}
          <RippleField />
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
              {/* emil 流体感:内容层做 scale/blur 收束,外层 layout 负责位置/尺寸 morph */}
              <motion.div
                className="rd-fluid"
                initial={reduce ? { opacity: 0 } : { opacity: 0.6, scale: 0.96, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0.6, scale: 0.98, filter: 'blur(4px)' }}
                transition={{ duration: reduce ? 0.2 : 0.4, ease: EASE_OUT }}
              >
                <BlockDetailBody item={selectedItem} taskId={taskId} onClose={() => onSelect(null)} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>

      {/* 提示 · 阅读顺序第四段 */}
      <BlurInText
        as="p"
        className="rp-hint"
        text="点方块进入该险种详情。块越大 = 越紧迫、越应优先关注;色越暖 = 越紧迫。"
        by="line"
        startDelay={0.4}
      />

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

// ─────────────────────────── Bento 单格 ───────────────────────────

function BentoCell({
  c,
  reduce,
  onSelect,
}: {
  c: Cell;
  reduce: boolean;
  onSelect: (id: string | null) => void;
}): React.ReactElement {
  const { item, rect, scale, small, snipLines, delay } = c;
  const color = blockColor(item.urgency, item.qualityScore);

  return (
    <motion.button
      layoutId={`rp-block-${item.lineId}`}
      type="button"
      className={`rp-cell${rect.rank === 0 ? ' rp-cell-hero' : ''}${small ? ' rp-cell-sm' : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        background: color.fill,
        boxShadow: `0 8px 26px ${color.glow}`,
        ['--rp-s' as string]: scale,
        ['--rp-snip' as string]: snipLines,
      }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduce ? { duration: 0.2, delay } : { type: 'spring', duration: 0.64, bounce: 0.16, delay }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      onClick={() => onSelect(item.lineId)}
      aria-label={`${item.lineName}，${item.degraded ? '含待核项,' : ''}查看该险种详情`}
      title={item.lineName}
    >
      {item.degraded && <span className="rp-flag" aria-hidden="true">待核</span>}
      <span className="rp-block-inner">
        <span className="rp-block-name">{item.lineName}</span>
        {!small && item.coverageDirection && <span className="rp-block-snippet">{item.coverageDirection}</span>}
      </span>
      {!small && (
        <span className="rp-block-foot">
          <span className="rp-block-tier">{TIER_LABEL[item.tier] ?? item.tier}</span>
          {typeof item.qualityScore === 'number' && (
            <span className="rp-block-score">
              可信度 <NumberTicker value={item.qualityScore} />
            </span>
          )}
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
