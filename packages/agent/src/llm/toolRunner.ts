import type { ToolInvoker } from '../tools/executor';
import type { ChatMessage, ChatProvider, ToolCall, ToolDef } from './types';

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

  // 达 maxSteps → 强制不带 tools 收口一次(禁止再调工具)。收口也是一次真实调用,故 steps=maxSteps+1
  const final = await chat.completeWithTools(convo, { temperature: opts.temperature, toolChoice: 'none' });
  return { content: final.content, steps: maxSteps + 1, trace };
}

/**
 * 伪工具协议解析(§11.1.1 L1):逐块**非贪婪**提取 `<<TOOL>>{"name","args"}<<END>>`。
 * 解析失败**显式打标 parseError,不静默吞**(否则退回短板 8)。供中转不支持原生 function-calling 时降级。
 */
export function parsePseudoToolCalls(content: string): { calls: ToolCall[]; parseError: boolean } {
  const re = /<<TOOL>>\s*([\s\S]*?)\s*<<END>>/g;
  const calls: ToolCall[] = [];
  let parseError = false;
  let m: RegExpExecArray | null;
  let i = 0;
  let matched = 0;
  while ((m = re.exec(content))) {
    matched++;
    try {
      const o = JSON.parse(m[1]) as { name?: unknown; args?: unknown };
      if (o && typeof o.name === 'string') {
        calls.push({ id: `pseudo_${i++}`, type: 'function', function: { name: o.name, arguments: JSON.stringify(o.args ?? {}) } });
      } else {
        parseError = true;
      }
    } catch {
      parseError = true;
    }
  }
  // 悬空 opener:<<TOOL>> 出现次数 > 完整闭合块数(截断/未闭合/被内嵌 <<END>> 截断)→ 显式打标,不静默(§11.1.1)
  if ((content.match(/<<TOOL>>/g) ?? []).length > matched) parseError = true;
  return { calls, parseError };
}

/**
 * 伪协议 tool-calling 循环:中转不支持原生 tools 时的降级路径。用 complete(纯文本)+ 伪块解析,
 * 逐块执行、以 <<TOOL_RESULT>> 回填,达 maxSteps 收口。parseError 透出供上层打标(不静默)。
 */
export async function runPseudoToolLoop(
  chat: ChatProvider,
  messages: ChatMessage[],
  tools: ToolDef[],
  invoke: ToolInvoker,
  opts: { maxSteps?: number; temperature?: number } = {},
): Promise<ToolLoopResult & { parseError: boolean }> {
  const maxSteps = opts.maxSteps ?? 6;
  const toolDoc = tools.map((t) => `- ${t.function.name}: ${t.function.description}`).join('\n');
  const convo: ChatMessage[] = [
    ...messages,
    {
      role: 'system',
      content: `如需调用工具,另起一行输出 <<TOOL>>{"name":"工具名","args":{...}}<<END>>(可多块,每块独立一行);不需要工具则正常作答。可用工具:\n${toolDoc}`,
    },
  ];
  const trace: ToolTrace[] = [];
  let anyParseError = false;

  for (let steps = 1; steps <= maxSteps; steps++) {
    const content = await chat.complete(convo, { temperature: opts.temperature });
    const { calls, parseError } = parsePseudoToolCalls(content);
    if (parseError) anyParseError = true;
    if (!calls.length) return { content, steps, trace, parseError: anyParseError };
    convo.push({ role: 'assistant', content });
    const results = await Promise.all(
      calls.map(async (c) => {
        const r = await invoke(c.function.name, c.function.arguments);
        trace.push({ tool: c.function.name, args: c.function.arguments, ok: r.ok });
        return { c, r };
      }),
    );
    for (const { c, r } of results) {
      convo.push({ role: 'user', content: `<<TOOL_RESULT ${c.function.name}>>${r.ok ? JSON.stringify(r.data) : JSON.stringify({ error: r.error })}<<END>>` });
    }
  }
  const final = await chat.complete(convo, { temperature: opts.temperature });
  return { content: final, steps: maxSteps + 1, trace, parseError: anyParseError };
}
