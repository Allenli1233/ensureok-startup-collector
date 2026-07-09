import { describe, expect, it } from 'vitest';
import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import { JsonVectorStore, StubEmbeddingProvider, type EmbeddedChunk } from '@ensureok/rag';
import { StubChatProvider } from '../src/llm/stub';
import { generateProposal } from '../src/pipeline';
import type { ProposalRequest } from '../src/types';

function makeCatalog(): ProductCatalog {
  return {
    lineId: 'employer_liability',
    lineName: '雇主责任险',
    sourceFile: '保险产品数据库/01-雇主责任险/雇主责任险产品数据.md',
    title: '雇主责任险产品数据',
    meta: { collectedAt: '2026年7月9日', sources: ['官网'], applicableScenario: '有员工企业' },
    insurers: ['中国人保', '平安', '太平洋'],
    sections: [
      {
        level: 3,
        heading: '2.1 中国人保雇主责任险',
        path: ['二、主要保险公司产品对比', '2.1 中国人保雇主责任险'],
        tables: [
          {
            contextPath: ['二、主要保险公司产品对比', '2.1 中国人保雇主责任险'],
            columns: ['职业类别', '10万保额', '100万保额'],
            rows: [
              ['1-2类', '93元', '555元'],
              ['5-6类', '250元', '1,468元'],
            ],
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
  const texts = ['雇主责任险 承保雇主对雇员工伤的赔偿责任', '雇主责任险 责任免除 故意行为不赔'];
  const chunks: EmbeddedChunk[] = [];
  for (let i = 0; i < texts.length; i++) {
    chunks.push({
      id: `c${i}`,
      text: texts[i],
      vector: (await stub.embed([texts[i]]))[0],
      meta: {
        sourceFile: `保险产品/雇主责任险/x${i}.md`,
        corpus: 'product',
        insuranceLine: '雇主责任险',
        docCategory: '法律法规',
        headingPath: ['一、保险责任'],
      },
    });
  }
  return new JsonVectorStore({ model: stub.model, dimensions: stub.dimensions, builtWith: stub.id, chunks });
}

const req: ProposalRequest = {
  company: '测试公司',
  profile: { industry: 'SaaS', headcount: '31-100 人' },
  diagnosis: {
    total: 1,
    mandatoryCount: 0,
    findings: [{ id: 'er', line: 'line_a', title: '雇主责任险未覆盖', desc: '', coverage: '雇主责任险', urgency: 'high' }],
  },
};

describe('generateProposal (stub 端到端)', () => {
  it('生成 employer_liability 条目;产品与价位来自 catalog,叙述来自 LLM', async () => {
    const catalogs = new Map<InsuranceLineId, ProductCatalog>([['employer_liability', makeCatalog()]]);
    const proposal = await generateProposal(req, {
      catalogs,
      ragStore: await makeStore(),
      embedding: new StubEmbeddingProvider(),
      chat: new StubChatProvider(),
      generatedAt: '2026-07-09T00:00:00.000Z',
    });

    expect(proposal.items).toHaveLength(1);
    const item = proposal.items[0];
    expect(item.lineId).toBe('employer_liability');
    // 保司来自产品库(结构化,非 LLM 编)
    expect(item.recommendedProducts.map((r) => r.insurer)).toEqual(['中国人保', '平安', '太平洋']);
    // 价位数字来自产品库价格表(PR5:compute_pricing 隔离保费/排除保额)
    expect(item.pricing.unavailable).toBe(false);
    expect(item.pricing.display).toContain('参考年保费');
    expect(item.pricing.minCny).toBe(93);
    expect(item.pricing.disclaimer).toContain('承保由合作持牌');
    // 叙述来自(stub)LLM
    expect(item.coverageDirection).toContain('[stub]');
    // RAG 命中(同险种过滤)
    expect(item.citations.length).toBeGreaterThan(0);
    expect(item.evidenceInsufficient).toBe(false);
    expect(item.drilldownSourceFile).toContain('保险产品数据库');
  });

  it('有具体价位 → documentName=保障方案建议;注入的 generatedAt 原样透传', async () => {
    const catalogs = new Map<InsuranceLineId, ProductCatalog>([['employer_liability', makeCatalog()]]);
    const proposal = await generateProposal(req, {
      catalogs,
      ragStore: await makeStore(),
      embedding: new StubEmbeddingProvider(),
      chat: new StubChatProvider(),
      generatedAt: 'STAMP',
    });
    expect(proposal.meta.documentName).toBe('保障方案建议');
    expect(proposal.meta.generatedAt).toBe('STAMP');
    expect(proposal.disclaimer).toContain('不销售保险产品');
  });
});
