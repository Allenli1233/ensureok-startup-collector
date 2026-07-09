import { randomUUID } from 'node:crypto';
import type { Proposal } from '@ensureok/agent';

export type JobStatus = 'pending' | 'running' | 'ready' | 'error';

export interface Job {
  taskId: string;
  status: JobStatus;
  proposal?: Proposal;
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
