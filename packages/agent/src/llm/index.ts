import type { ChatProvider } from './types';
import { OpenAIChatProvider } from './openai';
import { StubChatProvider } from './stub';

export type {
  ChatProvider,
  ChatMessage,
  ChatCompleteOptions,
  ToolDef,
  ToolCall,
  AssistantTurn,
} from './types';
export { OpenAIChatProvider, type OpenAIChatConfig } from './openai';
export { StubChatProvider } from './stub';

type EnvLike = Record<string, string | undefined>;

/**
 * 按环境变量选对话后端:
 *   LLM_PROVIDER=openai|stub(缺省:有 OPENAI_API_KEY 则 openai,否则 stub)
 *   OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_CHAT_MODEL(兼容 baoduile 的 LLM_MODEL)
 */
export function createChatProvider(env: EnvLike = process.env): ChatProvider {
  const provider = env.LLM_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'stub');
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('LLM_PROVIDER=openai 需要在 .env 里设置 OPENAI_API_KEY');
    return new OpenAIChatProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_CHAT_MODEL ?? env.LLM_MODEL,
    });
  }
  if (provider === 'stub') return new StubChatProvider();
  throw new Error(`未知 LLM_PROVIDER: ${provider}`);
}
