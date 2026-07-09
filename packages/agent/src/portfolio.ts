import type { InsuranceLineId } from '@ensureok/catalog';
import type { ChatMessage, ChatProvider } from './llm/types';
import { checkCompliance } from './tools/checkCompliance';
import type { Portfolio, ProposalItem } from './types';

/** 责任重叠对(定死规则,§5.6):两险都在场才提示择主投、避免重复保 */
const OVERLAP_PAIRS: Array<{ a: InsuranceLineId; b: InsuranceLineId; note: string }> = [
  { a: 'public_liability', b: 'product_liability', note: '公众责任与产品责任在第三方人身/财产损害上有部分重叠,建议按主营业务择主投、避免重复保' },
  { a: 'tech_eo', b: 'ai_liability', note: '科技E&O与AI责任在专业过失赔付上有交叉,可按业务是否含AI决策择主投' },
];

/** 出海三件套聚合 */
const OVERSEAS_BUNDLE: InsuranceLineId[] = ['tech_eo', 'cyber', 'product_liability'];

const PORTFOLIO_SYSTEM = `你是保险方案的组合层评审助手。只做"跨险种组合说明",不改写单条内容、不写价格数字、不写招揽话术。
基于给定的险种清单与紧迫度,输出一段中立的中文"组合说明"(2-4 句):为什么是这几个险种、谁主谁辅(强制/高紧迫置顶)、若有出海三件套则说明聚合。
只输出这段纯文本,不要 JSON、不要价格、不要"立即投保"等话术。`;

function buildMessages(items: ProposalItem[]): ChatMessage[] {
  const list = items
    .map((it) => `- ${it.lineName}(${it.tier}/${it.urgency};缺口:${it.gapTitles.join('、') || '—'})`)
    .join('\n');
  return [
    { role: 'system', content: PORTFOLIO_SYSTEM },
    { role: 'user', content: `险种清单:\n${list}\n\n请给出组合说明(纯文本,不含价格/招揽)。` },
  ];
}

function deterministicSummary(items: ProposalItem[], overlaps: Portfolio['overlaps'], bundles: Portfolio['bundles']): string {
  const mand = items.filter((i) => i.urgency === 'mandatory').map((i) => i.lineName);
  const bits: string[] = [];
  bits.push(`本方案覆盖 ${items.length} 个险种,按紧迫度分层呈现。`);
  if (mand.length) bits.push(`其中${mand.join('、')}为强制/高优先,建议优先落实。`);
  if (bundles.length) bits.push(`${bundles.map((b) => `${b.name}(${b.lines.join('+')})`).join('、')}可作一组统筹。`);
  if (overlaps.length) bits.push('部分险种责任有交叉,已在组合中标注,建议择主投避免重复。');
  return bits.join('');
}

/**
 * 组合层评审(§5.6):确定性算重叠/聚合/分层 + LLM 出组合说明。
 * 说明过合规扫描;命中红线则封顶重跑 1 次,仍不过 → 退回确定性说明。≥2 险种才有意义。
 */
export async function portfolioReview(items: ProposalItem[], chat: ChatProvider): Promise<Portfolio> {
  const present = new Set(items.map((i) => i.lineId));
  const overlaps = OVERLAP_PAIRS.filter((p) => present.has(p.a) && present.has(p.b)).map((p) => {
    const name = (id: InsuranceLineId) => items.find((i) => i.lineId === id)?.lineName ?? id;
    return { lines: [name(p.a), name(p.b)], note: p.note };
  });
  const overseas = OVERSEAS_BUNDLE.filter((id) => present.has(id));
  const bundles = overseas.length >= 2 ? [{ name: '出海综合责任包', lines: overseas.map((id) => items.find((i) => i.lineId === id)?.lineName ?? id) }] : [];
  const mand = items.filter((i) => i.urgency === 'mandatory').map((i) => i.lineName);
  const layering = mand.length ? `强制/高优先:${mand.join('、')} 置顶;其余按紧迫度递减。` : '按紧迫度分层,强制险优先。';

  let summary = deterministicSummary(items, overlaps, bundles);
  let reran = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await chat.complete(buildMessages(items))).replace(/\s+/g, ' ').trim();
      const comp = checkCompliance({ text: raw });
      if (raw && comp.ok && comp.data.clean) {
        summary = raw;
        break;
      }
      if (attempt === 0) reran = true; // 首轮不干净 → 记一次重跑(勿在次轮覆写回 false)
    } catch {
      break; // LLM 失败 → 保留确定性说明
    }
  }
  return { summary, overlaps, layering, bundles, reran };
}
