import { LINE_BY_ID, type InsuranceLineId, type ProductCatalog } from '@ensureok/catalog';
import { retrieve, type EmbeddingProvider, type JsonVectorStore, type RetrievedChunk } from '@ensureok/rag';
import { extractLineData } from './catalogData';
import type { ChatProvider } from './llm/types';
import { planLines } from './lineMapping';
import { buildPricing } from './pricing';
import { buildItemMessages } from './prompt';
import type { Citation, Proposal, ProposalItem, ProposalRequest } from './types';

export interface GenerateDeps {
  catalogs: Map<InsuranceLineId, ProductCatalog>;
  ragStore: JsonVectorStore;
  embedding: EmbeddingProvider;
  chat: ChatProvider;
  /** 调用方注入生成时间(库内不取系统时间,便于测试与复现) */
  generatedAt: string;
  topK?: number;
  /** 逐险种生成的最大并发数(默认 5)。并行大幅缩短总时长(串行 2-3 分钟 → 约 30-60 秒) */
  concurrency?: number;
}

const DISCLAIMER =
  '本文为基于你提交信息的规则化风险提示与方向性保障建议,不构成投保建议,不涉及成交报价;实际保障方案与最终报价需由持牌保险顾问结合贵司情况评估。承保由合作持牌保险经纪机构完成。保对了(EnsureOK)为独立第三方风险分析工具,不销售保险产品。';

/** 诊断结果 → 逐险种(catalog 出产品/价位 + rag 出条款依据 + LLM 生成叙述)→ 组装方案 */
export async function generateProposal(req: ProposalRequest, deps: GenerateDeps): Promise<Proposal> {
  const planned = planLines(req.diagnosis.findings);
  const clientSummary = buildClientSummary(req);

  // 逐险种并行生成(有序、限并发);每个险种 = RAG 检索 + LLM 叙述 + 产品/价位组装
  const items = await mapWithConcurrency(planned, deps.concurrency ?? 5, async (p): Promise<ProposalItem> => {
    const cat = deps.catalogs.get(p.lineId);
    const lineName = cat?.lineName ?? LINE_BY_ID.get(p.lineId)?.lineName ?? p.lineId;
    const lineData = cat ? extractLineData(cat) : null;

    // 1) RAG 证据(按险种中文名过滤)
    let evidence: RetrievedChunk[] = [];
    try {
      evidence = await retrieve(
        deps.ragStore,
        deps.embedding,
        `${lineName} ${p.gapTitles.join(' ')} 保险责任 保障范围 条款`,
        { insuranceLines: [lineName], topK: deps.topK ?? 5 },
      );
    } catch {
      evidence = [];
    }

    // 2) LLM 生成叙述(承保方向/理由/条款要点)
    const messages = buildItemMessages({
      lineName,
      gapTitles: p.gapTitles,
      profileSummary: clientSummary,
      insurers: lineData?.insurers ?? [],
      priceTables: lineData?.priceTables ?? [],
      evidence,
    });
    let composed = { coverageDirection: '', rationale: '', keyClauses: [] as string[] };
    try {
      const parsed = parseLlmJson(await deps.chat.complete(messages));
      if (parsed) {
        composed = {
          coverageDirection: asStr(parsed.coverageDirection),
          rationale: asStr(parsed.rationale),
          keyClauses: asStrArr(parsed.keyClauses),
        };
      }
    } catch {
      /* 降级为占位 */
    }

    // 3) 价位(确定性,来自产品库价格表)+ 保司(结构化,非 LLM)
    const pricing = buildPricing(lineData?.priceTables ?? [], lineData?.collectedAt);
    const citations: Citation[] = evidence.map((e) => ({
      sourceFile: e.meta.sourceFile,
      headingPath: e.meta.headingPath,
      insuranceLine: e.meta.insuranceLine,
      docCategory: e.meta.docCategory,
    }));

    return {
      lineId: p.lineId,
      lineName,
      urgency: p.urgency,
      tier: p.tier,
      gapTitles: p.gapTitles,
      coverageDirection: composed.coverageDirection || `${lineName}的方向性保障建议(待持牌顾问细化)`,
      rationale: composed.rationale,
      keyClauses: composed.keyClauses,
      recommendedProducts: (lineData?.insurers ?? []).slice(0, 3).map((insurer) => ({
        insurer,
        source: 'product_db' as const,
        sourceFile: lineData?.sourceFile ?? '',
      })),
      pricing,
      drilldownSourceFile: lineData?.sourceFile ?? null,
      citations,
      evidenceInsufficient: evidence.length === 0,
    };
  });

  const hasConcretePrice = items.some((i) => !i.pricing.unavailable);
  return {
    meta: {
      documentName: hasConcretePrice ? '保障方案建议' : '风险保障方向说明',
      company: req.company,
      generatedAt: deps.generatedAt,
      engine: 'ensureok-agent/0.1',
      llmModel: deps.chat.model,
      ragModel: deps.embedding.model,
    },
    clientSummary,
    items,
    disclaimer: DISCLAIMER,
  };
}

function buildClientSummary(req: ProposalRequest): string {
  const p = req.profile;
  const bits: string[] = [];
  if (p.industry) bits.push(`行业 ${p.industry}`);
  if (p.headcount) bits.push(`人数 ${p.headcount}`);
  if (p.funding) bits.push(`融资 ${p.funding}`);
  if (p.hasPatent) bits.push('有专利');
  if (p.overseasCountries?.length) bits.push(`出海 ${p.overseasCountries.join('/')}`);
  bits.push(`诊断缺口 ${req.diagnosis.total} 项(强制 ${req.diagnosis.mandatoryCount})`);
  return bits.join(' · ');
}

function parseLlmJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    /* try 提取 */
  }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 有序并发映射:最多 limit 个并发执行 fn,返回结果保持输入顺序。用于并行逐险种生成。 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
