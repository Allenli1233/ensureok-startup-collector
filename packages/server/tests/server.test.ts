import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import { JsonVectorStore, StubEmbeddingProvider, type EmbeddedChunk } from '@ensureok/rag';
import { StubChatProvider, type ProposalRequest } from '@ensureok/agent';
import { createServer, type ServerDeps } from '../src/server';

function makeCatalog(): ProductCatalog {
  return {
    lineId: 'employer_liability',
    lineName: '雇主责任险',
    sourceFile: '保险产品数据库/01-雇主责任险/雇主责任险产品数据.md',
    title: '雇主责任险产品数据',
    meta: { collectedAt: '2026年7月9日', sources: ['官网'], applicableScenario: '有员工企业' },
    insurers: ['中国人保', '平安'],
    sections: [
      {
        level: 3,
        heading: '2.1 人保',
        path: ['二、产品对比', '2.1 人保'],
        tables: [
          {
            contextPath: ['二、产品对比', '2.1 人保'],
            columns: ['职业类别', '10万'],
            rows: [['1-2类', '93元']],
            isPriceTable: true,
            insurers: ['中国人保'],
          },
        ],
      },
    ],
    priceTableCount: 1,
    hasPriceTable: true,
  };
}

async function makeStore(): Promise<JsonVectorStore> {
  const stub = new StubEmbeddingProvider();
  const chunks: EmbeddedChunk[] = [
    {
      id: 'c0',
      text: '雇主责任险 承保雇主对雇员工伤赔偿责任',
      vector: (await stub.embed(['雇主责任险 承保雇主对雇员工伤赔偿责任']))[0],
      meta: { sourceFile: '保险产品/雇主责任险/a.md', corpus: 'product', insuranceLine: '雇主责任险', docCategory: '法律法规', headingPath: [] },
    },
  ];
  return new JsonVectorStore({ model: stub.model, dimensions: stub.dimensions, builtWith: stub.id, chunks });
}

async function makeDeps(): Promise<ServerDeps> {
  return {
    catalogs: new Map<InsuranceLineId, ProductCatalog>([['employer_liability', makeCatalog()]]),
    ragStore: await makeStore(),
    embedding: new StubEmbeddingProvider(),
    chat: new StubChatProvider(),
    now: () => 'T',
  };
}

const req: ProposalRequest = {
  company: '测试公司',
  profile: { industry: 'SaaS' },
  diagnosis: {
    total: 1,
    mandatoryCount: 0,
    findings: [{ id: 'er', line: 'line_a', title: '雇主责任险未覆盖', desc: '', coverage: '雇主责任险', urgency: 'high' }],
  },
};

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

function listen(s: Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, () => resolve((s.address() as AddressInfo).port)));
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('agent server', () => {
  it('GET /health', async () => {
    server = createServer(await makeDeps());
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; catalogs: number };
    expect(j.ok).toBe(true);
    expect(j.catalogs).toBe(1);
  });

  it('POST 建任务 → 轮询 → ready(注入时钟透传)', async () => {
    server = createServer(await makeDeps());
    const port = await listen(server);
    const create = await fetch(`http://127.0.0.1:${port}/agent/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    expect(create.status).toBe(202);
    const created = (await create.json()) as { taskId: string; status: string };
    expect(created.status).toBe('pending');
    expect(created.taskId).toBeTruthy();

    let data: { status: string; proposal?: { items: unknown[]; meta: { generatedAt: string } } } = { status: '' };
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/agent/proposals/${created.taskId}`);
      data = (await r.json()) as typeof data;
      if (data.status === 'ready' || data.status === 'error') break;
      await sleep(25);
    }
    expect(data.status).toBe('ready');
    expect(data.proposal?.items.length).toBeGreaterThan(0);
    expect(data.proposal?.meta.generatedAt).toBe('T');
  });

  it('未知任务 → 404', async () => {
    server = createServer(await makeDeps());
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/agent/proposals/does-not-exist`);
    expect(r.status).toBe(404);
  });

  it('无效 body → 400', async () => {
    server = createServer(await makeDeps());
    const port = await listen(server);
    const r = await fetch(`http://127.0.0.1:${port}/agent/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 1 }),
    });
    expect(r.status).toBe(400);
  });
});
