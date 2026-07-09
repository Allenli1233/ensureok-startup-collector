import type { ChatCompleteOptions, ChatMessage, ChatProvider } from './types';

export interface OpenAIChatConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface ChatResponse {
  choices: Array<{ message?: { content?: string } }>;
}

/**
 * OpenAI 兼容对话补全(Bearer + /chat/completions,原生 fetch 无 SDK)。
 * 不用 response_format(部分中转/模型不支持),靠提示词约束 JSON,由管道侧宽松解析。
 * key 只在后端从环境读入,绝不进前端。
 */
export class OpenAIChatProvider implements ChatProvider {
  readonly id = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(cfg: OpenAIChatConfig) {
    if (!cfg.apiKey) throw new Error('OpenAIChatProvider 需要 apiKey');
    this.apiKey = cfg.apiKey;
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl ?? 'https://api.openai.com/v1');
    this.model = cfg.model ?? 'gpt-4o-mini';
    this.timeoutMs = cfg.timeoutMs ?? 60_000;
    this.maxRetries = cfg.maxRetries ?? 3;
  }

  async complete(messages: ChatMessage[], opts: ChatCompleteOptions = {}): Promise<string> {
    const body = JSON.stringify({ model: this.model, messages, temperature: opts.temperature ?? 0.2 });
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body,
          signal: ac.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`chat HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        if (!res.ok) {
          throw new NonRetryableError(`chat HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('json')) {
          const snippet = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
          throw new NonRetryableError(
            `chat 返回非 JSON(content-type=${ct || '未知'})。多半是 OPENAI_BASE_URL 配错(应含 /v1)。片段: ${snippet}`,
          );
        }
        const json = (await res.json()) as ChatResponse;
        return json.choices?.[0]?.message?.content ?? '';
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableError) throw err;
        if (attempt < this.maxRetries) await sleep(800 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`chat 失败(已重试 ${this.maxRetries} 次): ${String(lastErr)}`);
  }
}

class NonRetryableError extends Error {}

function normalizeBaseUrl(url: string): string {
  const u = url.replace(/\/+$/, '');
  return /\/v\d+$/.test(u) ? u : `${u}/v1`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
