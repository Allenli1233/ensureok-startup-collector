import type { EmbeddingProvider } from '../types';

export interface OpenAIEmbeddingConfig {
  apiKey: string;
  /** OpenAI 兼容 endpoint 基址;国内走中转/Azure兼容网关时改这里。默认 https://api.openai.com/v1 */
  baseUrl?: string;
  model?: string;
  /** text-embedding-3-* 支持降维;不传用模型默认 */
  dimensions?: number;
  batchSize?: number;
  /** 单请求超时(ms) */
  timeoutMs?: number;
  maxRetries?: number;
}

interface EmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

/**
 * OpenAI 兼容嵌入(Bearer + /embeddings)。用原生 fetch,无 SDK 依赖。
 * baseUrl 可指向 OpenAI 官方或大多数兼容中转;若用 Azure OpenAI(部署式路径 + api-key 头),需另配适配器。
 * key 只在后端从环境读入,绝不进前端产物。
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai';
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(cfg: OpenAIEmbeddingConfig) {
    if (!cfg.apiKey) throw new Error('OpenAIEmbeddingProvider 需要 apiKey');
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = cfg.model ?? 'text-embedding-3-small';
    this.dimensions = cfg.dimensions ?? 1536;
    this.batchSize = cfg.batchSize ?? 64;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.maxRetries = cfg.maxRetries ?? 4;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      out.push(...(await this.embedBatch(batch)));
    }
    return out;
  }

  private async embedBatch(batch: string[]): Promise<number[][]> {
    const body = JSON.stringify({
      model: this.model,
      input: batch,
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body,
          signal: ac.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`OpenAI embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        if (!res.ok) {
          // 4xx(非 429)通常不可重试(鉴权/参数错误),直接抛出
          throw new NonRetryableError(`OpenAI embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
        const json = (await res.json()) as EmbeddingResponse;
        return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableError) throw err;
        if (attempt < this.maxRetries) await sleep(500 * 2 ** attempt); // 固定指数退避
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`OpenAI embeddings 失败(已重试 ${this.maxRetries} 次): ${String(lastErr)}`);
  }
}

class NonRetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
