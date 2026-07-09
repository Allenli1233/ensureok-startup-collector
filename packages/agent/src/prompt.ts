import type { MdTable } from '@ensureok/catalog';
import type { RetrievedChunk } from '@ensureok/rag';
import type { ChatMessage } from './llm/types';

export interface ItemPromptContext {
  lineName: string;
  gapTitles: string[];
  profileSummary: string;
  insurers: string[];
  priceTables: MdTable[];
  evidence: RetrievedChunk[];
}

const SYSTEM = `你是保险风险保障方向撰写助手,为中国创业公司生成"单个险种"的方向性保障建议条目(非投保建议书、非报价)。
硬规则(违反视为失败):
1. 只能依据<证据>陈述条款/责任/除外等事实;证据没有的不编造,宁可留空。
2. 不得输出任何保费金额/价格/费率数字(价位由系统另行从产品库给出,你不许写)。
3. 不得写"立即投保/购买/成交/最优价"等招揽话术;这是方向性风险建议。
4. 保司只能引用<产品库保司>列出的,不得杜撰。
5. 语气中立、专业,先守底线再求完美,条款比价格重要。
只输出一个 JSON 对象(不要代码围栏、不要多余文字),结构:
{"coverageDirection": string, "rationale": string, "keyClauses": string[]}`;

export function buildItemMessages(ctx: ItemPromptContext): ChatMessage[] {
  const priceNote = ctx.priceTables.length
    ? `产品库有 ${ctx.priceTables.length} 张价格表(价位由系统处理,你不用写数字)。`
    : '产品库该险种暂无价目表。';
  const evidence = ctx.evidence.length
    ? ctx.evidence
        .map((e, i) => `[E${i + 1}] (${e.meta.docCategory}·${e.meta.sourceFile})\n${e.text.slice(0, 500)}`)
        .join('\n\n')
    : '(无检索证据)';

  const user = `险种:${ctx.lineName}
触发缺口:${ctx.gapTitles.join('、') || '(无)'}
企业画像:${ctx.profileSummary}
产品库保司:${ctx.insurers.join('、') || '(无)'}
${priceNote}

<证据>
${evidence}
</证据>

请基于以上生成该险种的 JSON 条目:coverageDirection=承保方向/保障结构;rationale=结合画像的推荐理由;keyClauses=从证据摘取的条款要点数组。只输出 JSON。`;

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
