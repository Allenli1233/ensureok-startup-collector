import type { ChatProvider } from './llm/types';
import { checkCompliance } from './tools/checkCompliance';
import type { Proposal } from './types';

/** 超范围/需个性化投保建议时的固定婉拒(D1) */
export const REFUSAL = '这超出本次报告范围,建议由持牌经纪结合贵司情况评估。';
const DISCLAIMER = '(以上为对报告的解读,不构成投保建议、不涉及价格;实际方案与报价由持牌经纪评估。)';

/** 问答范围:report=整份报告;line=某险种(附该险种证据) */
export type QaScope =
  | { kind: 'report'; proposal: Proposal }
  | { kind: 'line'; proposal: Proposal; lineId: string; evidence: Array<{ text: string; sourceFile: string }> };

export interface QaResult {
  answer: string;
  refused: boolean;
  disclaimer: string;
}

const SYSTEM = `你是"保障体检报告解读员"。只依据<报告>与<证据>回答用户对这份报告的疑问,帮他读懂,不做投保建议。
硬规则(违反视为失败):
1. 只用给定<报告>/<证据>里的内容;里面没有的不猜、不编;超出范围就只回固定婉拒。
2. 绝不给具体保额/保费/费率数字;绝不说"你应该买X""能赔多少";绝不写"投保/购买/成交/预约"等招揽。
3. 语气中立专业、简短(2-4 句)。
若问题超出本报告范围或需个性化投保建议,只回这一句(不要多余字):"${REFUSAL}"`;

function reportContext(p: Proposal): string {
  const items = p.items
    .map((it) => `【${it.lineName}·${it.urgency}】承保方向:${it.coverageDirection};推荐理由:${it.rationale};条款要点:${it.keyClauses.join('、') || '—'}`)
    .join('\n');
  const pf = p.portfolio?.summary ? `\n组合说明:${p.portfolio.summary}` : '';
  return `${p.clientSummary}\n${items}${pf}`;
}

function lineContext(scope: Extract<QaScope, { kind: 'line' }>): string {
  const it = scope.proposal.items.find((x) => x.lineId === scope.lineId);
  const base = it
    ? `【${it.lineName}】承保方向:${it.coverageDirection};推荐理由:${it.rationale};条款要点:${it.keyClauses.join('、') || '—'}`
    : '(未找到该险种)';
  const ev = scope.evidence.length
    ? scope.evidence.map((e, i) => `[E${i + 1}] (${e.sourceFile}) ${e.text.slice(0, 400)}`).join('\n')
    : '(无额外证据)';
  return `${base}\n<证据>\n${ev}\n</证据>`;
}

/**
 * 报告解读问答(D1):基于报告/证据 grounding,单轮无状态。
 * 答案过 checkCompliance 终局闸门——泄漏红线(价格/招揽/绝对化等)即换成固定婉拒,绝不硬发。
 */
export async function answerQuestion(chat: ChatProvider, question: string, scope: QaScope): Promise<QaResult> {
  const ctx = scope.kind === 'report' ? reportContext(scope.proposal) : lineContext(scope);
  let raw = '';
  try {
    raw = await chat.complete(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `<报告>\n${ctx}\n</报告>\n\n用户问题:${question}\n\n只依据上面回答;超范围就只回固定婉拒。简短。` },
      ],
      { temperature: 0.2 },
    );
  } catch {
    return { answer: REFUSAL, refused: true, disclaimer: DISCLAIMER };
  }
  const answer = raw.trim();
  if (!answer) return { answer: REFUSAL, refused: true, disclaimer: DISCLAIMER };
  // 合规终局闸门:命中红线 → 换婉拒(绝不硬发泄漏内容)
  const comp = checkCompliance({ text: answer });
  if (comp.ok && !comp.data.clean) return { answer: REFUSAL, refused: true, disclaimer: DISCLAIMER };
  const refused = answer.includes(REFUSAL);
  return { answer, refused, disclaimer: DISCLAIMER };
}
