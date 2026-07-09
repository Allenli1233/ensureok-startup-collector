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

async function deps(judgeScores?: JudgeSoft[], loopOn = true): Promise<GenerateDeps> {
  return {
    catalogs: new Map<InsuranceLineId, ProductCatalog>([['employer_liability', catalog()]]),
    ragStore: await store(),
    embedding: new StubEmbeddingProvider(),
    chat: new StubChatProvider() as ChatProvider,
    judge: judgeScores ? new StubJudge(judgeScores) : undefined,
    loop: { enabled: loopOn, maxRevisions: 2 },
    generatedAt: 'T',
  };
}

describe('对抗式 loop(五维评分)', () => {
  it('未配 judge:退回单次生成,无评分字段', async () => {
    const p = await generateProposal(req, await deps(undefined, false));
    expect(p.items[0].qualityScore).toBeUndefined();
    expect(p.items[0].scoreCards).toBeUndefined();
    expect(p.items[0].revisions).toBeUndefined();
    expect(p.items[0].callsUsed).toBe(1);
    expect(p.meta.engine).toBe('ensureok-agent/0.2');
  });

  it('首评即通过:qualityScore=100、0 次重写', async () => {
    const p = await generateProposal(req, await deps([softPass()]));
    const it = p.items[0];
    expect(it.qualityScore).toBe(100);
    expect(it.scoreCards).toHaveLength(1);
    expect(it.scoreCards?.[0].verdict).toBe('pass');
    expect(it.revisions).toBe(0);
    expect(it.degraded).toBeUndefined();
    expect(p.meta.engine).toContain('adversarial');
    expect(p.meta.judgeModel).toBe('stub-judge');
  });

  it('先不达标→重写后达标:revisions>0 且取最优版(100)', async () => {
    const p = await generateProposal(req, await deps([softFail(), softPass()]));
    const it = p.items[0];
    expect(it.revisions).toBe(1);
    expect(it.qualityScore).toBe(100);
    expect(it.scoreCards).toHaveLength(2);
    expect(it.degraded).toBeUndefined();
  });

  it('封顶仍不达标:degraded=true,取最优版', async () => {
    const p = await generateProposal(req, await deps([softFail(), softFail(), softFail()]));
    const it = p.items[0];
    expect(it.degraded).toBe(true);
    expect(it.revisions).toBe(2);
    expect(it.scoreCards).toHaveLength(3);
    expect(it.scoreCards?.at(-1)?.verdict).toBe('fail');
  });

  it('调用预算硬顶:实际 LLM 调用数不超过 callBudget', async () => {
    let calls = 0;
    const chat: ChatProvider = {
      id: 'count',
      model: 'count',
      async complete() {
        calls++;
        return JSON.stringify({ coverageDirection: '方向', rationale: '理由', keyClauses: [{ text: '要点', evidence: [] }] });
      },
      async completeWithTools() {
        return { content: '', toolCalls: [], finishReason: 'stop' };
      },
    };
    const judge = new StubJudge([softFail(), softFail(), softFail()]);
    const orig = judge.scoreSoft.bind(judge);
    judge.scoreSoft = async () => {
      calls++;
      return orig();
    };
    const d = await deps();
    d.chat = chat;
    d.judge = judge;
    d.loop = { enabled: true, maxRevisions: 5, callBudget: 3 };
    const p = await generateProposal(req, d);
    expect(calls).toBeLessThanOrEqual(3);
    expect(p.items[0].revisions).toBe(0);
    expect(p.items[0].degraded).toBe(true);
  });

  it('偶数预算恰好用满:callBudget=4 → 1 次重写', async () => {
    const p = await generateProposal(req, await (async () => {
      const d = await deps([softFail(), softFail(), softFail()]);
      d.loop = { enabled: true, maxRevisions: 5, callBudget: 4 };
      return d;
    })());
    expect(p.items[0].revisions).toBe(1);
  });

  it('非破坏性忠实度:judge 判 not-supported 无 rebind → 条款保留标⚠待核 + degraded', async () => {
    const soft = softPass({ claims: [{ index: 0, status: 'not-supported', rebindTo: null }] });
    const p = await generateProposal(req, await deps([soft]));
    const it = p.items[0];
    expect(it.keyClausesDetailed?.[0].faithfulness).toBe('unverified');
    expect(it.keyClausesDetailed).toHaveLength(1); // 未删
    expect(it.degraded).toBe(true);
    expect(it.degradedReason).toContain('待核');
  });
});

describe('合规终局闸门(确定性维一票否决)', () => {
  it('生成含红线(保费金额)→ gate 否决 + 隐去 + degraded + complianceFlags', async () => {
    const leakyChat: ChatProvider = {
      id: 'leak',
      model: 'leak',
      async complete() {
        return JSON.stringify({ coverageDirection: '雇主责任险方向', rationale: '年保费约 5000 元起,性价比高。', keyClauses: [{ text: '保工伤', evidence: [] }] });
      },
      async completeWithTools() {
        return { content: '', toolCalls: [], finishReason: 'stop' };
      },
    };
    const d = { ...(await deps([softPass()])), chat: leakyChat };
    const p = await generateProposal(req, d);
    const it = p.items[0];
    expect(it.degraded).toBe(true);
    expect(it.complianceFlags).toContain('R1_premium');
    expect(it.scoreCards?.some((c) => c.gateFailed.includes('compliance'))).toBe(true);
    expect(it.rationale).not.toContain('5000');
    expect(it.coverageDirection).toContain('待持牌顾问核对');
  });
});
