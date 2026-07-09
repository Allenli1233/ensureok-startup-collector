/**
 * 报告 · 共享展示组件(暖纸浅底,BlockDetail 详情面板 + 打印附录复用)。
 *
 * 从旧版 ProposalView 移植的内容视图:对比表、组合说明、险种详情(方向/理由/条款三态/
 * 证据下钻/参考价位/推荐保司)。所有颜色走品牌暖陶令牌;绝不显示保费/成交数字(仅参考区间标签)。
 */
import React, { useMemo, useState } from 'react';
import type {
  Citation,
  KeyClauseDetailed,
  Portfolio,
  ProposalItem,
  RationaleDriver,
  RecommendedProduct,
} from './types';
import {
  FAITH_META,
  TIER_COLOR,
  TIER_LABEL,
  URGENCY_META,
  URGENCY_ORDER,
  portfolioRole,
  trustLevel,
} from './reportModel';

// ────────────────────────────────────────────────────────────────────────────
// 组合说明
// ────────────────────────────────────────────────────────────────────────────

export function PortfolioBlock({ portfolio }: { portfolio: Portfolio }): React.ReactElement | null {
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
// 险种对比表(次要 tab + 打印附录概览)
// ────────────────────────────────────────────────────────────────────────────

export function CompareTable({
  items,
  portfolio,
  advisor,
  onlyMandatory,
  hideDegraded,
  onPick,
}: {
  items: ProposalItem[];
  portfolio?: Portfolio;
  advisor: boolean;
  onlyMandatory: boolean;
  hideDegraded: boolean;
  /** 点某行 → 进该险种详情(可选;打印场景不传) */
  onPick?: (lineId: string) => void;
}): React.ReactElement {
  const rows = useMemo(() => {
    let list = items.slice();
    if (onlyMandatory) list = list.filter((i) => i.urgency === 'mandatory');
    if (hideDegraded) list = list.filter((i) => !i.degraded);
    const rank = (u: ProposalItem['urgency']) => URGENCY_ORDER.indexOf(u);
    list.sort((a, b) => rank(a.urgency) - rank(b.urgency));
    return list;
  }, [items, onlyMandatory, hideDegraded]);

  if (rows.length === 0) {
    // 区分两种空:本就无险种(诊断无缺口)vs 筛选后为空(仅屏幕有筛选 UI,打印附录无筛选)
    return (
      <div style={styles.emptyTable}>
        {items.length === 0 ? '按你提交的画像,暂未识别到需要展示的险种。' : '当前筛选下没有可展示的险种。'}
      </div>
    );
  }

  return (
    <div style={styles.tableWrap}>
      <table className="proposal-compare" style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>险种</th>
            <th style={styles.th}>紧迫度</th>
            <th style={styles.th}>层级</th>
            <th style={styles.th}>参考价位</th>
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
            const clickable = !!onPick;
            return (
              <tr
                key={item.lineId}
                className={clickable ? 'proposal-compare-row' : undefined}
                style={clickable ? styles.trClickable : undefined}
                onClick={clickable ? () => onPick!(item.lineId) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? 'button' : undefined}
                aria-label={clickable ? `查看 ${item.lineName} 详情` : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPick!(item.lineId);
                        }
                      }
                    : undefined
                }
              >
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
// 险种详情内容(BlockDetail 面板 + 打印附录复用)
// ────────────────────────────────────────────────────────────────────────────

export function LineDetailBody({ item, advisor }: { item: ProposalItem; advisor: boolean }): React.ReactElement {
  // 合规红线命中 → 内容已隐去,不编造内容
  const redacted = !!(item.complianceFlags && item.complianceFlags.length > 0);
  if (redacted) {
    return (
      <div style={styles.redacted}>
        该险种内容触发合规红线校验,已隐去;待持牌顾问复核后由顾问当面提供。
      </div>
    );
  }
  return (
    <div>
      <div style={styles.dir}>{item.coverageDirection}</div>

      <div style={styles.priceRow}>
        <span style={styles.priceLabel}>参考价位</span>
        <span style={styles.priceValue}>{item.pricing.unavailable ? '暂无参考区间' : item.pricing.display}</span>
      </div>
      {/* 护栏文案:固定可见、不折叠 */}
      <div style={styles.priceNote}>{item.pricing.disclaimer}</div>

      {item.degraded && item.degradedReason && <div style={styles.degradedReason}>{item.degradedReason}</div>}

      {item.rationale && (
        <p style={styles.dP}>
          <strong>推荐理由:</strong>
          {item.rationale}
        </p>
      )}

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

      {advisor && <AdvisorDetail item={item} />}
    </div>
  );
}

/** 理由锚点 chips:把 rationale 落到具体缺口/画像/条款;缺省不渲染 */
export function RationaleDrivers({ drivers }: { drivers?: RationaleDriver[] }): React.ReactElement | null {
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

/** 推荐保司明细:每家保司名 + 可选 matchReason */
export function InsurerList({
  products,
  drilldownSourceFile,
}: {
  products: RecommendedProduct[];
  drilldownSourceFile: string | null;
}): React.ReactElement {
  const anyReason = products.some((p) => p.matchReason);
  if (!anyReason) {
    return (
      <p style={styles.dP} title={insurerTooltip(products)}>
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

/** 条款要点:有结构化(带忠实度四态 + 证据下钻)则用之,否则回退扁平 keyClauses */
export function KeyClausesBlock({ item, advisor }: { item: ProposalItem; advisor: boolean }): React.ReactElement | null {
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
            <div style={{ marginTop: 2 }}>对应来源见「条款依据来源」（{citations[0].sourceFile} 等）。</div>
          )}
        </div>
      )}
    </li>
  );
}

/** 顾问版:重写次数 / 模型调用数 / 采纳评分 / 逐轮评分卡 */
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
    <details style={styles.advisorDetail}>
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
// 样式(暖纸浅底)
// ────────────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  portfolio: {
    marginBottom: 12,
    padding: '14px 16px',
    background: 'var(--surface-soft)',
    border: '1px solid var(--border-strong)',
    borderRadius: 14,
  },
  portfolioTitle: { fontSize: 13, fontWeight: 800, color: 'var(--ink-900)', marginBottom: 6, letterSpacing: '0.02em' },
  portfolioP: { fontSize: 13, lineHeight: 1.75, color: 'var(--fg2)', margin: '4px 0' },
  overlap: { fontSize: 13, lineHeight: 1.75, color: '#b54708', margin: '2px 0' },
  bundle: { fontSize: 13, lineHeight: 1.75, color: 'var(--ink-700)', margin: '2px 0' },

  tableWrap: { overflowX: 'auto', width: '100%' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' },
  th: {
    textAlign: 'left',
    padding: '9px 12px',
    borderBottom: '2px solid var(--border-strong)',
    color: 'var(--fg3)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  thNum: {
    textAlign: 'center',
    padding: '9px 12px',
    borderBottom: '2px solid var(--border-strong)',
    color: 'var(--fg3)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  td: { padding: '9px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
  trClickable: { cursor: 'pointer' },
  tdName: {
    padding: '9px 12px',
    borderBottom: '1px solid var(--border)',
    fontWeight: 700,
    color: 'var(--ink-900)',
  },
  tdPrice: {
    padding: '9px 12px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--ink-700)',
    minWidth: 180,
  },
  tdNum: {
    padding: '9px 12px',
    borderBottom: '1px solid var(--border)',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  pill: { fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap' },
  emptyTable: { padding: '18px 0', fontSize: 13, color: 'var(--fg3)' },

  redacted: {
    padding: '12px 14px',
    fontSize: 13,
    lineHeight: 1.75,
    color: 'var(--ink-700)',
    background: 'var(--surface-soft)',
    border: '1px dashed var(--border-strong)',
    borderRadius: 10,
  },
  dir: { fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink-800)' },
  priceRow: {
    marginTop: 14,
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    flexWrap: 'wrap',
  },
  priceLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--fg3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  priceValue: { fontSize: 14, fontWeight: 700, color: 'var(--ink-900)' },
  priceNote: { marginTop: 4, fontSize: 11.5, lineHeight: 1.6, color: 'var(--fg3)' },
  degradedReason: {
    marginTop: 8,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: '#b54708',
    background: '#fffaeb',
    border: '1px solid #fedf89',
    borderRadius: 8,
    padding: '8px 10px',
  },
  dP: { fontSize: 13.5, lineHeight: 1.75, color: 'var(--fg2)', margin: '10px 0' },
  ul: { margin: '4px 0 0', paddingLeft: 18 },
  driverRow: { display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' },
  driverChip: {
    fontSize: 11.5,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 999,
    cursor: 'default',
    lineHeight: 1.4,
  },
  matchReason: { marginLeft: 6, fontSize: 12, color: 'var(--fg3)' },
  clauseLi: { margin: '5px 0', lineHeight: 1.75 },
  clauseType: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 6,
    color: 'var(--ink-700)',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
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
    color: 'var(--ink-700)',
    background: 'transparent',
    border: '1px solid var(--border-strong)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  evBox: {
    marginTop: 4,
    padding: '6px 10px',
    fontSize: 11.5,
    lineHeight: 1.6,
    color: 'var(--fg3)',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 8,
  },
  advisorDetail: { marginTop: 12 },
  advisorSummary: { fontSize: 11.5, color: 'var(--fg3)', cursor: 'pointer' },
  advisorBody: { marginTop: 4, fontSize: 11.5, color: 'var(--fg3)' },
};
