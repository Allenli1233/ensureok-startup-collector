import { agentUrl } from '../api/config';
import type { Proposal, ProposalRequest } from './types';

const POLL_MS = 2500;
const MAX_WAIT_MS = 6 * 60 * 1000; // 7 险种串行经中转可能 2–3 分钟

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface CreateResp {
  taskId: string;
}
interface PollResp {
  status: 'pending' | 'running' | 'ready' | 'error';
  proposal?: Proposal;
  error?: { code: string; message: string };
}

/** 真实提供方(默认):POST 建任务 → 轮询到 ready。dev 走 /agent(vite proxy → 后端)。 */
export async function httpRequest(req: ProposalRequest): Promise<Proposal> {
  const create = await fetch(agentUrl('/agent/proposals'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!create.ok) throw new Error(`建任务失败(HTTP ${create.status})`);
  const { taskId } = (await create.json()) as CreateResp;
  if (!taskId) throw new Error('后端未返回 taskId');

  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    await sleep(POLL_MS);
    const r = await fetch(agentUrl(`/agent/proposals/${taskId}`));
    const d = (await r.json()) as PollResp;
    if (d.status === 'ready' && d.proposal) return d.proposal;
    if (d.status === 'error') throw new Error(d.error?.message ?? '方案生成失败');
    if (Date.now() > deadline) throw new Error('方案生成超时,请稍后重试');
  }
}
