import { describe, expect, it } from 'vitest';
import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import { JsonVectorStore, StubEmbeddingProvider, type EmbeddedChunk } from '@ensureok/rag';
import { checkCompliance } from '../src/tools/checkCompliance';
import { computePricing } from '../src/tools/computePricing';
import { queryCatalog } from '../src/tools/queryCatalog';
import { createToolExecutor } from '../src/tools/executor';
import type { ToolContext, ToolOk } from '../src/tools/types';

function catalog(): ProductCatalog {
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
        heading: '2.1 人保',
        path: ['二、产品对比', '2.1 人保'],
        tables: [
          {
            contextPath: ['二、产品对比', '2.1 人保'],
            columns: ['职业类别', '10万保额', '100万保额'], // 列头=保额档,单元格=保费
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

async function ragStore(): Promise<JsonVectorStore> {
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

async function pipelineCtx(): Promise<ToolContext> {
  return {
    catalogs: new Map<InsuranceLineId, ProductCatalog>([['employer_liability', catalog()]]),
    ragStore: await ragStore(),
    embedding: new StubEmbeddingProvider(),
    audience: 'pipeline',
    lineScope: 'employer_liability',
  };
}

describe('query_catalog', () => {
  it('取承保方与元信息', async () => {
    const r = queryCatalog({ lineId: 'employer_liability' }, await pipelineCtx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.insurers).toEqual(['中国人保', '平安', '太平洋']);
      expect(r.data.hasPriceTable).toBe(true);
    }
  });
  it('未知险种报错', async () => {
    const r = queryCatalog({ lineId: 'ai_liability' }, await pipelineCtx());
    expect(r.ok).toBe(false);
  });
});

describe('compute_pricing(隔离保费,排除保额)', () => {
  it('矩阵表:列头保额档、单元格保费 → 取保费', async () => {
    const r = computePricing({ lineId: 'employer_liability' }, await pipelineCtx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.matchTier).toBe('bracket');
      expect(r.data.premiumMinCny).toBe(93); // 保费,不是保额(10万/100万被识别为档位列头)
      expect(r.data.premiumMaxCny).toBe(1468);
    }
  });
});

describe('check_compliance', () => {
  it('干净文本通过', () => {
    const r = checkCompliance({ text: '雇主责任险承保员工工伤赔偿责任,建议关注上下班途中扩展条款。' }) as ToolOk<{ clean: boolean }>;
    expect(r.data.clean).toBe(true);
  });
  it('阿拉伯数字保费 → R1', () => {
    const r = checkCompliance({ text: '年保费约 5000 元起。' });
    expect(r.ok && r.data.clean).toBe(false);
    if (r.ok) expect(r.data.violations.some((v) => v.rule === 'R1_premium')).toBe(true);
  });
  it('中文数字金额 → R1', () => {
    const r = checkCompliance({ text: '大概五万元一年。' });
    expect(r.ok && r.data.clean).toBe(false);
  });
  it('招揽 CTA → R2', () => {
    const r = checkCompliance({ text: '现在就立即投保吧!' });
    expect(r.ok && r.data.clean).toBe(false);
    if (r.ok) expect(r.data.violations.some((v) => v.rule === 'R2_cta')).toBe(true);
  });
});

describe('executor 护栏', () => {
  it('pipeline 越权:传别的 lineId → line-scope-violation', async () => {
    const exec = createToolExecutor(await pipelineCtx());
    const r = await exec('query_catalog', JSON.stringify({ lineId: 'cyber' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('line-scope-violation');
  });
  it('pipeline compute_pricing 结果脱敏:不含金额数值', async () => {
    const exec = createToolExecutor(await pipelineCtx());
    const r = await exec('compute_pricing', '{}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('premiumMinCny');
      expect(data).toHaveProperty('matchTier');
      expect(data.available).toBe(true);
    }
  });
  it('mcp audience 不脱敏:给完整金额', async () => {
    const ctx = await pipelineCtx();
    const exec = createToolExecutor({ ...ctx, audience: 'mcp', lineScope: undefined });
    const r = await exec('compute_pricing', JSON.stringify({ lineId: 'employer_liability' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as Record<string, unknown>).premiumMinCny).toBe(93);
  });
  it('未知工具报错', async () => {
    const exec = createToolExecutor(await pipelineCtx());
    const r = await exec('nope', '{}');
    expect(r.ok).toBe(false);
  });
});
