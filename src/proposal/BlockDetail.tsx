/**
 * BlockDetailBody —— treemap 险种方块 zoom 进来后的详情内容(外层 motion 共享元素由 ReportPage 提供)。
 * 内容:承保方向 / 推荐理由(+锚点)/ 条款忠实度三态 / 参考价位(仅区间标签,无金额数字) /
 *       推荐保司+匹配理由 / 该险种 chat(scope=lineId)。焦点管理与 Esc 由 ReportPage 统管。
 */
import React, { useEffect, useRef } from 'react';
import type { Faithfulness, KeyClauseDetailed, ProposalItem } from './types';
import { ReportChatPanel } from './ReportChat';

const TIER_LABEL: Record<string, string> = { tier1: '核心', tier2: '重点', tier3: '补充', tier4: '可选' };
const URGENCY_LABEL: Record<string, string> = { mandatory: '强制', high: '高优先', advice: '建议' };
const FAITH: Record<Faithfulness, { icon: string; label: string; cls: string }> = {
  entailed: { icon: '✓', label: '忠实', cls: 'ok' },
  unverified: { icon: '⚠', label: '待核', cls: 'warn' },
  'not-supported': { icon: '✗', label: '无支撑', cls: 'bad' },
  contradicted: { icon: '✗', label: '讲反', cls: 'bad' },
};

export function BlockDetailBody({
  item,
  taskId,
  onClose,
}: {
  item: ProposalItem;
  taskId?: string;
  onClose: () => void;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const clauses: KeyClauseDetailed[] = item.keyClausesDetailed?.length
    ? item.keyClausesDetailed
    : item.keyClauses.map((text) => ({ text, evidenceRefs: [] }));

  return (
    <div className="rd" ref={panelRef} tabIndex={-1}>
      <div className="rd-top">
        <div className="rd-titles">
          <span className={`rd-urg rd-urg-${item.urgency}`}>{URGENCY_LABEL[item.urgency]} · {TIER_LABEL[item.tier] ?? item.tier}</span>
          <h2 className="rd-name">{item.lineName}</h2>
        </div>
        <button type="button" className="rd-close" onClick={onClose} aria-label="返回 treemap">
          返回
        </button>
      </div>

      <div className="rd-scroll">
        <section className="rd-sec">
          <span className="rd-lab">承保方向</span>
          <p className="rd-cover">{item.coverageDirection || `${item.lineName}的方向性保障建议`}</p>
        </section>

        {item.rationale && (
          <section className="rd-sec">
            <span className="rd-lab">为什么推荐</span>
            <p className="rd-rat">{item.rationale}</p>
            {item.rationaleDrivers?.length ? (
              <div className="rd-chips">
                {item.rationaleDrivers.map((d, i) => {
                  const t = d.gap ? `缺口:${d.gap}` : d.profile ? `画像:${d.profile}` : d.clause ? `条款:${d.clause}` : '';
                  return t ? (
                    <span key={i} className="rd-chip">
                      {t}
                    </span>
                  ) : null;
                })}
              </div>
            ) : null}
          </section>
        )}

        {clauses.length > 0 && (
          <section className="rd-sec">
            <span className="rd-lab">条款要点</span>
            <ul className="rd-clauses">
              {clauses.map((c, i) => {
                const f = c.faithfulness ? FAITH[c.faithfulness] : null;
                return (
                  <li key={i} className="rd-clause">
                    {f && (
                      <span className={`rd-faith rd-faith-${f.cls}`}>
                        <span aria-hidden="true">{f.icon}</span>
                        {f.label}
                      </span>
                    )}
                    <span className="rd-clause-text">{c.text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rd-sec rd-grid2">
          <div>
            <span className="rd-lab">参考价位</span>
            <p className="rd-price">{item.pricing.display || '参考区间待下钻'}</p>
            <p className="rd-price-note">{item.pricing.disclaimer || '以保司实际报价为准,非成交报价。'}</p>
          </div>
          {item.recommendedProducts.length > 0 && (
            <div>
              <span className="rd-lab">产品库在售保司</span>
              <ul className="rd-insurers">
                {item.recommendedProducts.slice(0, 3).map((r, i) => (
                  <li key={i} className="rd-insurer">
                    <span className="rd-insurer-name">{r.insurer}</span>
                    {r.matchReason && <span className="rd-insurer-why">{r.matchReason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="rd-chat">
          <ReportChatPanel taskId={taskId} scope={item.lineId} title={`问「${item.lineName}」`} />
        </div>
      </div>
    </div>
  );
}
