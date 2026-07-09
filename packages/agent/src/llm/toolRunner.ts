import type { ToolInvoker } from '../tools/executor';
import type { ChatMessage, ChatProvider, ToolDef } from './types';

export interface ToolTrace {
  tool: string;
  args: string;
  ok: boolean;
}
export interface ToolLoopResult {
  content: string;
  steps: number;
  trace: ToolTrace[];
}

/**
 * pipeline 内 tool-calling 循环(§4.4):completeWithTools → 有 toolCalls 则并发执行、回填 tool 消息 → 再补全;
 * 无 toolCalls 即收敛;达 maxSteps(默认 6)强制不带 tools 收口一次。
 * Provider 保持"一回合"纯传输,循环逻辑在此可单测。中转不支持 function-calling 时,
 * completeWithTools 返回空 toolCalls → 首轮即收敛(等价单次生成),平滑退回。
 */
export async function runToolLoop(
  chat: ChatProvider,
  messages: ChatMessage[],
  tools: ToolDef[],
  invoke: ToolInvoker,
  opts: { maxSteps?: number; temperature?: number } = {},
): Promise<ToolLoopResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const convo: ChatMessage[] = [...messages];
  const trace: ToolTrace[] = [];

  for (let steps = 1; steps <= maxSteps; steps++) {
    const turn = await chat.completeWithTools(convo, { tools, temperature: opts.temperature, toolChoice: 'auto' });
    if (!turn.toolCalls.length) return { content: turn.content, steps, trace };

    convo.push({ role: 'assistant', content: turn.content, tool_calls: turn.toolCalls });
    // 同一回合的多个 tool_call 并发执行,顺序回填
    const results = await Promise.all(
      turn.toolCalls.map(async (call) => {
        const res = await invoke(call.function.name, call.function.arguments);
        trace.push({ tool: call.function.name, args: call.function.arguments, ok: res.ok });
        return { call, res };
      }),
    );
    for (const { call, res } of results) {
      convo.push({
        role: 'tool',
        tool_call_id: call.id,
        content: res.ok ? JSON.stringify(res.data) : JSON.stringify({ error: res.error, code: res.code }),
      });
    }
  }

  // 达 maxSteps → 强制不带 tools 收口一次(禁止再调工具)
  const final = await chat.completeWithTools(convo, { temperature: opts.temperature, toolChoice: 'none' });
  return { content: final.content, steps: maxSteps, trace };
}
