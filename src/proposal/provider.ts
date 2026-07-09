import type { Proposal, ProposalRequest } from './types';
import { httpRequest } from './httpProvider';
import { mockRequest } from './mockProvider';

/**
 * 生成结果:方案本体 + taskId。
 * taskId 用于报告解读 chat(POST /agent/proposals/:id/chat);mock 模式下给一个占位 id
 * (无真实后端,chat 会优雅降级为「暂不可用」)。
 */
export interface ProposalResult {
  proposal: Proposal;
  taskId?: string;
}

export type ProposalProvider = (req: ProposalRequest) => Promise<ProposalResult>;

/**
 * 选方案提供方:VITE_PROPOSAL_PROVIDER=mock 用假数据(无后端可演示),否则走真实后端(默认)。
 * 这是"留给 Agent 的接口":真实生成由后端 @ensureok/agent 完成,前端一处切换。
 */
export function getProposalProvider(): ProposalProvider {
  const mode = (import.meta.env.VITE_PROPOSAL_PROVIDER as string | undefined) ?? 'http';
  if (mode === 'mock') {
    // mockRequest 仍返回裸 Proposal(其单测直接消费);在此包一层补 taskId 占位。
    return async (req) => ({ proposal: await mockRequest(req), taskId: `mock-${Date.now()}` });
  }
  return httpRequest;
}
