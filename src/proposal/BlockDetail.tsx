/**
 * BlockDetail —— 点击 treemap 险种方块后的下钻详情(共享元素 zoom 过渡)。
 *
 * 覆盖层:暗色 backdrop + 暖纸详情面板;面板从被点方块位置 zoom 进场(transform-origin
 * 跟随方块中心,尊重 prefers-reduced-motion)。内容 = 该险种详情 + 该险种 chat(scope=lineId)。
 * Esc / 点 backdrop / 关闭按钮 返回 treemap。
 */
import React, { useEffect, useRef } from 'react';
import type { ProposalItem } from './types';
import { TIER_COLOR, TIER_LABEL, URGENCY_META, trustLevel } from './reportModel';
import { LineDetailBody } from './reportShared';
import { ReportChat } from './ReportChat';

export function BlockDetail({
  item,
  advisor,
  taskId,
  origin,
  onClose,
}: {
  item: ProposalItem;
  advisor: boolean;
  taskId: string | undefined;
  /** 被点方块中心的视口坐标(百分比),用于 zoom 的 transform-origin */
  origin?: { xPct: number; yPct: number };
  onClose: () => void;
}): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const u = URGENCY_META[item.urgency];
  const trust = typeof item.qualityScore === 'number' ? trustLevel(item.qualityScore) : null;

  // 进场:记住触发块,把焦点移入面板;卸载时归还焦点(仅挂载一次,避免父级重渲染反复抢焦点)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // Esc 关闭 + Tab 焦点环内循环(简易焦点陷阱)。onClose 变化只重挂监听,不抢焦点。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const originStyle: React.CSSProperties = origin
    ? { transformOrigin: `${origin.xPct}% ${origin.yPct}%` }
    : {};

  return (
    <div
      className="rv-detail-mask"
      style={maskStyle}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="rv-detail-panel"
        style={{ ...panelStyle, ...originStyle }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.lineName} · 险种详情`}
        tabIndex={-1}
      >
        <div style={panelHead}>
          <div style={headMain}>
            <div style={headTags}>
              <span style={{ ...urgencyPill, color: u.color }}>{u.label}</span>
              <span style={{ ...tierTag, color: TIER_COLOR[item.tier] }}>{TIER_LABEL[item.tier]}</span>
              {trust && (
                <span
                  style={{ ...trustPill, color: trust.color, background: trust.bg, borderColor: trust.border }}
                  title="内容可信度自评,是信任信号、不代表产品排名"
                >
                  可信度 {trust.label}
                  {advisor ? ` · ${item.qualityScore}` : ''}
                </span>
              )}
              {item.degraded && (
                <span style={degradedChip} title={item.degradedReason || '内容降级,待持牌顾问补充 / 核对'}>
                  待核
                </span>
              )}
            </div>
            <h2 style={lineName}>{item.lineName}</h2>
          </div>
          <button type="button" style={closeBtn} onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </div>

        <div style={panelBody}>
          <LineDetailBody item={item} advisor={advisor} />

          <div style={{ marginTop: 18 }}>
            <ReportChat
              taskId={taskId}
              scope={item.lineId}
              title={`就「${item.lineName}」提问`}
              intro="只解读这一个险种:可问它的保障方向、条款要点、参考区间为何如此。答案基于本报告与检索到的条款证据,不构成投保建议。"
              suggestions={['这个险种主要保什么?', '条款里有哪些要特别注意?']}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 样式 ──

const maskStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '24px 16px',
  overflowY: 'auto',
  background: 'rgba(24, 20, 17, 0.58)',
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
};

const panelStyle: React.CSSProperties = {
  width: 'min(680px, 100%)',
  margin: 'auto',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 18,
  boxShadow: '0 24px 70px rgba(30, 18, 10, 0.36)',
  outline: 'none',
  overflow: 'hidden',
};

const panelHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '18px 20px 14px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface-soft)',
};
const headMain: React.CSSProperties = { minWidth: 0 };
const headTags: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 };
const urgencyPill: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 800,
  padding: '2px 10px',
  borderRadius: 999,
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
};
const tierTag: React.CSSProperties = { fontSize: 12, fontWeight: 800 };
const trustPill: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: '2px 9px',
  borderRadius: 999,
  border: '1px solid',
};
const degradedChip: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: '2px 9px',
  borderRadius: 999,
  color: '#b54708',
  background: '#fffaeb',
  border: '1px solid #fedf89',
};
const lineName: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 900,
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
  color: 'var(--ink-900)',
  margin: 0,
};
const closeBtn: React.CSSProperties = {
  flexShrink: 0,
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 15,
  color: 'var(--fg2)',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 999,
  cursor: 'pointer',
  lineHeight: 1,
};
const panelBody: React.CSSProperties = { padding: '18px 20px 22px' };
