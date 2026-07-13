/** 风险热力图的二级详情：公司关联、逐项风险解释、保障与价格、专项问答。 */
import React, { useEffect, useRef } from 'react';
import type { Faithfulness, KeyClauseDetailed, ProposalItem } from './types';
import { ReportChatPanel } from './ReportChat';

const TIER_LABEL: Record<string, string> = { tier1: '核心', tier2: '重点', tier3: '补充', tier4: '可选' };
const URGENCY_LABEL: Record<string, string> = { mandatory: '强制', high: '高优先', advice: '建议' };
const PRIORITY_EXPLANATION: Record<string, string> = {
  mandatory: '这属于需要优先确认的责任底线。若没有妥善处理，可能带来合规责任、合同履约压力或直接财务支出。',
  high: '这项风险一旦发生，可能明显影响经营连续性、客户关系或现金流，建议尽快确认现有保障是否足够。',
  advice: '这项风险适合在核心保障稳定后补充完善，用于降低低频但可能造成持续影响的经营损失。',
};
const FAITH: Record<Faithfulness, { icon: string; label: string; cls: string }> = {
  entailed: { icon: '✓', label: '已确认', cls: 'ok' },
  unverified: { icon: '!', label: '需确认', cls: 'warn' },
  'not-supported': { icon: '×', label: '暂无依据', cls: 'bad' },
  contradicted: { icon: '×', label: '存在冲突', cls: 'bad' },
};

export function BlockDetailBody({
  item,
  company,
  taskId,
  onClose,
}: {
  item: ProposalItem;
  company?: string;
  taskId?: string;
  onClose: () => void;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      window.setTimeout(() => {
        const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-risk-trigger="true"]'))
          .find((element) => element.dataset.riskId === item.lineId);
        trigger?.focus();
      }, 0);
    };
  }, [item.lineId]);

  const clauses: KeyClauseDetailed[] = item.keyClausesDetailed?.length
    ? item.keyClausesDetailed
    : item.keyClauses.map((text) => ({ text, evidenceRefs: [] }));
  const companyName = company?.trim() || '贵司';
  const riskPoints = item.gapTitles.length > 0 ? item.gapTitles : [`${item.lineName}保障缺口`];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="rd" ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown}>
      <div className="rd-top">
        <div className="rd-titles">
          <span className={`rd-urg rd-urg-${item.urgency}`}>
            {URGENCY_LABEL[item.urgency]} / {TIER_LABEL[item.tier] ?? item.tier}
          </span>
          <h2 className="rd-name">{item.lineName}</h2>
          <p className="rd-subtitle">面向 {companyName} 的风险说明与保障建议</p>
        </div>
        <button type="button" className="rd-close" onClick={onClose} aria-label="返回风险热力图">
          返回热力图
        </button>
      </div>

      <div className="rd-scroll">
        <nav className="rd-jump" aria-label="风险详情导航">
          <a href="#rd-company">公司关联</a>
          <a href="#rd-risk">风险详解</a>
          <a href="#rd-cover">保障与价格</a>
        </nav>

        <section id="rd-company" className="rd-sec rd-explain-card">
          <span className="rd-step" aria-hidden="true">01</span>
          <h3 className="rd-section-title">为什么与 {companyName} 有关</h3>
          <p className="rd-rat">
            {item.rationale || `结合${companyName}当前画像，${item.lineName}与现阶段经营活动存在直接关联，需要进一步确认实际暴露和现有保障。`}
          </p>

          <div className="rd-subsection">
            <h4>已识别的公司风险点</h4>
            <ol className="rd-risk-index">
              {riskPoints.map((gap, index) => (
                <li key={`${gap}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{gap}</strong>
                </li>
              ))}
            </ol>
          </div>

          {item.rationaleDrivers?.length ? (
            <div className="rd-chips" aria-label="公司关联依据">
              {item.rationaleDrivers.map((driver, index) => {
                const text = driver.gap
                  ? `保障缺口：${driver.gap}`
                  : driver.profile
                    ? `企业画像：${driver.profile}`
                    : driver.clause
                      ? `条款依据：${driver.clause}`
                      : '';
                return text ? <span key={index} className="rd-chip">{text}</span> : null;
              })}
            </div>
          ) : null}
        </section>

        <section id="rd-risk" className="rd-sec rd-explain-card">
          <span className="rd-step" aria-hidden="true">02</span>
          <h3 className="rd-section-title">风险详细解释</h3>
          <p className="rd-priority-copy">{PRIORITY_EXPLANATION[item.urgency] ?? PRIORITY_EXPLANATION.advice}</p>

          <div className="rd-subsection">
            <h4>风险点逐项说明</h4>
            <div className="rd-risk-details">
              {riskPoints.map((gap, index) => (
                <article key={`${gap}-detail-${index}`}>
                  <span className="rd-risk-number">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h5>{gap}</h5>
                    <p>该风险点已进入本次保障缺口。需要核实现有合同、保险安排与业务流程是否覆盖，并确认责任触发条件、赔偿限额、免赔和除外约定。</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {clauses.length > 0 && (
            <div className="rd-clause-block">
              <h4>重点核对事项</h4>
              <ul className="rd-clauses">
                {clauses.map((clause, index) => {
                  const faith = clause.faithfulness ? FAITH[clause.faithfulness] : null;
                  return (
                    <li key={index} className="rd-clause">
                      {faith && (
                        <span className={`rd-faith rd-faith-${faith.cls}`}>
                          <span aria-hidden="true">{faith.icon}</span>
                          {faith.label}
                        </span>
                      )}
                      <span className="rd-clause-text">{clause.text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section id="rd-cover" className="rd-sec rd-cover-card">
          <span className="rd-step" aria-hidden="true">03</span>
          <h3 className="rd-section-title">保障方案与价格</h3>
          <div className="rd-cover-direction">
            <h4>建议保障方向</h4>
            <p className="rd-cover">{item.coverageDirection || `${item.lineName}需要结合实际业务场景确认责任范围和保障结构。`}</p>
          </div>
          <div className="rd-grid2">
            <div>
              <span className="rd-lab">参考价格</span>
              <p className="rd-price">{item.pricing.display || '参考区间待下钻'}</p>
              <p className="rd-price-note">{item.pricing.disclaimer || '以保司实际报价为准，非成交报价。'}</p>
            </div>
            {item.recommendedProducts.length > 0 && (
              <div>
                <span className="rd-lab">产品库在售保司</span>
                <ul className="rd-insurers">
                  {item.recommendedProducts.map((product, index) => (
                    <li key={index} className="rd-insurer">
                      <span className="rd-insurer-name">{product.insurer}</span>
                      {product.matchReason && <span className="rd-insurer-why">{product.matchReason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <div className="rd-chat">
          <ReportChatPanel taskId={taskId} scope={item.lineId} title={`继续询问「${item.lineName}」`} />
        </div>
      </div>
    </div>
  );
}
