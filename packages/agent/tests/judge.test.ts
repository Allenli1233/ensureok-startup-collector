import { describe, expect, it } from 'vitest';
import { LlmJudge, type JudgeInput } from '../src/judge';
import type { ChatProvider } from '../src/llm/types';

const input: JudgeInput = {
  lineName: '雇主责任险',
  coverageDirection: '方向',
  rationale: '理由',
  clauses: [{ index: 0, text: '要点', evidenceRefs: ['c0'] }],
  evidence: [{ chunkId: 'c0', text: '证据', sourceFile: 'a.md' }],
};

function chatReturning(raw: string): ChatProvider {
  return {
    id: 'x',
    model: 'x',
    async complete() {
      return raw;
    },
    async completeWithTools() {
      return { content: '', toolCalls: [], finishReason: 'stop' };
    },
  };
}

describe('LlmJudge 解析加固', () => {
  it('```json 围栏包裹的输出正确解析出 fidelity/persuasion(回归 pass 率 0 的根因)', async () => {
    const raw = '```json\n{"fidelity":5,"persuasion":4,"claims":[{"index":0,"status":"entailed","rebindTo":null,"note":""}],"vagueSentences":[],"revisionInstructions":[]}\n```';
    const j = new LlmJudge(chatReturning(raw), true);
    const s = await j.scoreSoft(input);
    expect(s.fidelity).toBe(5);
    expect(s.persuasion).toBe(4);
    expect(s.claims[0].status).toBe('entailed');
  });

  it('围栏 + 尾随散文也能提取 JSON', async () => {
    const raw = '好的,评审如下:\n```json\n{"fidelity":3,"persuasion":2}\n```\n以上就是我的评审。';
    const j = new LlmJudge(chatReturning(raw), true);
    const s = await j.scoreSoft(input);
    expect(s.fidelity).toBe(3);
    expect(s.persuasion).toBe(2);
  });

  it('模型自造键名(无 fidelity 字段)→ 兜底 0,不崩', async () => {
    const j = new LlmJudge(chatReturning('{"评审类型":"忠实度","整体评价":"优秀"}'), true);
    const s = await j.scoreSoft(input);
    expect(s.fidelity).toBe(0);
    expect(s.persuasion).toBe(0);
  });
});
