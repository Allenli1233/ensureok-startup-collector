/**
 * 报告解读 Chat 面板(总览 scope='report' / 险种 scope=lineId 两处复用)。
 * 单轮无状态(后端不记历史);答不出的固定婉拒、免责、暂不可用都如实呈现。
 * 动画:消息以强 ease-out 进场;等待用打字点。尊重 prefers-reduced-motion。
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useReportChat, type ChatScope } from './useReportChat';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const SUGGESTIONS_REPORT = ['为什么是这几个险种?', '哪个最该先处理?'];
const SUGGESTIONS_LINE = ['这个险种主要保什么?', '为什么推荐它?'];

export function ReportChatPanel({
  taskId,
  scope,
  title,
  onClose,
}: {
  taskId?: string;
  scope: ChatScope;
  title: string;
  onClose?: () => void;
}): React.ReactElement {
  const reduce = useReducedMotion();
  const { messages, loading, ask } = useReportChat(taskId, scope);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [messages, loading, reduce]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setDraft('');
    void ask(q);
  };

  const suggestions = scope === 'report' ? SUGGESTIONS_REPORT : SUGGESTIONS_LINE;

  return (
    <section className="rc" aria-label={title}>
      <div className="rc-head">
        <span className="rc-title">{title}</span>
        {onClose && (
          <button type="button" className="rc-x" onClick={onClose} aria-label="收起">
            收起
          </button>
        )}
      </div>

      <div className="rc-stream" ref={scrollRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="rc-intro">
            <p>问一句,帮你读懂这份报告。只解读报告与条款,不做投保建议、不涉及价格。</p>
            <div className="rc-chips">
              {suggestions.map((s) => (
                <button key={s} type="button" className="rc-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              className={`rc-msg rc-${m.role}${m.unavailable || m.refused ? ' rc-soft' : ''}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0.15 : 0.24, ease: EASE_OUT }}
            >
              <p className="rc-text">{m.text}</p>
              {m.disclaimer ? <p className="rc-disc">{m.disclaimer}</p> : null}
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && (
          <div className="rc-msg rc-assistant">
            <span className={`rc-typing${reduce ? ' rc-typing-static' : ''}`} aria-label="思考中">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>

      <form
        className="rc-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className="rc-input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="问关于这份报告的问题…"
          aria-label="输入问题"
        />
        <button type="submit" className="rc-send" disabled={loading || !draft.trim()} aria-label="发送">
          发送
        </button>
      </form>
    </section>
  );
}
