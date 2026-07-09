import React, { useState } from 'react';
import './print.css';
import type {
  Citation,
  Faithfulness,
  KeyClauseDetailed,
  Portfolio,
  Proposal,
  ProposalItem,
  ProposalTier,
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

/** 忠实度三态展示(icon+文字双编码,色盲友好);待核=待顾问核对,非错误,文案安抚 */
const FAITH_META: Record<Faithfulness, { icon: string; label: string; color: string; bg: string; title: string }> = {
  entailed: { icon: '✓', label: '忠实', color: '#067647', bg: '#ecfdf3', title: '已核对到条款原文支撑' },
  unverified: { icon: '⚠', label: '待核', color: '#b54708', bg: '#fffaeb', title: '待持牌顾问核对确认,并非错误' },
  'not-supported': { icon: '✗', label: '无支撑', color: '#b42318', bg: '#fef3f2', title: '暂未检索到条款支撑,已交顾问复核' },
  contradicted: { icon: '✗', label: '无支撑', color: '#b42318', bg: '#fef3f2', title: '与条款不一致,已交顾问复核' },
};

/** 可信度分档(信任信号,不排名):≥85 高 / ≥70 中 / 其余 低 */
function trustLevel(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 85) return { label: '高', color: '#067647', bg: '#ecfdf3', border: '#abefc6' };
  if (score >= 70) return { label: '中', color: '#b54708', bg: '#fffaeb', border: '#fedf89' };
  return { label: '低', color: '#b42318', bg: '#fef3f2', border: '#fecdca' };
}

export function ProposalView({ proposal }: { proposal: Proposal }): React.ReactElement {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  // ready_degraded:诚实优先——有降级/待核项就如实提示,不隐藏
  const degradedCount = proposal.items.filter((i) => i.degraded).length;

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

      <button className="no-print" style={styles.printBtn} type="button" onClick={() => window.print()}>
        导出 PDF / 打印
      </button>

      <div style={styles.items}>
        {proposal.items.map((item) => (
          <ItemCard key={item.lineId} item={item} open={!!open[item.lineId]} onToggle={() => toggle(item.lineId)} />
        ))}
      </div>

      <p style={styles.disclaimer}>{proposal.disclaimer}</p>
      <div style={styles.foot}>
        生成引擎 {proposal.meta.engine} · 模型 {proposal.meta.llmModel} · {proposal.meta.generatedAt.slice(0, 10)}
      </div>
    </div>
  );
}

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

function ItemCard({ item, open, onToggle }: { item: ProposalItem; open: boolean; onToggle: () => void }): React.ReactElement {
  // 合规红线命中 → 内容已隐去,不编造内容
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
            可信度 {trust.label} · {item.qualityScore}
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
            推荐保司:<strong>{item.recommendedProducts.map((r) => r.insurer).join('、') || '—'}</strong>
          </div>
          <div style={styles.price}>{item.pricing.display}</div>
          {/* 护栏文案:固定可见、不折叠 */}
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

            <KeyClausesBlock item={item} />

            {item.gapTitles.length > 0 && (
              <p style={styles.dP}>
                <strong>触发缺口:</strong>
                {item.gapTitles.join('、')}
              </p>
            )}
            <p style={styles.dP}>
              <strong>推荐保司:</strong>
              {item.recommendedProducts.map((r) => r.insurer).join('、') || '—'}
              {item.drilldownSourceFile ? ` · 完整价格表见 ${item.drilldownSourceFile}` : ''}
            </p>
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

            <AdvisorDetail item={item} />
          </div>
        </>
      )}
    </div>
  );
}

/** 条款要点:有结构化(带忠实度三态 + 证据下钻)则用之,否则回退扁平 keyClauses(原行为) */
function KeyClausesBlock({ item }: { item: ProposalItem }): React.ReactElement | null {
  const detailed = item.keyClausesDetailed;
  if (detailed && detailed.length > 0) {
    return (
      <div style={styles.dP}>
        <strong>条款要点:</strong>
        <ul style={styles.ul}>
          {detailed.map((c, i) => (
            <ClauseItem key={i} clause={c} citations={item.citations} />
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

function ClauseItem({ clause, citations }: { clause: KeyClauseDetailed; citations: Citation[] }): React.ReactElement {
  const [showEv, setShowEv] = useState(false);
  const faith = clause.faithfulness ? FAITH_META[clause.faithfulness] : null;
  const hasEv = (clause.evidenceRefs?.length ?? 0) > 0;
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

/** 顾问版/调试可观测信息:重写次数、模型调用数——不对客户显眼,收在 details 里且不进打印 */
function AdvisorDetail({ item }: { item: ProposalItem }): React.ReactElement | null {
  const hasRev = typeof item.revisions === 'number';
  const hasCalls = typeof item.callsUsed === 'number';
  if (!hasRev && !hasCalls) return null;
  const parts: string[] = [];
  if (hasRev) parts.push(`重写 ${item.revisions} 次`);
  if (hasCalls) parts.push(`模型调用 ${item.callsUsed} 次`);
  if (typeof item.qualityScore === 'number') parts.push(`采纳评分 ${item.qualityScore}`);
  return (
    <details className="no-print" style={styles.advisorDetail}>
      <summary style={styles.advisorSummary}>顾问版 · 生成过程</summary>
      <div style={styles.advisorBody}>{parts.join(' · ')}</div>
    </details>
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

  printBtn: {
    marginTop: 6,
    marginBottom: 12,
    padding: '9px 16px',
    borderRadius: 10,
    border: '1.5px solid var(--ui-primary, #1a1a2e)',
    background: 'var(--surface, #fff)',
    color: 'var(--ink-900, #1a1a2e)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  items: { display: 'flex', flexDirection: 'column', gap: 12 },
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
};
