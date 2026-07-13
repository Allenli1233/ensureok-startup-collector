/** 保障体检报告。风险优先级、证据状态和下一步处理顺序共同构成主视图。 */
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { blockColor, buildReportGroups, itemWeight } from './reportModel';
import { bentoLayout } from './bentoLayout';
import type { Proposal, ProposalItem } from './types';
import { BlockDetailBody } from './BlockDetail';
import { NumberTicker } from './NumberTicker';
import { ReportChatPanel } from './ReportChat';
import { RippleField } from './RippleField';
import './report.css';

const EASE_OUT = [0.22, 1, 0.36, 1] as const; // 强 ease-out(emil:内建太弱)

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
      <div className="rp-parallax" aria-hidden="true" />
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
        <span className="rp-mark" aria-hidden="true">E</span>
        <div>
          <span className="rp-kicker">保障体检报告</span>
          <span className="rp-edition">RISK REVIEW / 01</span>
        </div>
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
    <div className={`rp-loading rp-loading-shell${reduce ? ' rp-loading-static' : ''}`} aria-live="polite">
      <div className="rp-skeleton-copy">
        <span className="rp-skeleton-line rp-skeleton-eyebrow" />
        <span className="rp-skeleton-line rp-skeleton-title" />
        <span className="rp-skeleton-line rp-skeleton-text" />
        <span className="rp-skeleton-line rp-skeleton-text rp-skeleton-short" />
      </div>
      <div className="rp-skeleton-map" aria-hidden="true">
        <span /><span /><span />
      </div>
      <div className="rp-loading-copy">
        <p className="rp-loading-title">正在建立风险优先级</p>
        <p className="rp-loading-sub">正在核对产品库、条款证据与合规状态。</p>
      </div>
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

// ─────────────────────────── 报告主体 ───────────────────────────

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
  const itemById = useMemo(() => new Map(proposal.items.map((it) => [it.lineId, it])), [proposal.items]);

  // 组计数(强制 / 高优先 / 建议),复用 buildReportGroups 的固定顺序与文案
  const groupCounts = useMemo<GroupCount[]>(
    () => buildReportGroups(proposal.items).map((g) => ({ key: g.key, label: g.label, count: g.nodes.length })),
    [proposal.items],
  );

  const needsReview = proposal.items.filter((item) => item.degraded || item.evidenceInsufficient).length;

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
      <section className="rp-overview" aria-labelledby="rp-overview-title">
        <div className="rp-overview-copy">
          <span className="rp-section-index">评估结论</span>
          <h1 id="rp-overview-title" className="rp-overview-title" aria-label="先处理必须守住的底线">
            <span>先处理必须</span><span className="rp-title-second">守住的底线</span>
          </h1>
          <p className="rp-summary">{proposal.clientSummary}</p>
        </div>
        <dl className="rp-metrics" aria-label="报告摘要指标">
          <div className="rp-metric rp-metric-primary">
            <dt>待关注风险</dt>
            <dd><NumberTicker value={proposal.items.length} /><small>项</small></dd>
          </div>
          <div className="rp-metric">
            <dt>强制事项</dt>
            <dd><NumberTicker value={groupCounts.find((g) => g.key === 'mandatory')?.count ?? 0} /><small>项</small></dd>
          </div>
          <div className="rp-metric">
            <dt>高优先风险</dt>
            <dd><NumberTicker value={groupCounts.find((g) => g.key === 'high')?.count ?? 0} /><small>项</small></dd>
          </div>
          <div className="rp-metric">
            <dt>需要人工复核</dt>
            <dd><NumberTicker value={needsReview} /><small>项</small></dd>
          </div>
        </dl>
      </section>

      <PrintDoc proposal={proposal} />

      <LayoutGroup>
        <section className="rp-landscape" aria-labelledby="rp-landscape-title">
          <div className="rp-section-head">
            <div>
              <span className="rp-section-index">风险热力图</span>
              <h2 id="rp-landscape-title">把资源先放在最重要的风险上</h2>
            </div>
            <p>面积越大，处理优先级越高；颜色越暖，风险越紧迫。点击任一风险查看完整说明。</p>
          </div>
          <RiskHeatmap items={proposal.items} selected={selected} reduce={reduce} onSelect={onSelect} />
          <div className="rp-heatmap-legend" aria-label="热力图图例">
            <span><i className="rp-legend-dot rp-legend-mandatory" />强制处理</span>
            <span><i className="rp-legend-dot rp-legend-high" />高优先</span>
            <span><i className="rp-legend-dot rp-legend-advice" />建议完善</span>
            <em>方块面积 = 相对处理优先级</em>
          </div>
        </section>

        <AnimatePresence>
          {selectedItem && (
            <>
              <motion.button
                key={`${selectedItem.lineId}-backdrop`}
                type="button"
                className="rp-detail-backdrop"
                aria-label={`关闭${selectedItem.lineName}详情`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0.1 : 0.22 }}
                onClick={() => onSelect(null)}
              />
              <motion.div
                key={selectedItem.lineId}
                layoutId={`rp-block-${selectedItem.lineId}`}
                className="rp-detail"
                style={{ background: blockColor(selectedItem.urgency).fill }}
                transition={{ type: 'spring', duration: reduce ? 0.2 : 0.55, bounce: reduce ? 0 : 0.12 }}
                role="dialog"
                aria-modal="true"
                aria-label={`${selectedItem.lineName}风险详情`}
              >
                <motion.div
                  className="rd-fluid"
                  initial={reduce ? { opacity: 0 } : { opacity: 0.75, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0.7, scale: 0.99 }}
                  transition={{ duration: reduce ? 0.15 : 0.32, ease: EASE_OUT }}
                >
                  <BlockDetailBody
                    item={selectedItem}
                    company={proposal.meta.company}
                    taskId={taskId}
                    onClose={() => onSelect(null)}
                  />
                </motion.div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </LayoutGroup>

      <p className="rp-hint">选择任一险种查看承保方向、条款证据与产品库匹配结果。</p>

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

// ─────────────────────────── 风险热力图 ───────────────────────────

function RiskHeatmap({
  items,
  selected,
  reduce,
  onSelect,
}: {
  items: ProposalItem[];
  selected: string | null;
  reduce: boolean;
  onSelect: (id: string | null) => void;
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1100);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setWidth(Math.max(280, Math.round(host.clientWidth || 1100)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const height = width < 560
    ? Math.max(1200, items.length * 175)
    : width < 900
      ? Math.max(1020, items.length * 135)
      : Math.max(860, items.length * 112);
  const rects = useMemo(
    () => bentoLayout(
      items.map((item, order) => ({ id: item.lineId, weight: itemWeight(item), order })),
      { width, height },
      { gap: width < 560 ? 8 : 12 },
    ),
    [height, items, width],
  );
  const itemById = useMemo(() => new Map(items.map((item) => [item.lineId, item])), [items]);

  return (
    <div ref={hostRef} className="rp-bento rp-heatmap" style={{ height }}>
      {rects.map((rect, index) => {
        const item = itemById.get(rect.id);
        if (!item || item.lineId === selected) return null;
        const compact = rect.w < 300 || rect.h < 230;
        const tiny = rect.w < 210 || rect.h < 165;
        const riskText = item.gapTitles.length > 0
          ? item.gapTitles.join('、')
          : item.coverageDirection || `${item.lineName}相关风险需要进一步核实。`;
        const relationText = item.rationale || `该风险与企业当前业务和经营安排有关，需要结合实际情况确认暴露程度。`;
        return (
          <motion.button
            key={item.lineId}
            layoutId={`rp-block-${item.lineId}`}
            type="button"
            className={`rp-cell rp-heat-cell rp-heat-${item.urgency}${compact ? ' rp-heat-compact' : ''}${tiny ? ' rp-heat-tiny' : ''}`}
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: blockColor(item.urgency).fill }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.975 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduce ? 0.15 : 0.4, ease: EASE_OUT, delay: Math.min(index * 0.035, 0.24) }}
            whileTap={reduce ? undefined : { scale: 0.992 }}
            onClick={() => onSelect(item.lineId)}
            aria-label={`${item.lineName}，${URGENCY_LABEL[item.urgency] ?? item.urgency}，参考价格${item.pricing.display || '待询价'}，查看详情`}
            data-risk-trigger="true"
            data-risk-id={item.lineId}
          >
            <span className="rp-heat-top">
              <span className="rp-heat-tier">
                {URGENCY_LABEL[item.urgency] ?? item.urgency} / {TIER_LABEL[item.tier] ?? item.tier}
              </span>
              <span className="rp-heat-arrow" aria-hidden="true">↗</span>
            </span>
            <strong className="rp-heat-name">{item.lineName}</strong>
            <span className="rp-heat-facts">
              <span className="rp-heat-fact">
                <span className="rp-heat-fact-label">有什么风险</span>
                <span className="rp-heat-fact-value">{riskText}</span>
              </span>
              <span className="rp-heat-fact">
                <span className="rp-heat-fact-label">为什么和你有关</span>
                <span className="rp-heat-fact-value">{relationText}</span>
              </span>
              <span className="rp-heat-fact">
                <span className="rp-heat-fact-label">建议怎么处理</span>
                <span className="rp-heat-fact-value">
                  {item.coverageDirection || `结合实际业务确认${item.lineName}的责任范围、赔偿限额和除外约定。`}
                </span>
              </span>
            </span>
            <span className="rp-heat-foot">
              <span>
                <span className="rp-heat-price-label">大概要多少钱</span>
                <strong className="rp-heat-price">{item.pricing.display || '待询价'}</strong>
              </span>
              <span className="rp-heat-action">查看完整说明</span>
            </span>
          </motion.button>
        );
      })}
      <RippleField />
    </div>
  );
}

const TIER_LABEL: Record<string, string> = { tier1: '核心', tier2: '重点', tier3: '补充', tier4: '可选' };
const URGENCY_LABEL: Record<string, string> = { mandatory: '强制', high: '高优先', advice: '建议' };

// 打印专用的干净文档。portal 到 body(脱离全屏舱的 fixed/overflow 容器),
// 打印时以正常流从纸张顶部开始、自动跨页,信息不再被裁到一页。屏幕上 display:none。
function PrintDoc({ proposal }: { proposal: Proposal }): React.ReactElement | null {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="rp-print">
      <h1 className="rp-print-title">保障体检报告</h1>
      <p className="rp-print-meta">
        {proposal.meta.company ? `${proposal.meta.company} / ` : ''}
        {proposal.clientSummary}
      </p>
      {proposal.items.map((it) => {
        const clauses = it.keyClausesDetailed?.length ? it.keyClausesDetailed.map((c) => c.text) : it.keyClauses;
        return (
          <section key={it.lineId} className="rp-print-sec">
            <h2 className="rp-print-h2">
              {it.lineName}
              <span className="rp-print-badge">
                {URGENCY_LABEL[it.urgency] ?? it.urgency} / {TIER_LABEL[it.tier] ?? it.tier}
              </span>
            </h2>
            {it.coverageDirection && (
              <p className="rp-print-p"><b>风险详细解释:</b>{it.coverageDirection}</p>
            )}
            {it.rationale && <p className="rp-print-p"><b>与公司有关的说明:</b>{it.rationale}</p>}
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
                {it.recommendedProducts.map((r) => r.insurer).join('、')}
              </p>
            )}
          </section>
        );
      })}
      <p className="rp-print-disc">{proposal.disclaimer}</p>
    </div>,
    document.body,
  );
}
