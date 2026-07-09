import type { EmbeddingProvider } from '../types';
import { OpenAIEmbeddingProvider } from './openai';
import { StubEmbeddingProvider } from './stub';

export { OpenAIEmbeddingProvider, type OpenAIEmbeddingConfig } from './openai';
export { StubEmbeddingProvider } from './stub';

type EnvLike = Record<string, string | undefined>;

/**
 * 按环境变量选嵌入后端(唯一切换点):
 *   EMBEDDING_PROVIDER=openai|stub(缺省:有 OPENAI_API_KEY 则 openai,否则 stub)
 *   OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_EMBEDDING_MODEL / OPENAI_EMBEDDING_DIM
 * key 只从后端环境读入,绝不硬编码、绝不进前端。
 */
export function createEmbeddingProvider(env: EnvLike = process.env): EmbeddingProvider {
  const provider = env.EMBEDDING_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'stub');
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) {
      throw new Error('EMBEDDING_PROVIDER=openai 需要在 .env 里设置 OPENAI_API_KEY');
    }
    return new OpenAIEmbeddingProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_EMBEDDING_MODEL,
      dimensions: env.OPENAI_EMBEDDING_DIM ? Number(env.OPENAI_EMBEDDING_DIM) : undefined,
    });
  }
  if (provider === 'stub') return new StubEmbeddingProvider();
  throw new Error(`未知 EMBEDDING_PROVIDER: ${provider}`);
}
