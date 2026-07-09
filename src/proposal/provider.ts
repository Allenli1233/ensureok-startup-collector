import type { Proposal, ProposalRequest } from './types';
import { httpRequest } from './httpProvider';
import { mockRequest } from './mockProvider';

export type ProposalProvider = (req: ProposalRequest) => Promise<Proposal>;

/**
 * 选方案提供方:VITE_PROPOSAL_PROVIDER=mock 用假数据(无后端可演示),否则走真实后端(默认)。
 * 这是"留给 Agent 的接口":真实生成由后端 @ensureok/agent 完成,前端一处切换。
 */
export function getProposalProvider(): ProposalProvider {
  const mode = (import.meta.env.VITE_PROPOSAL_PROVIDER as string | undefined) ?? 'http';
  return mode === 'mock' ? mockRequest : httpRequest;
}
