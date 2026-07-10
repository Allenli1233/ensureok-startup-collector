/** OpenAI 兼容的工具调用(function calling)。arguments 是 JSON 字符串(OpenAI 原样透传)。 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 请求调工具时出现(字段名对齐 OpenAI 线格式) */
  tool_calls?: ToolCall[];
  /** role:'tool' 回填工具结果时指向哪次调用 */
  tool_call_id?: string;
}

/** 工具定义(OpenAI function schema 形态) */
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatCompleteOptions {
  temperature?: number;
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** 单次覆盖模型(如 chat 用更快的小模型);缺省用 provider 构造时的 model */
  model?: string;
  /** 输出上限:短答复设小值可显著提速(模型更早停) */
  maxTokens?: number;
}

/** 一次 assistant 回合:纯文本 + 可能的工具调用 + 结束原因 */
export interface AssistantTurn {
  content: string;
  toolCalls: ToolCall[];
  /** 'stop' | 'tool_calls' | 'length' | ... */
  finishReason: string;
}

/** 对话补全后端(OpenAI / stub 可插拔) */
export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  /** 纯文本补全(judge/兜底/revise 复用,行为不变) */
  complete(messages: ChatMessage[], opts?: ChatCompleteOptions): Promise<string>;
  /** 带工具的补全:返回结构化回合(含 toolCalls),供 tool-calling 循环使用 */
  completeWithTools(messages: ChatMessage[], opts?: ChatCompleteOptions): Promise<AssistantTurn>;
}
