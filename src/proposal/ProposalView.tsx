import React, { useMemo, useState } from 'react';
import './print.css';
import type {
  Citation,
  Faithfulness,
  GapUrgency,
  KeyClauseDetailed,
  Portfolio,
  Proposal,
  ProposalItem,
  ProposalRequest,
  ProposalTier,
  RationaleDriver,
  RecommendedProduct,
} from './types';

const TIER_LABEL: Record<ProposalTier, string> = {
  tier1: '合同/合规强制型',
  tier2: '高优先级',
  tier3: '建议关注',
  tier4: '品类共创',
};
const TIER_COLOR: Record<ProposalTier, string> = {
  tier1: '#b42318',
  tier2: '#b54708',
  tier3: '#475467',
  tier4: '#6941c6',
};

/** 紧迫度(对比表用):文字 + 排序权重 + 配色 */
const URGENCY_META: Record<GapUrgency, { label: string; rank: number; color: string; bg: string }> = {
  mandatory: { label: '强制', rank: 0, color: '#b42318', bg: '#fef3f2' },
  high: { label: '高优先', rank: 1, color: '#b54708', bg: '#fffaeb' },
  advice: { label: '建议', rank: 2, color: '#475467', bg: '#f7f5f0' },
};

/**
 * 忠实度四态展示(icon+文字双编码,色盲友好):
 * entailed 忠实(✓绿) / unverified 待核(⚠琥珀,待顾问核对非错误) /
 * not-supported 无支撑(✗红) / contradicted 讲反(✗红,与条款不一致——区别于"无支撑")。
 */
const FAITH_META: Record<Faithfulness, { icon: string; label: string; color: string; bg: string; title: string }> = {
  entailed: { icon: '✓', label: '忠实', color: '#067647', bg: '#ecfdf3', title: '已核对到条款原文支撑' },
  unverified: { icon: '⚠', label: '待核', color: '#b54708', bg: '#fffaeb', title: '待持牌顾问核对确认,并非错误' },
  'not-supported': { icon: '✗', label: '无支撑', color: '#b42318', bg: '#fef3f2', title: '暂未检索到条款支撑,已交顾问复核' },
  contradicted: { icon: '✗', label: '讲反', color: '#b42318', bg: '#fef3f2', title: '与条款原文不一致(讲反了),已交顾问复核' },
};

/** 可信度分档(信任信号,不排名):≥85 高 / ≥70 中 / 其余 低 */
function trustLevel(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 85) return { label: '高', color: '#067647', bg: '#ecfdf3', border: '#abefc6' };
  if (score >= 70) return { label: '中', color: '#b54708', bg: '#fffaeb', border: '#fedf89' };
  return { label: '低', color: '#b42318', bg: '#fef3f2', border: '#fecdca' };
}

/** 组合角色:该险种在 portfolio.bundles / overlaps 里扮演的角色(按险种名匹配),无则 '—' */
function portfolioRole(item: ProposalItem, portfolio?: Portfolio): string {
  if (!portfolio) return '—';
  const roles: string[] = [];
  for (const b of portfolio.bundles ?? []) {
    if (b.lines.includes(item.lineName)) roles.push(`组合包·${b.name}`);
  }
  for (const o of portfolio.overlaps ?? []) {
    if (o.lines.includes(item.lineName)) roles.push('有重叠');
  }
  return roles.length ? roles.join(' / ') : '—';
}

type ViewMode = 'cards' | 'table';
type Variant = 'client' | 'advisor';

export function ProposalView({
  proposal,
  onRegenerate,
  currentProfile,
  previousLineNames,
}: {
  proposal: Proposal;
  /** 调参重生成:走既有的全量重生成路径(父组件 reuse useProposal/buildRequest)。可选 */
  onRegenerate?: (profile: ProposalRequest['profile']) => void;
  /** 重生成抽屉的预填画像(当前这版用的画像) */
  currentProfile?: ProposalRequest['profile'];
  /** 上一版的险种名列表——用于重生成后对比"新增/移除"行 */
  previousLineNames?: string[];
}): React.ReactElement {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<ViewMode>('cards');
  const [variant, setVariant] = useState<Variant>('client');
  const [onlyMandatory, setOnlyMandatory] = useState(false);
  const [hideDegraded, setHideDegraded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const advisor = variant === 'advisor';

  // ready_degraded:诚实优先——有降级/待核项就如实提示,不隐藏
  const degradedCount = proposal.items.filter((i) => i.degraded).length;

  // 重生成后的行级对比(可行时):相对上一版新增了哪些险种、移除了哪些
  const diff = useMemo(() => {
    if (!previousLineNames || previousLineNames.length === 0) return null;
    const now = proposal.items.map((i) => i.lineName);
    const added = now.filter((n) => !previousLineNames.includes(n));
    const removed = previousLineNames.filter((n) => !now.includes(n));
    if (added.length === 0 && removed.length === 0) return null;
    return { added, removed };
  }, [previousLineNames, proposal.items]);

  return (
    <div className="proposal-print" style={styles.root}>
      <div style={styles.head}>
        <div style={styles.docName}>{proposal.meta.documentName}</div>
        <div style={styles.company}>{proposal.meta.company}</div>
        <div style={styles.summary}>{proposal.clientSummary}</div>
      </div>

      {proposal.portfolio && <PortfolioBlock portfolio={proposal.portfolio} />}

      {degradedCount > 0 && (
        <div style={styles.degradedNote}>
          其中 <strong>{degradedCount}</strong> 项建议由持牌顾问补充 / 待核,已在对应险种上标注——如实呈现,便于你与顾问重点确认。
        </div>
      )}

      {diff && (
        <div style={styles.diffNote}>
          已按新画像重新生成。
          {diff.added.length > 0 && <>新增:{diff.added.join('、')}。</>}
          {diff.removed.length > 0 && <>移除:{diff.removed.join('、')}。</>}
        </div>
      )}

      {/* ── 工具条(不进打印):视图切换 / 双版导出 / 打印 / 调参重生成 ── */}
      <div className="no-print" style={styles.toolbar}>
        <SegToggle
          label="视图"
          value={view}
          options={[
            { value: 'cards', label: '卡片流' },
            { value: 'table', label: '对比表' },
          ]}
          onChange={(v) => setView(v as ViewMode)}
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
          <button type="button" style={styles.regenBtn} onClick={() => setDrawerOpen(true)}>
            调整画像重新生成
          </button>
        )}
        <button style={styles.printBtn} type="button" onClick={() => window.print()}>
          导出 PDF / 打印
        </button>
      </div>

      {/* 客户版:以一句合规核对声明替代生成过程细节(固定可见,进打印) */}
      {!advisor && (
        <div style={styles.complianceLine}>已通过合规与条款核对 · 生成过程细节见「顾问版」。</div>
      )}

      {view === 'table' ? (
        <CompareTable
          items={proposal.items}
          portfolio={proposal.portfolio}
          advisor={advisor}
          onlyMandatory={onlyMandatory}
          hideDegraded={hideDegraded}
        />
      ) : (
        <div style={styles.items}>
          {proposal.items.map((item) => (
            <ItemCard
              key={item.lineId}
              item={item}
              advisor={advisor}
              open={!!open[item.lineId]}
              onToggle={() => toggle(item.lineId)}
            />
          ))}
        </div>
      )}

      <p style={styles.disclaimer}>{proposal.disclaimer}</p>
      <div style={styles.foot}>
        生成引擎 {proposal.meta.engine} · 模型 {proposal.meta.llmModel} · {proposal.meta.generatedAt.slice(0, 10)}
      </div>

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
// 概览级组合说明
// ────────────────────────────────────────────────────────────────────────────

function PortfolioBlock({ portfolio }: { portfolio: Portfolio }): React.ReactElement | null {
  const hasContent =
    !!portfolio.summary ||
    !!portfolio.layering ||
    (portfolio.overlaps?.length ?? 0) > 0 ||
    (portfolio.bundles?.length ?? 0) > 0;
  if (!hasContent) return null;
  return (
    <div style={styles.portfolio}>
      <div style={styles.portfolioTitle}>组合说明</div>
      {portfolio.summary && <p style={styles.portfolioP}>{portfolio.summary}</p>}
      {portfolio.layering && (
        <p style={styles.portfolioP}>
          <strong>保障层次:</strong>
          {portfolio.layering}
        </p>
      )}
      {portfolio.overlaps && portfolio.overlaps.length > 0 && (
        <div style={styles.portfolioP}>
          {portfolio.overlaps.map((o, i) => (
            <div key={i} style={styles.overlap}>
              ⚠ {o.lines.join(' × ')}:{o.note}
            </div>
          ))}
        </div>
      )}
      {portfolio.bundles && portfolio.bundles.length > 0 && (
        <div style={styles.portfolioP}>
          {portfolio.bundles.map((b, i) => (
            <div key={i} style={styles.bundle}>
              组合包「{b.name}」:{b.lines.join('、')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 险种对比表(§7.3)
// ────────────────────────────────────────────────────────────────────────────

function CompareTable({
  items,
  portfolio,
  advisor,
  onlyMandatory,
  hideDegraded,
}: {
  items: ProposalItem[];
  portfolio?: Portfolio;
  advisor: boolean;
  onlyMandatory: boolean;
  hideDegraded: boolean;
}): React.ReactElement {
  // 排序仍按 urgency(默认);qualityScore 只是信任信号,不参与排名
  const rows = useMemo(() => {
    let list = items.slice();
    if (onlyMandatory) list = list.filter((i) => i.urgency === 'mandatory');
    if (hideDegraded) list = list.filter((i) => !i.degraded);
    list.sort((a, b) => URGENCY_META[a.urgency].rank - URGENCY_META[b.urgency].rank);
    return list;
  }, [items, onlyMandatory, hideDegraded]);

  if (rows.length === 0) {
    return <div style={styles.emptyTable}>当前筛选下没有可展示的险种。</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table className="proposal-compare" style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>险种</th>
            <th style={styles.th}>紧迫度</th>
            <th style={styles.th}>层级</th>
            <th style={styles.th}>参考保费</th>
            <th style={styles.thNum}>覆盖缺口</th>
            <th style={styles.th}>可信度</th>
            <th style={styles.th}>组合角色</th>
            <th style={styles.thNum}>降级</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const u = URGENCY_META[item.urgency];
            const trust = typeof item.qualityScore === 'number' ? trustLevel(item.qualityScore) : null;
            return (
              <tr key={item.lineId}>
                <td style={styles.tdName}>{item.lineName}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.pill, color: u.color, background: u.bg }}>{u.label}</span>
                </td>
                <td style={{ ...styles.td, color: TIER_COLOR[item.tier], fontWeight: 700 }}>
                  {TIER_LABEL[item.tier]}
                </td>
                {/* 价位列:只放参考区间标签,绝不放成交数 */}
                <td style={styles.tdPrice}>{item.pricing.unavailable ? '—' : item.pricing.display}</td>
                <td style={styles.tdNum}>{item.gapTitles.length}</td>
                <td style={styles.td}>
                  {trust ? (
                    <span style={{ ...styles.pill, color: trust.color, background: trust.bg }}>
                      {trust.label}
                      {advisor ? ` · ${item.qualityScore}` : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={styles.td}>{portfolioRole(item, portfolio)}</td>
                <td style={styles.tdNum}>
                  {item.degraded ? (
                    <span title={item.degradedReason || '内容降级 / 待核'} style={{ color: '#b54708' }}>
                      ⚠
                    </span>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 险种卡片
// ────────────────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  advisor,
  open,
  onToggle,
}: {
  item: ProposalItem;
  advisor: boolean;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  // 合规红线命中 → 内容已隐去,不编造内容(客户版/顾问版一致:绝不伪造)
  const redacted = !!(item.complianceFlags && item.complianceFlags.length > 0);
  const trust = typeof item.qualityScore === 'number' ? trustLevel(item.qualityScore) : null;

  return (
    <div className="proposal-item" style={styles.card}>
      <div style={styles.cardHead}>
        <span style={{ ...styles.tier, color: TIER_COLOR[item.tier] }}>{TIER_LABEL[item.tier]}</span>
        <span style={styles.lineName}>{item.lineName}</span>
        {trust && (
          <span
            style={{ ...styles.trustBadge, color: trust.color, background: trust.bg, borderColor: trust.border }}
            title="内容可信度自评,是信任信号、不代表产品排名"
          >
            {/* 客户版隐去原始分,只留定性档;顾问版带数值 */}
            可信度 {trust.label}
            {advisor ? ` · ${item.qualityScore}` : ''}
          </span>
        )}
        {item.degraded && (
          <span style={styles.degradedChip} title={item.degradedReason || '内容降级,待持牌顾问补充 / 核对'}>
            降级 / 待核
          </span>
        )}
      </div>

      {redacted ? (
        <div style={styles.redacted}>该险种内容触发合规红线校验,已隐去;待持牌顾问复核后由顾问当面提供。</div>
      ) : (
        <>
          <div style={styles.dir}>{item.coverageDirection}</div>
          <div style={styles.products}>
            推荐保司:
            <strong title={insurerTooltip(item.recommendedProducts)}>
              {item.recommendedProducts.map((r) => r.insurer).join('、') || '—'}
            </strong>
          </div>
          <div style={styles.price}>{item.pricing.display}</div>
          {/* 护栏文案:固定可见、不折叠(双版一致) */}
          <div style={styles.priceNote}>{item.pricing.disclaimer}</div>

          {item.degraded && item.degradedReason && <div style={styles.degradedReason}>{item.degradedReason}</div>}

          <button className="no-print" style={styles.moreBtn} type="button" onClick={onToggle}>
            {open ? '收起明细 ▴' : '查看明细(保司 / 条款 / 依据)▾'}
          </button>

          <div className={`drilldown${open ? ' open' : ''}`}>
            {item.rationale && (
              <p style={styles.dP}>
                <strong>推荐理由:</strong>
                {item.rationale}
              </p>
            )}

            {/* 理由锚点 chips(可选;缺省不渲染) */}
            <RationaleDrivers drivers={item.rationaleDrivers} />

            <KeyClausesBlock item={item} advisor={advisor} />

            {item.gapTitles.length > 0 && (
              <p style={styles.dP}>
                <strong>触发缺口:</strong>
                {item.gapTitles.join('、')}
              </p>
            )}

            <InsurerList products={item.recommendedProducts} drilldownSourceFile={item.drilldownSourceFile} />

            {item.citations.length > 0 && (
              <div style={styles.dP}>
                <strong>条款依据来源:</strong>
                <ul style={styles.ul}>
                  {item.citations.slice(0, 5).map((c, i) => (
                    <li key={i}>
                      {c.docCategory} · {c.sourceFile}
                      {c.headingPath.length ? ` · ${c.headingPath.join(' > ')}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {item.evidenceInsufficient && (
              <p style={{ ...styles.dP, color: '#b54708' }}>该险种检索证据不足,建议由持牌顾问补充评估。</p>
            )}

            {/* TODO(backend): 「重写这一条」需要后端逐条重写端点(当前不存在),暂不提供,避免伪造。 */}

            {advisor && <AdvisorDetail item={item} />}
          </div>
        </>
      )}
    </div>
  );
}

/** 理由锚点 chips:把 rationale 落到具体缺口/画像/条款;缺省不渲染 */
function RationaleDrivers({ drivers }: { drivers?: RationaleDriver[] }): React.ReactElement | null {
  if (!drivers || drivers.length === 0) return null;
  const chips: { kind: string; text: string; color: string; bg: string }[] = [];
  for (const d of drivers) {
    if (d.gap) chips.push({ kind: '缺口', text: d.gap, color: '#b42318', bg: '#fef3f2' });
    if (d.profile) chips.push({ kind: '画像', text: d.profile, color: '#6941c6', bg: '#f4f0ff' });
    if (d.clause) chips.push({ kind: '条款', text: d.clause, color: '#067647', bg: '#ecfdf3' });
  }
  if (chips.length === 0) return null;
  return (
    <div style={styles.driverRow}>
      {chips.map((c, i) => (
        <span key={i} style={{ ...styles.driverChip, color: c.color, background: c.bg }} title={`${c.kind}:${c.text}`}>
          {c.kind}:{c.text}
        </span>
      ))}
    </div>
  );
}

function insurerTooltip(products: RecommendedProduct[]): string | undefined {
  const withReason = products.filter((p) => p.matchReason);
  if (withReason.length === 0) return undefined;
  return withReason.map((p) => `${p.insurer}:${p.matchReason}`).join('\n');
}

/** 推荐保司明细:每家保司名 + 可选 matchReason(短句/悬浮);缺省只显示保司名(原行为) */
function InsurerList({
  products,
  drilldownSourceFile,
}: {
  products: RecommendedProduct[];
  drilldownSourceFile: string | null;
}): React.ReactElement {
  const anyReason = products.some((p) => p.matchReason);
  if (!anyReason) {
    return (
      <p style={styles.dP}>
        <strong>推荐保司:</strong>
        {products.map((r) => r.insurer).join('、') || '—'}
        {drilldownSourceFile ? ` · 完整价格表见 ${drilldownSourceFile}` : ''}
      </p>
    );
  }
  return (
    <div style={styles.dP}>
      <strong>推荐保司:</strong>
      <ul style={styles.ul}>
        {products.map((r, i) => (
          <li key={i}>
            {r.insurer}
            {r.matchReason && <span style={styles.matchReason}>· {r.matchReason}</span>}
          </li>
        ))}
      </ul>
      {drilldownSourceFile && <div style={styles.matchReason}>完整价格表见 {drilldownSourceFile}</div>}
    </div>
  );
}

/** 条款要点:有结构化(带忠实度四态 + 证据下钻)则用之,否则回退扁平 keyClauses(原行为) */
function KeyClausesBlock({ item, advisor }: { item: ProposalItem; advisor: boolean }): React.ReactElement | null {
  const detailed = item.keyClausesDetailed;
  if (detailed && detailed.length > 0) {
    return (
      <div style={styles.dP}>
        <strong>条款要点:</strong>
        <ul style={styles.ul}>
          {detailed.map((c, i) => (
            <ClauseItem key={i} clause={c} citations={item.citations} advisor={advisor} />
          ))}
        </ul>
      </div>
    );
  }
  if (item.keyClauses.length > 0) {
    return (
      <div style={styles.dP}>
        <strong>条款要点:</strong>
        <ul style={styles.ul}>
          {item.keyClauses.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }
  return null;
}

function ClauseItem({
  clause,
  citations,
  advisor,
}: {
  clause: KeyClauseDetailed;
  citations: Citation[];
  advisor: boolean;
}): React.ReactElement {
  const [showEv, setShowEv] = useState(false);
  const faith = clause.faithfulness ? FAITH_META[clause.faithfulness] : null;
  // 证据 chunkId 属"原始证据",仅顾问版下钻;客户版只保留条款文字 + 忠实度标记
  const hasEv = advisor && (clause.evidenceRefs?.length ?? 0) > 0;
  return (
    <li style={styles.clauseLi}>
      <span>{clause.text}</span>
      {clause.clauseType && <span style={styles.clauseType}>{clause.clauseType}</span>}
      {faith && (
        <span style={{ ...styles.faithTag, color: faith.color, background: faith.bg }} title={faith.title}>
          {faith.icon} {faith.label}
        </span>
      )}
      {hasEv && (
        <button type="button" className="no-print" style={styles.evBtn} onClick={() => setShowEv((v) => !v)}>
          证据 {clause.evidenceRefs.length}
          {showEv ? ' ▴' : ' ▾'}
        </button>
      )}
      {hasEv && showEv && (
        <div style={styles.evBox}>
          <div>引用原文块:{clause.evidenceRefs.join('、')}</div>
          {citations.length > 0 && (
            <div style={{ marginTop: 2 }}>对应来源见下方「条款依据来源」（{citations[0].sourceFile} 等）。</div>
          )}
        </div>
      )}
    </li>
  );
}

/** 顾问版:重写次数 / 模型调用数 / 采纳评分 / 逐轮评分卡——收在 details 里且不进打印 */
function AdvisorDetail({ item }: { item: ProposalItem }): React.ReactElement | null {
  const hasRev = typeof item.revisions === 'number';
  const hasCalls = typeof item.callsUsed === 'number';
  const hasCards = (item.scoreCards?.length ?? 0) > 0;
  if (!hasRev && !hasCalls && !hasCards) return null;
  const parts: string[] = [];
  if (hasRev) parts.push(`重写 ${item.revisions} 次`);
  if (hasCalls) parts.push(`模型调用 ${item.callsUsed} 次`);
  if (typeof item.qualityScore === 'number') parts.push(`采纳评分 ${item.qualityScore}`);
  return (
    <details className="no-print" style={styles.advisorDetail}>
      <summary style={styles.advisorSummary}>顾问版 · 生成过程</summary>
      <div style={styles.advisorBody}>
        {parts.length > 0 && <div>{parts.join(' · ')}</div>}
        {hasCards &&
          item.scoreCards!.map((sc, i) => (
            <div key={i} style={{ marginTop: 4 }}>
              第 {i + 1} 轮 · 加权 {sc.weightedScore} · {sc.verdict === 'pass' ? '通过' : '未通过'}
              {sc.gateFailed.length > 0 ? ` · 闸门未过:${sc.gateFailed.join('、')}` : ''}
            </div>
          ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 调参重生成抽屉(§7.5)——复用既有全量重生成路径(onRegenerate)
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
      <div style={styles.drawer} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="调整画像重新生成">
        <div style={styles.drawerTitle}>调整画像 · 重新生成</div>
        <div style={styles.drawerHint}>改动画像后将走与首次一致的完整重生成流程;上一版会在生成完成后自动对比新增/移除的险种。</div>

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

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100%', marginTop: 24 },
  head: { marginBottom: 12 },
  docName: { fontSize: 20, fontWeight: 900, color: 'var(--ink-900, #1a1a2e)' },
  company: { fontSize: 15, fontWeight: 700, color: 'var(--ink-700, #333)', marginTop: 4 },
  summary: { fontSize: 13, color: 'var(--fg3, #667)', marginTop: 6, lineHeight: 1.6 },

  portfolio: {
    marginBottom: 12,
    padding: '12px 14px',
    background: 'var(--soft, #f7f5f0)',
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 12,
  },
  portfolioTitle: { fontSize: 13, fontWeight: 800, color: 'var(--ink-900, #1a1a2e)', marginBottom: 6 },
  portfolioP: { fontSize: 13, lineHeight: 1.7, color: 'var(--fg2, #445)', margin: '4px 0' },
  overlap: { fontSize: 13, lineHeight: 1.7, color: '#b54708', margin: '2px 0' },
  bundle: { fontSize: 13, lineHeight: 1.7, color: 'var(--ink-700, #333)', margin: '2px 0' },

  degradedNote: {
    marginBottom: 12,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#b54708',
    background: '#fffaeb',
    border: '1px solid #fedf89',
    borderRadius: 12,
  },
  diffNote: {
    marginBottom: 12,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.7,
    color: '#067647',
    background: '#ecfdf3',
    border: '1px solid #abefc6',
    borderRadius: 12,
  },

  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 6,
    marginBottom: 12,
  },
  seg: { display: 'flex', alignItems: 'center', gap: 6 },
  segLabel: { fontSize: 12, color: 'var(--fg3, #889)' },
  segGroup: {
    display: 'inline-flex',
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segBtn: {
    padding: '5px 12px',
    fontSize: 12.5,
    fontWeight: 600,
    border: 'none',
    background: 'transparent',
    color: 'var(--ink-700, #333)',
    cursor: 'pointer',
  },
  segBtnActive: { background: 'var(--ui-primary, #1a1a2e)', color: '#fff' },
  filterChips: { display: 'flex', gap: 6 },
  filterChip: {
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 999,
    border: '1px solid var(--sand-300, #e7e2d6)',
    background: 'transparent',
    color: 'var(--ink-700, #333)',
    cursor: 'pointer',
  },
  filterChipActive: { borderColor: 'var(--ui-primary, #1a1a2e)', background: 'var(--soft, #f7f5f0)' },
  regenBtn: {
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid var(--sand-300, #e7e2d6)',
    background: 'var(--surface, #fff)',
    color: 'var(--ink-700, #333)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  printBtn: {
    padding: '8px 16px',
    borderRadius: 10,
    border: '1.5px solid var(--ui-primary, #1a1a2e)',
    background: 'var(--surface, #fff)',
    color: 'var(--ink-900, #1a1a2e)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  complianceLine: {
    marginBottom: 12,
    fontSize: 12.5,
    color: 'var(--fg3, #667)',
  },

  items: { display: 'flex', flexDirection: 'column', gap: 12 },

  tableWrap: { overflowX: 'auto', width: '100%' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '2px solid var(--sand-300, #e7e2d6)',
    color: 'var(--fg3, #667)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  thNum: {
    textAlign: 'center',
    padding: '8px 10px',
    borderBottom: '2px solid var(--sand-300, #e7e2d6)',
    color: 'var(--fg3, #667)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border, #eee)', verticalAlign: 'top' },
  tdName: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border, #eee)',
    fontWeight: 700,
    color: 'var(--ink-900, #1a1a2e)',
  },
  tdPrice: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border, #eee)',
    color: 'var(--ink-700, #333)',
    minWidth: 180,
  },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid var(--border, #eee)', textAlign: 'center' },
  pill: { fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' },
  emptyTable: { padding: '16px 0', fontSize: 13, color: 'var(--fg3, #889)' },

  card: {
    padding: '14px 16px',
    background: 'var(--surface, #fff)',
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 14,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  tier: { fontSize: 12, fontWeight: 800 },
  lineName: { fontSize: 16, fontWeight: 800, color: 'var(--ink-900, #1a1a2e)' },
  trustBadge: {
    fontSize: 11.5,
    fontWeight: 700,
    padding: '2px 9px',
    borderRadius: 999,
    border: '1px solid',
  },
  degradedChip: {
    fontSize: 11.5,
    fontWeight: 700,
    padding: '2px 9px',
    borderRadius: 999,
    border: '1px solid #fedf89',
    color: '#b54708',
    background: '#fffaeb',
  },
  redacted: {
    marginTop: 4,
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.7,
    color: 'var(--ink-700, #333)',
    background: 'var(--soft, #f7f5f0)',
    border: '1px dashed var(--sand-300, #e7e2d6)',
    borderRadius: 10,
  },
  dir: { fontSize: 14, lineHeight: 1.7, color: 'var(--fg2, #445)' },
  products: { marginTop: 8, fontSize: 13, color: 'var(--ink-700, #333)' },
  price: { marginTop: 8, fontSize: 14, fontWeight: 700, color: 'var(--ink-900, #1a1a2e)' },
  priceNote: { marginTop: 2, fontSize: 11.5, lineHeight: 1.6, color: 'var(--fg3, #889)' },
  degradedReason: { marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: '#b54708' },
  moreBtn: {
    marginTop: 10,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--sand-300, #e7e2d6)',
    background: 'transparent',
    color: 'var(--ink-700, #333)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
  dP: { fontSize: 13, lineHeight: 1.7, color: 'var(--fg2, #445)', margin: '6px 0' },
  ul: { margin: '4px 0 0', paddingLeft: 18 },

  driverRow: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' },
  driverChip: {
    fontSize: 11.5,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 999,
    cursor: 'default',
    lineHeight: 1.4,
  },
  matchReason: { marginLeft: 6, fontSize: 12, color: 'var(--fg3, #889)' },

  clauseLi: { margin: '4px 0', lineHeight: 1.7 },
  clauseType: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 6,
    color: 'var(--ink-700, #333)',
    background: 'var(--surface, #fff)',
    border: '1px solid var(--sand-300, #e7e2d6)',
  },
  faithTag: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: 700,
    padding: '1px 7px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  evBtn: {
    marginLeft: 6,
    padding: '0 6px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--ink-700, #333)',
    background: 'transparent',
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  evBox: {
    marginTop: 4,
    padding: '6px 10px',
    fontSize: 11.5,
    lineHeight: 1.6,
    color: 'var(--fg3, #667)',
    background: 'var(--surface, #fff)',
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 8,
  },
  advisorDetail: { marginTop: 8 },
  advisorSummary: { fontSize: 11.5, color: 'var(--fg3, #889)', cursor: 'pointer' },
  advisorBody: { marginTop: 4, fontSize: 11.5, color: 'var(--fg3, #889)' },
  disclaimer: {
    fontSize: 11.5,
    lineHeight: 1.7,
    color: 'var(--fg3, #889)',
    margin: '16px 0 0',
    padding: '12px 14px',
    background: 'var(--surface-soft, #faf9f6)',
    border: '1px solid var(--border, #eee)',
    borderRadius: 12,
  },
  foot: { fontSize: 11, color: 'var(--fg3, #99a)', marginTop: 10, textAlign: 'center' },

  drawerMask: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(20,20,30,0.35)',
    display: 'flex',
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  drawer: {
    width: 'min(420px, 92vw)',
    height: '100%',
    overflowY: 'auto',
    background: 'var(--surface, #fff)',
    padding: '20px 22px',
    boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  drawerTitle: { fontSize: 16, fontWeight: 800, color: 'var(--ink-900, #1a1a2e)' },
  drawerHint: { fontSize: 12, lineHeight: 1.6, color: 'var(--fg3, #889)' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink-700, #333)' },
  fieldInput: {
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid var(--sand-300, #e7e2d6)',
    borderRadius: 8,
    background: 'var(--surface, #fff)',
    color: 'var(--ink-900, #1a1a2e)',
  },
  drawerActions: { display: 'flex', gap: 10, marginTop: 8 },
  drawerCancel: {
    flex: 1,
    padding: '9px 14px',
    borderRadius: 10,
    border: '1px solid var(--sand-300, #e7e2d6)',
    background: 'transparent',
    color: 'var(--ink-700, #333)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  drawerSubmit: {
    flex: 2,
    padding: '9px 14px',
    borderRadius: 10,
    border: '1.5px solid var(--ui-primary, #1a1a2e)',
    background: 'var(--ui-primary, #1a1a2e)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
};
