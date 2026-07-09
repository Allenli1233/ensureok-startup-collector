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

  // ── 对抗式复审确认的绕过(回归):红线绝不可漏过闸门 ──
  const hit = (text: string, rule: string) => {
    const r = checkCompliance({ text });
    expect(r.ok && r.data.clean, `应命中 ${rule}: ${text}`).toBe(false);
    if (r.ok) expect(r.data.violations.some((v) => v.rule === rule), `应命中 ${rule}: ${text}`).toBe(true);
  };
  const clean = (text: string) => {
    const r = checkCompliance({ text }) as ToolOk<{ clean: boolean }>;
    expect(r.data.clean, `应放行(勿误伤): ${text}`).toBe(true);
  };

  describe('R1 保费:仅价格语境命中', () => {
    it('线索词近旁的数字', () => {
      hit('年保费约 8000,性价比高。', 'R1_premium');
      hit('人均保费约 300/人。', 'R1_premium');
      hit('年保费约￥５０００元。', 'R1_premium'); // 全角 + 符号
      hit('保费约 ５０００。', 'R1_premium'); // 全角 + 线索词
    });
    it('中文数字裸量靠线索词/每单位命中', () => {
      hit('年保费约五万。', 'R1_premium');
      hit('保费大概三千。', 'R1_premium');
      hit('大概五万元一年。', 'R1_premium'); // 金额 + 每单位(一年)
    });
    it('外币金额(始终视为价格)', () => {
      hit('年保费约 3000 美元。', 'R1_premium');
      hit('大约 $3000/年。', 'R1_premium');
      hit('USD 3000 起。', 'R1_premium');
    });
    it('线索词稍远也命中(全年/每年兜住)', () => {
      hit('综合保费方面,经测算全年大约需要 8000。', 'R1_premium');
      hit('人均 300 每年。', 'R1_premium');
    });
    it('不误伤:保额/限额/免赔/人数/资本等承保内容(修复过度隐去)', () => {
      clean('每次事故赔偿限额100万元,建议关注。');
      clean('覆盖3万名员工的用工风险。');
      clean('注册资本5000万元的企业适用。');
      clean('免赔额1万元,超出部分按比例赔付。');
      clean('保额最高可达100万元。');
      clean('百万医疗险保障范围广,建议关注免赔额。');
      clean('提醒:千万不要漏保上下班途中风险。');
    });
  });

  describe('R5 绝对化承诺 + suspected 两级', () => {
    it('绝对化承诺 → R5 硬拦', () => {
      hit('本产品保证全额赔付。', 'R5_absolute');
      hit('这款稳赔不亏。', 'R5_absolute');
      hit('必赔,放心买。', 'R5_absolute');
    });
    it('可疑触发词 → suspected(转人工,不硬拦、clean 仍为 true)', () => {
      const r = checkCompliance({ text: '这款很划算,别犹豫。' });
      expect(r.ok && r.data.clean).toBe(true);
      if (r.ok) expect(r.data.suspected.length).toBeGreaterThan(0);
    });
  });

  describe('R2 CTA / R3 强制:结构化后覆盖的变体', () => {
    it('CTA 副词+动词变体', () => {
      hit('扫码即可投保。', 'R2_cta');
      hit('建议尽快投保。', 'R2_cta');
      hit('现在就投保。', 'R2_cta');
    });
    it('不误伤中性建议', () => {
      clean('可结合企业情况评估是否投保。');
    });
    it('监管强制的参保/配置措辞', () => {
      hit('依法必须参保。', 'R3_mandate');
      hit('国家规定企业需配置该保险。', 'R3_mandate');
    });
  });

  describe('R4 具名报价:中文/全角数字终值', () => {
    it('保司 + 报价 + 中文数字', () => {
      hit('平安报价仅需五万。', 'R4_named_quote');
    });
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
