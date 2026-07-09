import { describe, expect, it } from 'vitest';
import { answerQuestion, REFUSAL, type QaScope } from '../src/qa';
import type { ChatProvider } from '../src/llm/types';
import type { Proposal } from '../src/types';

function chatReturning(text: string): ChatProvider {
  return {
    id: 'x',
    model: 'x',
    async complete() {
      return text;
    },
    async completeWithTools() {
      return { content: '', toolCalls: [], finishReason: 'stop' };
    },
  };
}

function proposal(): Proposal {
  return {
    meta: { documentName: '保障方案建议', company: '测试', generatedAt: 'T', engine: 'e', llmModel: 'm', ragModel: 'r' },
    clientSummary: '行业 SaaS',
    items: [
      {
        lineId: 'employer_liability', lineName: '雇主责任险', urgency: 'high', tier: 'tier2', gapTitles: ['雇主责任险未覆盖'],
        coverageDirection: '承保工伤赔偿责任', rationale: '结合用工阶段风险', keyClauses: ['承保工伤'],
        recommendedProducts: [], pricing: { display: '', disclaimer: '', unavailable: true, source: 'product_db' },
        drilldownSourceFile: null, citations: [], evidenceInsufficient: false,
      },
    ],
    disclaimer: 'D',
  };
}

const reportScope: QaScope = { kind: 'report', proposal: proposal() };
const lineScope: QaScope = { kind: 'line', proposal: proposal(), lineId: 'employer_liability', evidence: [{ text: '雇主责任险承保工伤', sourceFile: 'a.md' }] };

describe('answerQuestion(报告解读员)', () => {
  it('in-scope 干净回答 → 原样返回,未婉拒', async () => {
    const r = await answerQuestion(chatReturning('雇主责任险主要承保员工工伤相关的赔偿责任。'), '这个险种保什么?', lineScope);
    expect(r.refused).toBe(false);
    expect(r.answer).toContain('工伤');
  });

  it('模型自己给出固定婉拒 → refused=true', async () => {
    const r = await answerQuestion(chatReturning(REFUSAL), '帮我算算该买多少保额', reportScope);
    expect(r.refused).toBe(true);
    expect(r.answer).toBe(REFUSAL);
  });

  it('答案泄漏红线(保费数字)→ 合规闸门换成婉拒', async () => {
    const r = await answerQuestion(chatReturning('这个险种年保费约 5000 元,性价比很高。'), '多少钱?', lineScope);
    expect(r.refused).toBe(true);
    expect(r.answer).toBe(REFUSAL);
    expect(r.answer).not.toContain('5000');
  });

  it('空回答 → 婉拒兜底', async () => {
    const r = await answerQuestion(chatReturning('   '), '?', reportScope);
    expect(r.refused).toBe(true);
  });

  it('report 域上下文含各险种,line 域只含该险种(不崩)', async () => {
    const r1 = await answerQuestion(chatReturning('本报告覆盖雇主责任险等。'), '这份报告讲了啥', reportScope);
    expect(r1.refused).toBe(false);
    const r2 = await answerQuestion(chatReturning('该险种承保工伤。'), '保什么', lineScope);
    expect(r2.refused).toBe(false);
  });
});
