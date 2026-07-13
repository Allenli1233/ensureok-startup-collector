import type { Proposal, ProposalRequest } from './types';
import { httpRequest } from './httpProvider';

/**
 * 生成结果:方案本体 + taskId。
 * taskId 用于报告解读 chat(POST /agent/proposals/:id/chat)。
 */
export interface ProposalResult {
  proposal: Proposal;
  taskId?: string;
}

export type ProposalProvider = (req: ProposalRequest) => Promise<ProposalResult>;

/**
 * 报告只允许来自真实后端 @ensureok/agent。
 * mockProvider 仅保留给组件测试和离线样例,不能再进入用户报告链路。
 */
export function getProposalProvider(): ProposalProvider {
  return httpRequest;
}
