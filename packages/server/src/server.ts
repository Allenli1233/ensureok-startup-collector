import { createServer as httpCreateServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { answerQuestion, generateProposal, type GenerateDeps, type ProposalRequest, type QaScope } from '@ensureok/agent';
import { retrieve } from '@ensureok/rag';
import { JobStore } from './jobStore';

/** 单份报告 chat 提问软上限(防滥用/烧 key) */
const CHAT_CAP = 20;

/** 生成依赖(不含 generatedAt;每个任务生成时注入)+ 可注入的时钟(便于测试) */
export interface ServerDeps extends Omit<GenerateDeps, 'generatedAt'> {
  now?: () => string;
}

/**
 * 异步任务 API:
 *   POST /agent/proposals        → 202 { taskId, status }  然后后台跑生成
 *   GET  /agent/proposals/:id     → { taskId, status, proposal?, error? }
 *   GET  /health                  → { ok, catalogs, ragChunks }
 * key 只在后端;dev 由 vite proxy 转发,免 CORS。
 */
export function createServer(deps: ServerDeps): Server {
  const jobs = new JobStore();
  const now = deps.now ?? (() => new Date().toISOString());
  return httpCreateServer((req, res) => {
    void handle(req, res, deps, jobs, now);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  jobs: JobStore,
  now: () => string,
): Promise<void> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  try {
    if (method === 'GET' && url === '/health') {
      return json(res, 200, { ok: true, catalogs: deps.catalogs.size, ragChunks: deps.ragStore.size() });
    }

    if (method === 'POST' && url === '/agent/proposals') {
      const body = (await readJson(req)) as Partial<ProposalRequest> | null;
      if (!body || !body.diagnosis || !Array.isArray(body.diagnosis.findings)) {
        return json(res, 400, { error: { code: 'invalid_input', message: '缺少 diagnosis.findings' } });
      }
      const job = jobs.create(now());
      json(res, 202, { taskId: job.taskId, status: job.status });
      jobs.update(job.taskId, { status: 'running' });
      generateProposal(body as ProposalRequest, {
        ...deps,
        generatedAt: now(),
        onProgress: (snapshot) => jobs.update(job.taskId, { progress: snapshot }),
      })
        .then((proposal) => jobs.update(job.taskId, { status: 'ready', proposal }))
        .catch((e: unknown) =>
          jobs.update(job.taskId, { status: 'error', error: { code: 'generation_failed', message: String(e).slice(0, 300) } }),
        );
      return;
    }

    // 报告解读 chat(同步):POST /agent/proposals/:id/chat  body {scope:'report'|<lineId>, question}
    const chatM = /^\/agent\/proposals\/([\w-]+)\/chat$/.exec(url);
    if (method === 'POST' && chatM) {
      const job = jobs.get(chatM[1]);
      if (!job || job.status !== 'ready' || !job.proposal) {
        return json(res, 404, { error: { code: 'not_ready', message: '报告不存在或未就绪(可能已过期,请重新生成)' } });
      }
      const body = (await readJson(req)) as { scope?: string; question?: string } | null;
      const question = String(body?.question ?? '').trim();
      const scopeRaw = String(body?.scope ?? 'report');
      if (!question) return json(res, 400, { error: { code: 'invalid_input', message: '缺 question' } });
      if ((job.chatCount ?? 0) >= CHAT_CAP) {
        return json(res, 200, { answer: '本次报告咨询已达上限,如需深入建议由持牌经纪评估。', refused: true, disclaimer: '' });
      }
      jobs.update(job.taskId, { chatCount: (job.chatCount ?? 0) + 1 });

      let scope: QaScope;
      if (scopeRaw === 'report') {
        scope = { kind: 'report', proposal: job.proposal };
      } else {
        const item = job.proposal.items.find((i) => i.lineId === scopeRaw);
        if (!item) return json(res, 400, { error: { code: 'bad_scope', message: '未知险种' } });
        let evidence: Array<{ text: string; sourceFile: string }> = [];
        try {
          const chunks = await retrieve(deps.ragStore, deps.embedding, `${item.lineName} ${question}`, { insuranceLines: [item.lineName], topK: 4 });
          evidence = chunks.map((c) => ({ text: c.text, sourceFile: c.meta.sourceFile }));
        } catch {
          /* 无证据也能基于报告内容答 */
        }
        scope = { kind: 'line', proposal: job.proposal, lineId: scopeRaw, evidence };
      }
      const result = await answerQuestion(deps.chat, question, scope);
      return json(res, 200, result);
    }

    const m = /^\/agent\/proposals\/([\w-]+)$/.exec(url);
    if (method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return json(res, 404, { error: { code: 'not_found', message: '任务不存在' } });
      return json(res, 200, { taskId: job.taskId, status: job.status, progress: job.progress, proposal: job.proposal, error: job.error });
    }

    json(res, 404, { error: { code: 'not_found', message: 'route not found' } });
  } catch (e) {
    json(res, 500, { error: { code: 'server_error', message: String(e).slice(0, 300) } });
  }
}

function json(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e instanceof Error ? e : new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}
