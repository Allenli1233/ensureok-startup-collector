import { describe, expect, it } from 'vitest';
import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import { JsonVectorStore, StubEmbeddingProvider, type EmbeddedChunk } from '@ensureok/rag';
import { StubChatProvider } from '../src/llm/stub';
import { StubJudge, softFail, softPass, type JudgeSoft } from '../src/judge';
import { generateProposal, type GenerateDeps } from '../src/pipeline';
import type { ChatProvider } from '../src/llm/types';
import type { ProposalRequest } from '../src/types';

function catalog(): ProductCatalog {
  return {
    lineId: 'employer_liability',
    lineName: '雇主责任险',
    sourceFile: '保险产品数据库/01-雇主责任险/雇主责任险产品数据.md',
    title: 'x',
    meta: { collectedAt: '2026年7月9日', sources: ['官网'], applicableScenario: 'x' },
    insurers: ['中国人保', '平安'],
    sections: [],
    priceTableCount: 0,
    hasPriceTable: false,
  };
}

async function store(): Promise<JsonVectorStore> {
  const s = new StubEmbeddingProvider();
  const chunks: EmbeddedChunk[] = [
    {
      id: 'c0',
      text: '雇主责任险 承保工伤赔偿',
      vector: (await s.embed(['雇主责任险 承保工伤赔偿']))[0],
      meta: { sourceFile: 'a.md', corpus: 'product', insuranceLine: '雇主责任险', docCategory: '法律法规', headingPath: [] },
    },
  ];
  return new JsonVectorStore({ model: s.model, dimensions: s.dimensions, builtWith: s.id, chunks });
}

const req: ProposalRequest = {
  company: '测试',
  profile: { industry: 'SaaS' },
  diagnosis: { total: 1, mandatoryCount: 0, findings: [{ id: 'er', line: 'line_a', title: '雇主责任险未覆盖', desc: '', coverage: '雇主责任险', urgency: 'high' }] },
};

async function deps(chat: ChatProvider, judgeScores?: JudgeSoft[]): Promise<GenerateDeps> {
  return {
    catalogs: new Map<InsuranceLineId, ProductCatalog>([['employer_liability', catalog()]]),
    ragStore: await store(),
    embedding: new StubEmbeddingProvider(),
    chat,
    judge: judgeScores ? new StubJudge(judgeScores) : undefined,
    loop: judgeScores ? { enabled: true, maxRevisions: 2 } : { enabled: false },
    generatedAt: 'T',
  };
}

function fixedChat(keyClauses: unknown): ChatProvider {
  return {
    id: 'fixed',
    model: 'fixed',
    async complete() {
      return JSON.stringify({ coverageDirection: '方向', rationale: '理由', keyClauses });
    },
    async completeWithTools() {
      return { content: '', toolCalls: [], finishReason: 'stop' };
    },
  };
}

describe('PR3 keyClauses 结构升级', () => {
  it('结构化 keyClauses:evidenceRefs 映射 E 标签 → 真实 chunkId', async () => {
    const chat = fixedChat([
      { text: '承保工伤赔偿', evidence: ['E1'], clauseType: '责任' },
      { text: '含上下班途中', evidence: ['E1', 'E9', '', 'zzz'] }, // E9/空/zzz 应剔除
    ]);
    const p = await generateProposal(req, await deps(chat));
    const it = p.items[0];
    expect(it.keyClausesDetailed).toHaveLength(2);
    expect(it.keyClausesDetailed?.[0].evidenceRefs).toEqual(['c0']);
    expect(it.keyClausesDetailed?.[0].clauseType).toBe('责任');
    expect(it.keyClausesDetailed?.[1].evidenceRefs).toEqual(['c0']); // 无效 ref 已丢弃
  });

  it('挂不存在/空 id 被丢弃,直接引 chunkId 亦可', async () => {
    const chat = fixedChat([{ text: '直接引 id', evidence: ['c0', 'nope', ''] }]);
    const p = await generateProposal(req, await deps(chat));
    expect(p.items[0].keyClausesDetailed?.[0].evidenceRefs).toEqual(['c0']);
  });

  it('向后兼容:纯字符串 keyClauses 仍可用,evidenceRefs 为空', async () => {
    const chat = fixedChat(['甲要点', '乙要点']);
    const p = await generateProposal(req, await deps(chat));
    expect(p.items[0].keyClausesDetailed).toEqual([
      { text: '甲要点', evidenceRefs: [] },
      { text: '乙要点', evidenceRefs: [] },
    ]);
  });

  it('扁平 keyClauses:string[] 契约不变,等于 detailed 的 text', async () => {
    const chat = fixedChat([
      { text: '要点一', evidence: ['E1'] },
      '要点二',
    ]);
    const p = await generateProposal(req, await deps(chat));
    expect(p.items[0].keyClauses).toEqual(['要点一', '要点二']);
  });

  it('条款要点最多保留 5 条,避免模型越界撑爆报告', async () => {
    const chat = fixedChat(Array.from({ length: 7 }, (_, i) => `要点${i + 1}`));
    const p = await generateProposal(req, await deps(chat));
    expect(p.items[0].keyClauses).toHaveLength(5);
  });

  it('callsUsed:统计本险种实际 LLM 调用数(loop 关时=1)', async () => {
    const chat = new StubChatProvider() as ChatProvider;
    const p = await generateProposal(req, await deps(chat));
    expect(p.items[0].callsUsed).toBe(1);
  });

  it('AI 首次返回非法 JSON 时重试一次,不静默生成占位报告', async () => {
    let calls = 0;
    const chat = fixedChat([]);
    chat.complete = async () => {
      calls++;
      return calls === 1
        ? 'not-json'
        : JSON.stringify({ coverageDirection: '有依据的保障方向', rationale: '与企业画像直接相关', keyClauses: [] });
    };
    const p = await generateProposal(req, await deps(chat));
    expect(calls).toBe(2);
    expect(p.items[0].coverageDirection).toBe('有依据的保障方向');
    expect(p.items[0].callsUsed).toBe(2);
  });

  it('AI 连续返回非法结果时让任务失败,不把模板冒充真实分析', async () => {
    const chat = fixedChat([]);
    chat.complete = async () => 'not-json';
    await expect(generateProposal(req, await deps(chat))).rejects.toThrow('AI 生成失败');
  });

  it('gap:rationaleDrivers(缺口/画像/条款锚点)+ recommendedProducts.matchReason 已产出', async () => {
    const chat = fixedChat([{ text: '承保工伤赔偿', evidence: ['E1'], clauseType: '责任' }]);
    const p = await generateProposal(req, await deps(chat));
    const it = p.items[0];
    expect(it.rationaleDrivers?.some((d) => d.gap === '雇主责任险未覆盖')).toBe(true);
    expect(it.rationaleDrivers?.some((d) => d.profile === 'SaaS')).toBe(true);
    expect(it.rationaleDrivers?.some((d) => d.clause === '承保工伤赔偿')).toBe(true);
    if (it.recommendedProducts.length) expect(it.recommendedProducts[0].matchReason).toContain('产品库');
  });

  it('callsUsed:loop 开、重写 1 次 → generate+judge 累计 4 次', async () => {
    const chat = new StubChatProvider() as ChatProvider;
    const p = await generateProposal(req, await deps(chat, [softFail(), softPass()]));
    expect(p.items[0].revisions).toBe(1);
    expect(p.items[0].callsUsed).toBe(4); // draft1 + judge1 + revise(compose1+judge1)
  });
});
