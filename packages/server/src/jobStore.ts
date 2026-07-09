import { randomUUID } from 'node:crypto';
import type { Proposal, ProgressSnapshot } from '@ensureok/agent';

export type JobStatus = 'pending' | 'running' | 'ready' | 'error';

export interface Job {
  taskId: string;
  status: JobStatus;
  proposal?: Proposal;
  /** 分阶段进度(PR5b);前端轮询消费,无则退回转圈 */
  progress?: ProgressSnapshot;
  /** 报告 chat 已提问数(每任务软上限防滥用) */
  chatCount?: number;
  error?: { code: string; message: string };
  createdAt: string;
}

/**
 * 内存任务库(demo/单实例够用)。生产要换持久化 + TTL 清理(见设计 v3 §7)。
 */
export class JobStore {
  private jobs = new Map<string, Job>();

  create(createdAt: string): Job {
    const job: Job = { taskId: randomUUID(), status: 'pending', createdAt };
    this.jobs.set(job.taskId, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): void {
    const j = this.jobs.get(id);
    if (j) Object.assign(j, patch);
  }

  size(): number {
    return this.jobs.size;
  }
}
