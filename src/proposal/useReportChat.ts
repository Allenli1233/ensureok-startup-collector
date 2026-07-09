/**
 * 报告解读 Chat —— 前端 hook + 纯请求函数。
 *
 * 契约(后端 PR-A 已实现):POST /agent/proposals/:id/chat
 *   body { scope: 'report' | <lineId>, question }
 *   → { answer: string, refused: boolean, disclaimer: string }
 *
 * 设计(设计规格 §4.3 / D2):
 *   - 单轮无状态:每问独立 grounding,后端不记历史;前端只做「对话流」呈现。
 *   - 缺 taskId / 网络错误 / 端点缺失 → 优雅降级为「暂不可用」,绝不崩。
 *   - 软上限由后端判定(返回 refused 的固定话术),前端如实透传。
 */
import { useCallback, useRef, useState } from 'react';
import { agentUrl } from '../api/config';

export type ChatScope = 'report' | (string & {});

export interface ChatAnswer {
  answer: string;
  refused: boolean;
  disclaimer: string;
}

/** askReportQuestion 的结果:永不 throw,便于 UI 与单测处理。 */
export type AskResult =
  | ({ ok: true } & ChatAnswer)
  | { ok: false; message: string };

export const CHAT_UNAVAILABLE = '报告解读暂不可用,请稍后重试;如需深入,可由持牌经纪结合贵司情况评估。';

type FetchLike = typeof fetch;

/**
 * 纯请求:向后端问一个问题。fetchImpl 可注入(便于单测)。
 * 任何异常 / 非 2xx / 缺 taskId → { ok:false }(优雅降级),不抛错。
 */
export async function askReportQuestion(
  taskId: string | undefined,
  scope: ChatScope,
  question: string,
  fetchImpl?: FetchLike,
): Promise<AskResult> {
  const q = question.trim();
  if (!q) return { ok: false, message: '请输入问题' };
  if (!taskId) return { ok: false, message: CHAT_UNAVAILABLE };

  const doFetch: FetchLike = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (undefined as unknown as FetchLike));
  if (!doFetch) return { ok: false, message: CHAT_UNAVAILABLE };

  try {
    const res = await doFetch(agentUrl(`/agent/proposals/${encodeURIComponent(taskId)}/chat`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, question: q }),
    });
    if (!res.ok) return { ok: false, message: CHAT_UNAVAILABLE };
    const data = (await res.json()) as Partial<ChatAnswer> | null;
    if (!data || typeof data.answer !== 'string') return { ok: false, message: CHAT_UNAVAILABLE };
    return {
      ok: true,
      answer: data.answer,
      refused: !!data.refused,
      disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : '',
    };
  } catch {
    return { ok: false, message: CHAT_UNAVAILABLE };
  }
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** assistant 专属:婉拒态(固定话术)/ 免责串 / 降级(暂不可用) */
  refused?: boolean;
  disclaimer?: string;
  unavailable?: boolean;
}

export interface UseReportChat {
  messages: ChatMessage[];
  loading: boolean;
  /** 提一个问题(单轮独立)。空问题忽略。 */
  ask: (question: string) => Promise<void>;
  /** 清空本地对话流 */
  clear: () => void;
}

/**
 * 报告 chat hook。taskId 缺省时仍可用(所有提问优雅降级为「暂不可用」)。
 * fetchImpl 仅测试注入。
 */
export function useReportChat(taskId: string | undefined, scope: ChatScope, fetchImpl?: FetchLike): UseReportChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const idRef = useRef(0);
  const inFlight = useRef(false);
  const nextId = () => (idRef.current += 1);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || inFlight.current) return;
      inFlight.current = true;
      setMessages((m) => [...m, { id: nextId(), role: 'user', text: q }]);
      setLoading(true);
      const result = await askReportQuestion(taskId, scope, q, fetchImpl);
      setMessages((m) => [
        ...m,
        result.ok
          ? {
              id: nextId(),
              role: 'assistant',
              text: result.answer,
              refused: result.refused,
              disclaimer: result.disclaimer,
            }
          : { id: nextId(), role: 'assistant', text: result.message, unavailable: true },
      ]);
      setLoading(false);
      inFlight.current = false;
    },
    [taskId, scope, fetchImpl],
  );

  const clear = useCallback(() => setMessages([]), []);

  return { messages, loading, ask, clear };
}
