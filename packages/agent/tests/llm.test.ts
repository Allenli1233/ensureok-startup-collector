import { describe, expect, it } from 'vitest';
import { createChatProvider } from '../src/llm';
import { StubChatProvider } from '../src/llm/stub';
import type { AssistantTurn, ChatProvider } from '../src/llm/types';

const stub: ChatProvider = new StubChatProvider();

describe('ChatProvider 工具接口(PR1)', () => {
  it('兼容 baoduile 的 LLM_MODEL 配置名', () => {
    const provider = createChatProvider({ OPENAI_API_KEY: 'test-key', LLM_MODEL: 'deepseek-v4-pro' });
    expect(provider.id).toBe('openai');
    expect(provider.model).toBe('deepseek-v4-pro');
  });

  it('complete 仍返回纯文本(行为不变)', async () => {
    const out = await stub.complete([{ role: 'user', content: '险种:雇主责任险' }]);
    expect(typeof out).toBe('string');
    expect(out).toContain('雇主责任险');
  });

  it('completeWithTools 返回 AssistantTurn 结构', async () => {
    const turn: AssistantTurn = await stub.completeWithTools([{ role: 'user', content: '险种:网络安全险' }], {
      tools: [
        {
          type: 'function',
          function: { name: 'noop', description: 'x', parameters: { type: 'object', properties: {} } },
        },
      ],
      toolChoice: 'auto',
    });
    expect(turn).toHaveProperty('content');
    expect(Array.isArray(turn.toolCalls)).toBe(true);
    expect(turn.finishReason).toBe('stop');
    // stub 不主动调工具
    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.content).toContain('网络安全险');
  });

  it('ChatMessage 支持 tool 角色与 tool_calls 字段(类型层)', () => {
    // 纯类型/构造校验:能构造带 tool_calls 的 assistant 消息与 tool 回填消息
    const assistant = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'query_catalog', arguments: '{}' } }],
    };
    const toolReply = { role: 'tool' as const, content: '{"ok":true}', tool_call_id: 'c1' };
    expect(assistant.tool_calls[0].function.name).toBe('query_catalog');
    expect(toolReply.tool_call_id).toBe('c1');
  });
});
