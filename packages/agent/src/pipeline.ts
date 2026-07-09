import { LINE_BY_ID, type InsuranceLineId, type ProductCatalog } from '@ensureok/catalog';
import { retrieve, type EmbeddingProvider, type JsonVectorStore, type RetrievedChunk } from '@ensureok/rag';
import { extractLineData } from './catalogData';
import type { Judge, JudgeInput } from './judge';
import type { ChatMessage, ChatProvider } from './llm/types';
import { runToolLoop } from './llm/toolRunner';
import { planLines } from './lineMapping';
import { portfolioReview } from './portfolio';
import { buildPricing, pricingFromComputed } from './pricing';
import { buildItemMessages, type ReviseContext } from './prompt';
import { applyFaithfulness, buildScoreCard, scoreDeterministic } from './scoring';
import { checkCompliance } from './tools/checkCompliance';
import { computePricing } from './tools/computePricing';
import { createToolExecutor } from './tools/executor';
import { PIPELINE_TOOL_DEFS } from './tools/toolDefs';
import type { Citation, KeyClause, Proposal, ProposalItem, ProposalRequest, ScoreCard, Verdict } from './types';

export interface GenerateDeps {
  catalogs: Map<InsuranceLineId, ProductCatalog>;
  ragStore: JsonVectorStore;
  embedding: EmbeddingProvider;
  chat: ChatProvider;
  /** 调用方注入生成时间(库内不取系统时间,便于测试与复现) */
  generatedAt: string;
  topK?: number;
  /** 逐险种生成的最大并发数(默认 5) */
  concurrency?: number;
  /** 开启 pipeline 内 tool-calling 循环(LLM 按需回查工具);默认关(用预检索单次生成)。中转不支持则自动收敛回退。 */
  enableToolCalling?: boolean;
  /** tool-calling 单 turn 最大工具轮次(默认 6) */
  maxToolSteps?: number;
  /** 评分员(建议异构模型);配了才启用对抗 loop */
  judge?: Judge;
  /** 对抗式生成 loop 配置 */
  loop?: {
    enabled: boolean;
    /** 每险种最大重写次数(默认 2) */
    maxRevisions?: number;
    /** 单 proposal 全局 LLM 调用预算硬顶(generate+judge 累计;默认无限) */
    callBudget?: number;
    /**
     * 忠实度 not-supported 是否允许破坏性删条款(默认 false = 只标⚠待核不删)。
     * 仅当 judge 异构(deps.judge.heterogeneous)且此处显式 true 才生效(C2:单模型不自动删)。
     */
    fidelityDestructive?: boolean;
  };
}

type Narrative = { coverageDirection: string; rationale: string; keyClauses: KeyClause[] };

const DISCLAIMER =
  '本文为基于你提交信息的规则化风险提示与方向性保障建议,不构成投保建议,不涉及成交报价;实际保障方案与最终报价需由持牌保险顾问结合贵司情况评估。承保由合作持牌保险经纪机构完成。保对了(EnsureOK)为独立第三方风险分析工具,不销售保险产品。';

/**
 * 诊断结果 → 逐险种生成方案。配了 deps.judge + loop.enabled 时走对抗式:
 * 生成 → judge 打分(软维度)→ 不达标带评语重写(非破坏性,只采纳变好的)→ 封顶/预算停 → 终局合规闸门。
 * 价格/保司仍走确定性组装,LLM 不碰数字。
 */
export async function generateProposal(req: ProposalRequest, deps: GenerateDeps): Promise<Proposal> {
  const planned = planLines(req.diagnosis.findings);
  const clientSummary = buildClientSummary(req);
  const loopOn = Boolean(deps.judge && deps.loop?.enabled);
  const budget = { used: 0, max: deps.loop?.callBudget ?? Number.POSITIVE_INFINITY };

  const items = await mapWithConcurrency(planned, deps.concurrency ?? 5, async (p): Promise<ProposalItem> => {
    const cat = deps.catalogs.get(p.lineId);
    const lineName = cat?.lineName ?? LINE_BY_ID.get(p.lineId)?.lineName ?? p.lineId;
    const lineData = cat ? extractLineData(cat) : null;

    // 1) RAG 证据(逐险种一次)
    let evidence: RetrievedChunk[] = [];
    try {
      evidence = await retrieve(deps.ragStore, deps.embedding, `${lineName} ${p.gapTitles.join(' ')} 保险责任 保障范围 条款`, {
        insuranceLines: [lineName],
        topK: deps.topK ?? 5,
      });
    } catch {
      evidence = [];
    }

    // 2) 生成叙述(可带字段锁重写)。调用计数由调用方按整轮预扣(见对抗 loop),此处不自增。
    const evidenceIds = evidence.map((e) => e.id);
    const headingByChunk = new Map(evidence.map((e) => [e.id, e.meta.headingPath] as const));
    // 可选:pipeline 内 tool-calling(LLM 按需回查);不开则预检索单次生成
    const invoke = deps.enableToolCalling
      ? createToolExecutor({ catalogs: deps.catalogs, ragStore: deps.ragStore, embedding: deps.embedding, audience: 'pipeline', lineScope: p.lineId })
      : null;
    const generate = async (messages: ChatMessage[]): Promise<string> =>
      invoke
        ? (await runToolLoop(deps.chat, messages, PIPELINE_TOOL_DEFS, invoke, { maxSteps: deps.maxToolSteps ?? 6 })).content
        : deps.chat.complete(messages);
    const composeNarrative = async (revise?: ReviseContext): Promise<Narrative> => {
      const messages = buildItemMessages({
        lineName,
        gapTitles: p.gapTitles,
        profileSummary: clientSummary,
        insurers: lineData?.insurers ?? [],
        priceTables: lineData?.priceTables ?? [],
        evidence,
        revise,
      });
      try {
        const parsed = parseLlmJson(await generate(messages));
        if (parsed) {
          return {
            coverageDirection: asStr(parsed.coverageDirection),
            rationale: asStr(parsed.rationale),
            keyClauses: parseKeyClauses(parsed.keyClauses, evidenceIds),
          };
        }
      } catch {
        /* 降级为占位 */
      }
      return { coverageDirection: '', rationale: '', keyClauses: [] };
    };

    // 3) 对抗 loop:generate → 确定性三维 + judge 两软维 → 汇总 ScoreCard → 字段锁重写 → 取最优版。
    //    每轮重写=compose+judge 共 2 次调用,进入前"同步预扣"整轮额度(不超 callBudget 硬顶、并发无缝隙)。
    const whitelist = lineData?.insurers ?? [];
    const textOf = (n: Narrative): string => `${n.coverageDirection}\n${n.rationale}\n${n.keyClauses.map((k) => k.text).join('\n')}`;
    const softInput = (n: Narrative): JudgeInput => ({
      lineName,
      coverageDirection: n.coverageDirection,
      rationale: n.rationale,
      clauses: n.keyClauses.map((k, i) => ({ index: i, text: k.text, evidenceRefs: k.evidenceRefs })),
      evidence: evidence.map((e) => ({ chunkId: e.id, text: e.text, sourceFile: e.meta.sourceFile })),
    });
    const fidelityDestructive = Boolean(deps.loop?.fidelityDestructive && deps.judge?.heterogeneous);
    // 对一版草稿评分:确定性三维 + judge 两软维 → ScoreCard,并落忠实度到条款(非破坏性)
    const scoreDraft = async (n: Narrative, prev?: Verdict): Promise<{ card: ScoreCard; clauses: KeyClause[] }> => {
      const det = scoreDeterministic(textOf(n), whitelist);
      const soft = await deps.judge!.scoreSoft(softInput(n));
      const card = buildScoreCard(det, soft, prev);
      const { clauses } = applyFaithfulness(n.keyClauses, soft.claims, headingByChunk, fidelityDestructive);
      return { card, clauses };
    };

    budget.used++; // 首次生成(至少 1 次,不可省)
    let callsUsed = 1;
    let composed = await composeNarrative();
    let scoreCards: ScoreCard[] | undefined;
    let qualityScore: number | undefined;
    let revisions = 0;
    let degraded = false;
    let degradedReason: string | undefined;

    if (loopOn && deps.judge) {
      const maxRev = deps.loop?.maxRevisions ?? 2;
      const cards: ScoreCard[] = [];
      let card: ScoreCard | undefined;
      let best: { composed: Narrative; card: ScoreCard } | undefined;

      // 首评(额度不足则跳过,退回单次生成)
      if (budget.used < budget.max) {
        budget.used++;
        callsUsed++;
        const r = await scoreDraft(composed);
        composed = { ...composed, keyClauses: r.clauses };
        card = r.card;
        cards.push(card);
        best = { composed, card };
      }

      while (card && card.verdict === 'fail' && revisions < maxRev && budget.used + 2 <= budget.max) {
        budget.used += 2; // 预扣整轮
        callsUsed += 2;
        const revised = await composeNarrative(buildReviseContext(composed, card));
        const rr = await scoreDraft(revised, card.verdict);
        revisions++;
        const revisedComposed: Narrative = { ...revised, keyClauses: rr.clauses };
        cards.push(rr.card);
        if (!best || rr.card.weightedScore > best.card.weightedScore) best = { composed: revisedComposed, card: rr.card };
        card = rr.card;
        composed = revisedComposed;
        if (card.verdict === 'pass') break;
      }

      // 取最优版(按 weightedScore;非破坏性:不因末轮变差而丢弃更优的早期版)
      if (best) {
        composed = best.composed;
        card = best.card;
        qualityScore = best.card.weightedScore;
      }
      scoreCards = cards;
      if (!best || best.card.verdict === 'fail') {
        degraded = true;
        degradedReason = best
          ? `质检未达标(${best.card.weightedScore}/100,gate:${best.card.gateFailed.join('/') || '无'}),重写 ${revisions} 次后取最优版`
          : '调用预算不足未能质检,退回单次生成';
      } else if (composed.keyClauses.some((k) => k.faithfulness === 'unverified')) {
        degraded = true;
        degradedReason = '含待核条款(证据未确认,标注待持牌顾问核对)';
      }
    }

    // 4) 终局合规闸门:绝不硬发红线内容,命中即隐去待顾问核对
    const itemText = `${composed.coverageDirection}\n${composed.rationale}\n${composed.keyClauses.map((k) => k.text).join('\n')}`;
    const comp = checkCompliance({ text: itemText });
    let complianceFlags: string[] | undefined;
    if (comp.ok && !comp.data.clean) {
      complianceFlags = [...new Set(comp.data.violations.map((v) => v.rule))];
      degraded = true;
      degradedReason = `${degradedReason ? `${degradedReason};` : ''}合规闸门命中 ${complianceFlags.join('/')},该条内容已隐去`;
      composed = { coverageDirection: `${lineName}的方向性保障建议(内容待持牌顾问核对后提供)`, rationale: '', keyClauses: [] };
    }

    // 5) 价位/保司(确定性)+ 组装。价位走 compute_pricing(隔离保费/排除保额),失败回退旧 buildPricing。
    const priced = cat
      ? computePricing({ lineId: p.lineId }, { catalogs: deps.catalogs, ragStore: deps.ragStore, embedding: deps.embedding, audience: 'pipeline', lineScope: p.lineId })
      : null;
    const pricing =
      priced && priced.ok ? pricingFromComputed(priced.data) : buildPricing(lineData?.priceTables ?? [], lineData?.collectedAt);
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
      keyClauses: composed.keyClauses.map((k) => k.text),
      keyClausesDetailed: composed.keyClauses,
      recommendedProducts: (lineData?.insurers ?? []).slice(0, 3).map((insurer) => ({
        insurer,
        source: 'product_db' as const,
        sourceFile: lineData?.sourceFile ?? '',
      })),
      pricing,
      drilldownSourceFile: lineData?.sourceFile ?? null,
      citations,
      evidenceInsufficient: evidence.length === 0,
      qualityScore,
      scoreCards,
      revisions: loopOn ? revisions : undefined,
      callsUsed,
      degraded: degraded || undefined,
      degradedReason,
      complianceFlags,
    };
  });

  // 组合层评审(≥2 险种才有意义;§5.6)
  const portfolio = items.length >= 2 ? await portfolioReview(items, deps.chat) : undefined;

  const hasConcretePrice = items.some((i) => !i.pricing.unavailable);
  return {
    meta: {
      documentName: hasConcretePrice ? '保障方案建议' : '风险保障方向说明',
      company: req.company,
      generatedAt: deps.generatedAt,
      engine: loopOn ? 'ensureok-agent/0.2-adversarial' : 'ensureok-agent/0.2',
      llmModel: deps.chat.model,
      ragModel: deps.embedding.model,
      judgeModel: loopOn ? deps.judge?.model : undefined,
    },
    clientSummary,
    items,
    portfolio,
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

/** 字段锁重写上下文(H4):回填上一版 + 锁定 pass 字段 + 仅改 fail 字段。 */
function buildReviseContext(prev: Narrative, card: ScoreCard): ReviseContext {
  const prevDraftJson = JSON.stringify({
    coverageDirection: prev.coverageDirection,
    rationale: prev.rationale,
    keyClauses: prev.keyClauses.map((k) => ({ text: k.text, evidence: k.evidenceRefs, clauseType: k.clauseType })),
  });
  const allFields = ['coverageDirection', 'rationale', ...prev.keyClauses.map((_, i) => `keyClauses[${i}]`)];
  const instructions = card.revisionInstructions.length
    ? card.revisionInstructions
    : [{ target: 'rationale', action: 'rewrite' as const, reason: '说服力/忠实度不足,绑定缺口×责任×画像并严格贴合证据' }];
  const targets = new Set(instructions.map((i) => i.target));
  const lockedFields = allFields.filter((f) => !targets.has(f));
  return { prevDraftJson, lockedFields, instructions };
}

/**
 * 解析 LLM 的 keyClauses → 结构化 KeyClause[]。兼容两种形态:
 *   - 纯字符串(旧契约)→ { text, evidenceRefs: [] }
 *   - 对象 { text, evidence|evidenceRefs: string[], clauseType }
 * evidenceRefs 校验:E 标签(E1/E2…)按序映射到该险种证据的真实 chunkId;
 * 直接引 chunkId 须在证据集合内;无效/空/越界一律剔除(§8 单一条款出口)。
 */
function parseKeyClauses(raw: unknown, evidenceIds: string[]): KeyClause[] {
  if (!Array.isArray(raw)) return [];
  const idSet = new Set(evidenceIds);
  const resolveRef = (ref: unknown): string | null => {
    if (typeof ref !== 'string') return null;
    const r = ref.trim();
    if (!r) return null;
    const m = /^E(\d+)$/i.exec(r);
    if (m) {
      const idx = Number(m[1]) - 1;
      return idx >= 0 && idx < evidenceIds.length ? evidenceIds[idx] : null;
    }
    return idSet.has(r) ? r : null;
  };
  const out: KeyClause[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ text: item, evidenceRefs: [] });
      continue;
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const text = asStr(o.text);
      if (!text.trim()) continue;
      const refsRaw = Array.isArray(o.evidence) ? o.evidence : Array.isArray(o.evidenceRefs) ? o.evidenceRefs : [];
      const evidenceRefs = [...new Set(refsRaw.map(resolveRef).filter((x): x is string => x !== null))];
      const clause: KeyClause = { text, evidenceRefs };
      const ct = o.clauseType;
      if (ct === '责任' || ct === '除外' || ct === '免赔' || ct === '其他') clause.clauseType = ct;
      out.push(clause);
    }
  }
  return out;
}

/** 有序并发映射:最多 limit 个并发执行 fn,返回结果保持输入顺序。 */
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
