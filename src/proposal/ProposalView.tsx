import React, { useState } from 'react';
import './print.css';
import type { Proposal, ProposalItem, ProposalTier } from './types';

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

export function ProposalView({ proposal }: { proposal: Proposal }): React.ReactElement {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className="proposal-print" style={styles.root}>
      <div style={styles.head}>
        <div style={styles.docName}>{proposal.meta.documentName}</div>
        <div style={styles.company}>{proposal.meta.company}</div>
        <div style={styles.summary}>{proposal.clientSummary}</div>
      </div>

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

function ItemCard({ item, open, onToggle }: { item: ProposalItem; open: boolean; onToggle: () => void }): React.ReactElement {
  return (
    <div className="proposal-item" style={styles.card}>
      <div style={styles.cardHead}>
        <span style={{ ...styles.tier, color: TIER_COLOR[item.tier] }}>{TIER_LABEL[item.tier]}</span>
        <span style={styles.lineName}>{item.lineName}</span>
      </div>
      <div style={styles.dir}>{item.coverageDirection}</div>
      <div style={styles.products}>
        推荐保司:<strong>{item.recommendedProducts.map((r) => r.insurer).join('、') || '—'}</strong>
      </div>
      <div style={styles.price}>{item.pricing.display}</div>
      <div style={styles.priceNote}>{item.pricing.disclaimer}</div>

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
        {item.keyClauses.length > 0 && (
          <div style={styles.dP}>
            <strong>条款要点:</strong>
            <ul style={styles.ul}>
              {item.keyClauses.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
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
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { width: '100%', marginTop: 24 },
  head: { marginBottom: 12 },
  docName: { fontSize: 20, fontWeight: 900, color: 'var(--ink-900, #1a1a2e)' },
  company: { fontSize: 15, fontWeight: 700, color: 'var(--ink-700, #333)', marginTop: 4 },
  summary: { fontSize: 13, color: 'var(--fg3, #667)', marginTop: 6, lineHeight: 1.6 },
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
  dir: { fontSize: 14, lineHeight: 1.7, color: 'var(--fg2, #445)' },
  products: { marginTop: 8, fontSize: 13, color: 'var(--ink-700, #333)' },
  price: { marginTop: 8, fontSize: 14, fontWeight: 700, color: 'var(--ink-900, #1a1a2e)' },
  priceNote: { marginTop: 2, fontSize: 11.5, lineHeight: 1.6, color: 'var(--fg3, #889)' },
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
