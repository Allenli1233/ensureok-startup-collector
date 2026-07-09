import { useCallback, useState } from 'react';
import { getProposalProvider } from './provider';
import type { Proposal, ProposalRequest } from './types';

export interface ProposalState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  proposal?: Proposal;
  /** 报告解读 chat 用(POST /agent/proposals/:id/chat);mock 模式为占位 id */
  taskId?: string;
  error?: string;
}

/** 方案生成状态机:idle → loading → ready | error。start(req) 触发一次生成。 */
export function useProposal(): ProposalState & { start: (req: ProposalRequest) => Promise<void>; reset: () => void } {
  const [state, setState] = useState<ProposalState>({ status: 'idle' });

  const start = useCallback(async (req: ProposalRequest) => {
    setState({ status: 'loading' });
    try {
      const { proposal, taskId } = await getProposalProvider()(req);
      setState({ status: 'ready', proposal, taskId });
    } catch (e) {
      setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { ...state, start, reset };
}
