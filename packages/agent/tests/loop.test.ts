import { describe, expect, it } from 'vitest';
import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import { JsonVectorStore, StubEmbeddingProvider, type EmbeddedChunk } from '@ensureok/rag';
import { StubChatProvider } from '../src/llm/stub';
import { StubJudge, failScore, passScore } from '../src/judge';
import { generateProposal, type GenerateDeps } from '../src/pipeline';
import type { ChatProvider } from '../src/llm/types';
import type { ProposalRequest, QualityScore } from '../src/types';

function catalog(): ProductCatalog {
  return {
    lineId: 'employer_liability',
    lineName: '雇主责任险',
    sourceFile: '保险产品数据库/01-雇主责任险/雇主责任险产品数据.md',
    title: 'x',
    meta: { collectedAt: '2026年7月9日', sources: ['官网'], applicableScenario: 'x' },
    insurers: ['中国人保', '平安'],
    sections: [
      {
        level: 3,
        heading: '2.1',
        path: ['二', '2.1'],
        tables: [
          { contextPath: ['二', '2.1'], columns: ['职业', '10万保额'], rows: [['1类', '93元']], isPriceTable: true, insurers: ['中国人保'] },
        ],
      },
    ],
    priceTableCount: 1,
    hasPriceTable: true,
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

async function deps(judgeScores?: QualityScore[], loopOn = true): Promise<GenerateDeps> {
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

describe('对抗式 loop', () => {
  it('未配 judge:退回单次生成,无评分字段', async () => {
    const p = await generateProposal(req, await deps(undefined, false));
    expect(p.items[0].qualityScore).toBeUndefined();
    expect(p.items[0].revisions).toBeUndefined();
    expect(p.meta.engine).toBe('ensureok-agent/0.2');
  });

  it('首评即通过:0 次重写', async () => {
    const p = await generateProposal(req, await deps([passScore()]));
    expect(p.items[0].qualityScore?.passed).toBe(true);
    expect(p.items[0].revisions).toBe(0);
    expect(p.items[0].degraded).toBeUndefined();
    expect(p.meta.engine).toContain('adversarial');
    expect(p.meta.judgeModel).toBe('stub-judge');
  });

  it('先不达标→重写后达标:revisions>0 且最终 passed', async () => {
    // 首评 fail(4),重写后 pass(10)
    const p = await generateProposal(req, await deps([failScore(), passScore()]));
    expect(p.items[0].revisions).toBe(1);
    expect(p.items[0].qualityScore?.passed).toBe(true);
    expect(p.items[0].degraded).toBeUndefined();
  });

  it('封顶仍不达标:degraded=true,取最优版', async () => {
    // 一直 fail:首评 + 2 次重写都 fail
    const p = await generateProposal(req, await deps([failScore(), failScore(), failScore()]));
    expect(p.items[0].degraded).toBe(true);
    expect(p.items[0].revisions).toBe(2);
    expect(p.items[0].qualityScore?.passed).toBe(false);
  });

  it('调用预算硬顶:实际 LLM 调用数不超过 callBudget', async () => {
    // 计数 chat.complete + judge.score 的真实调用次数,断言不越过 callBudget(真·硬顶,不止看 revisions)
    let calls = 0;
    const countingChat: ChatProvider = {
      id: 'count',
      model: 'count',
      async complete() {
        calls++;
        return JSON.stringify({ coverageDirection: '方向', rationale: '理由', keyClauses: ['要点'] });
      },
      async completeWithTools() {
        return { content: '', toolCalls: [], finishReason: 'stop' };
      },
    };
    const countingJudge = new StubJudge([failScore(), failScore(), failScore()]);
    const origScore = countingJudge.score.bind(countingJudge);
    countingJudge.score = async () => {
      calls++;
      return origScore();
    };
    const d = await deps();
    d.chat = countingChat;
    d.judge = countingJudge;
    d.loop = { enabled: true, maxRevisions: 5, callBudget: 3 };
    const p = await generateProposal(req, d);
    // 首次 generate=1,首评 judge=2;剩余额度 1 不够一整轮(compose+judge=2)→ 不再重写
    expect(calls).toBeLessThanOrEqual(3);
    expect(p.items[0].revisions).toBe(0);
    expect(p.items[0].degraded).toBe(true);
  });

  it('偶数预算恰好用满、不超支', async () => {
    let calls = 0;
    const countingJudge = new StubJudge([failScore(), failScore(), failScore()]);
    const origScore = countingJudge.score.bind(countingJudge);
    countingJudge.score = async () => {
      calls++;
      return origScore();
    };
    const chat = new StubChatProvider() as ChatProvider;
    const origComplete = chat.complete.bind(chat);
    chat.complete = async (m, o) => {
      calls++;
      return origComplete(m, o);
    };
    const d = await deps();
    d.chat = chat;
    d.judge = countingJudge;
    d.loop = { enabled: true, maxRevisions: 5, callBudget: 4 }; // generate+judge(2)+一整轮(2)=4
    const p = await generateProposal(req, d);
    expect(calls).toBeLessThanOrEqual(4);
    expect(p.items[0].revisions).toBe(1);
  });
});

describe('合规终局闸门', () => {
  it('生成含红线(保费金额)→ 隐去 + degraded + complianceFlags', async () => {
    // stub chat 返回固定文本,但我们注入一个会写金额的 chat 来触发闸门
    const leakyChat: ChatProvider = {
      id: 'leak',
      model: 'leak',
      async complete() {
        return JSON.stringify({ coverageDirection: '雇主责任险方向', rationale: '年保费约 5000 元起,性价比高。', keyClauses: ['保工伤'] });
      },
      async completeWithTools() {
        return { content: '', toolCalls: [], finishReason: 'stop' };
      },
    };
    const d = { ...(await deps([passScore()])), chat: leakyChat };
    const p = await generateProposal(req, d);
    const it = p.items[0];
    expect(it.degraded).toBe(true);
    expect(it.complianceFlags).toContain('R1_premium');
    expect(it.rationale).not.toContain('5000'); // 已隐去
    expect(it.coverageDirection).toContain('待持牌顾问核对');
  });
});
