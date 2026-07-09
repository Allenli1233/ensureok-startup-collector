/**
 * ReportChat —— 报告解读对话(总览 scope='report' / 险种详情 scope=lineId 两处复用)。
 *
 * 呈对话流,但每问独立(后端单轮无状态,D2)。展示 loading / 婉拒固定话术 / 免责串;
 * 缺后端或网络错误 → 优雅降级为「暂不可用」,不崩。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useReportChat, type ChatScope } from './useReportChat';

export function ReportChat({
  taskId,
  scope,
  title,
  intro,
  suggestions,
}: {
  taskId: string | undefined;
  scope: ChatScope;
  title: string;
  intro: string;
  suggestions?: string[];
}): React.ReactElement {
  const { messages, loading, ask } = useReportChat(taskId, scope);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // 新消息 / loading 变化时滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setDraft('');
    void ask(q);
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.head}>
        <span style={styles.title}>{title}</span>
        <span style={styles.hint}>每问独立解读</span>
      </div>

      <div ref={listRef} style={styles.list} aria-live="polite">
        {messages.length === 0 && (
          <div style={styles.empty}>
            <p style={styles.introP}>{intro}</p>
            {suggestions && suggestions.length > 0 && (
              <div style={styles.suggestRow}>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    style={styles.suggestChip}
                    onClick={() => send(s)}
                    disabled={loading}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} style={styles.userRow}>
              <div style={styles.userBubble}>{m.text}</div>
            </div>
          ) : (
            <div key={m.id} style={styles.aiRow}>
              <div style={{ ...styles.aiBubble, ...(m.unavailable ? styles.aiBubbleMuted : {}) }}>{m.text}</div>
              {m.disclaimer && <div style={styles.aiDisclaimer}>{m.disclaimer}</div>}
            </div>
          ),
        )}

        {loading && (
          <div style={styles.aiRow}>
            <div style={{ ...styles.aiBubble, ...styles.typing }} aria-label="正在解读…">
              <span className="rv-dot" style={styles.dot} />
              <span className="rv-dot" style={{ ...styles.dot, animationDelay: '150ms' }} />
              <span className="rv-dot" style={{ ...styles.dot, animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      <form
        style={styles.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          style={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="就这份报告提个问题…"
          aria-label="向报告解读员提问"
          enterKeyHint="send"
          spellCheck={false}
        />
        <button type="submit" style={styles.sendBtn} disabled={loading || !draft.trim()} aria-label="发送">
          发送
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 0,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '11px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface-soft)',
  },
  title: { fontSize: 13, fontWeight: 800, color: 'var(--ink-900)' },
  hint: { fontSize: 11, color: 'var(--fg3)' },
  list: {
    flex: 1,
    minHeight: 120,
    maxHeight: 340,
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  empty: { margin: 'auto 0' },
  introP: { fontSize: 12.5, lineHeight: 1.7, color: 'var(--fg3)', margin: '0 0 10px' },
  suggestRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  suggestChip: {
    padding: '6px 11px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ink-700)',
    background: 'var(--surface-soft)',
    border: '1px solid var(--border-strong)',
    borderRadius: 999,
    cursor: 'pointer',
    textAlign: 'left',
  },
  userRow: { display: 'flex', justifyContent: 'flex-end' },
  userBubble: {
    maxWidth: '82%',
    padding: '8px 12px',
    fontSize: 13,
    lineHeight: 1.65,
    color: 'var(--ui-primary-fg)',
    background: 'var(--ui-primary)',
    borderRadius: '13px 13px 3px 13px',
  },
  aiRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 },
  aiBubble: {
    maxWidth: '92%',
    padding: '9px 13px',
    fontSize: 13,
    lineHeight: 1.7,
    color: 'var(--ink-800)',
    background: 'var(--surface-soft)',
    border: '1px solid var(--border)',
    borderRadius: '13px 13px 13px 3px',
    whiteSpace: 'pre-wrap',
  },
  aiBubbleMuted: { color: 'var(--fg3)', fontStyle: 'italic' },
  aiDisclaimer: { fontSize: 10.5, lineHeight: 1.55, color: 'var(--fg3)', maxWidth: '92%', padding: '0 4px' },
  typing: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '11px 13px' },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: 'var(--clay-500)',
    display: 'inline-block',
    animation: 'rvTyping 1s ease-in-out infinite',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderTop: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '9px 12px',
    fontSize: 13,
    color: 'var(--fg1)',
    background: 'var(--surface)',
    border: '1px solid var(--border-strong)',
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'var(--font-sans)',
  },
  sendBtn: {
    flexShrink: 0,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--ui-primary-fg)',
    background: 'var(--ui-primary)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
  },
};
