import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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
 * OpenAI 兼容对话补全(Bearer + /chat/completions)。用 Node 内置 http/https(非全局 fetch/undici)——
 * 避免"http 服务 + undici 出站请求"并发时的原生崩溃。不用 response_format(部分中转不支持),
 * 靠提示词约束 JSON,由管道侧宽松解析。key 只在后端读入。
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
      try {
        const res = await postJson(
          `${this.baseUrl}/chat/completions`,
          { Authorization: `Bearer ${this.apiKey}` },
          body,
          this.timeoutMs,
        );
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`chat HTTP ${res.status}: ${res.body.slice(0, 200)}`);
        }
        if (res.status >= 400) {
          throw new NonRetryableError(`chat HTTP ${res.status}: ${res.body.slice(0, 300)}`);
        }
        if (!res.contentType.includes('json')) {
          throw new NonRetryableError(
            `chat 返回非 JSON(content-type=${res.contentType || '未知'})。多半是 OPENAI_BASE_URL 配错(应含 /v1)。片段: ${res.body.slice(0, 160).replace(/\s+/g, ' ')}`,
          );
        }
        const json = JSON.parse(res.body) as ChatResponse;
        return json.choices?.[0]?.message?.content ?? '';
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableError) throw err;
        if (attempt < this.maxRetries) await sleep(800 * 2 ** attempt);
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

interface HttpResult {
  status: number;
  body: string;
  contentType: string;
}

/** 用 node:http/https 发 POST JSON —— 不经全局 fetch(undici),规避与 http 服务并发的原生崩溃 */
function postJson(urlStr: string, headers: Record<string, string>, bodyStr: string, timeoutMs: number): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const doRequest = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = doRequest(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data, contentType: String(res.headers['content-type'] ?? '') }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.write(bodyStr);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
