import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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
 * OpenAI 兼容嵌入(Bearer + /embeddings)。用 Node 内置 http/https 模块(非全局 fetch/undici)——
 * 避免"http 服务 + undici 出站请求"并发时的原生崩溃(实测 Node 24 下会崩)。
 * baseUrl 可指向 OpenAI 官方或大多数兼容中转;缺 /v1 会自动补。key 只在后端读入,绝不进前端。
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
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl ?? 'https://api.openai.com/v1');
    this.model = cfg.model ?? 'text-embedding-3-small';
    this.dimensions = cfg.dimensions ?? 1536;
    this.batchSize = cfg.batchSize ?? 64;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.maxRetries = cfg.maxRetries ?? 4;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...(await this.embedBatch(texts.slice(i, i + this.batchSize))));
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
      try {
        const res = await postJson(
          `${this.baseUrl}/embeddings`,
          { Authorization: `Bearer ${this.apiKey}` },
          body,
          this.timeoutMs,
        );
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`OpenAI embeddings HTTP ${res.status}: ${res.body.slice(0, 200)}`);
        }
        if (res.status >= 400) {
          throw new NonRetryableError(`OpenAI embeddings HTTP ${res.status}: ${res.body.slice(0, 300)}`);
        }
        if (!res.contentType.includes('json')) {
          throw new NonRetryableError(
            `OpenAI embeddings 返回非 JSON(content-type=${res.contentType || '未知'})。多半是 OPENAI_BASE_URL 配错(应指向 OpenAI 兼容 API 且含 /v1)。响应片段: ${res.body.slice(0, 160).replace(/\s+/g, ' ')}`,
          );
        }
        const json = JSON.parse(res.body) as EmbeddingResponse;
        return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      } catch (err) {
        lastErr = err;
        if (err instanceof NonRetryableError) throw err;
        if (attempt < this.maxRetries) await sleep(500 * 2 ** attempt);
      }
    }
    throw new Error(`OpenAI embeddings 失败(已重试 ${this.maxRetries} 次): ${String(lastErr)}`);
  }
}

class NonRetryableError extends Error {}

/** 归一化 base_url:去尾斜杠;若未以 /vN 结尾则补 /v1(容错用户少填 /v1) */
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
