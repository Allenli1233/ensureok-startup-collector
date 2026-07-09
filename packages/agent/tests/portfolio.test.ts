import { describe, expect, it } from 'vitest';
import { StubChatProvider } from '../src/llm/stub';
import type { ChatProvider } from '../src/llm/types';
import { portfolioReview } from '../src/portfolio';
import { runToolLoop } from '../src/llm/toolRunner';
import { pricingFromComputed } from '../src/pricing';
import type { ProposalItem } from '../src/types';

function item(lineId: ProposalItem['lineId'], lineName: string, urgency: ProposalItem['urgency'] = 'high'): ProposalItem {
  return {
    lineId, lineName, urgency, tier: 'tier2', gapTitles: ['缺口'],
    coverageDirection: 'x', rationale: 'y', keyClauses: [], recommendedProducts: [],
    pricing: { display: '', disclaimer: '', unavailable: true, source: 'product_db' },
    drilldownSourceFile: null, citations: [], evidenceInsufficient: false,
  };
}

describe('PR5 组合层评审', () => {
  it('出海三件套 → 聚合成出海综合责任包', async () => {
    const items = [item('tech_eo', '科技E&O'), item('cyber', '网络安全险'), item('product_liability', '产品责任险')];
    const pf = await portfolioReview(items, new StubChatProvider() as ChatProvider);
    expect(pf.bundles).toHaveLength(1);
    expect(pf.bundles[0].lines).toEqual(expect.arrayContaining(['科技E&O', '网络安全险', '产品责任险']));
  });

  it('公众责任 + 产品责任 → 标注责任重叠', async () => {
    const items = [item('public_liability', '公众责任险'), item('product_liability', '产品责任险')];
    const pf = await portfolioReview(items, new StubChatProvider() as ChatProvider);
    expect(pf.overlaps).toHaveLength(1);
    expect(pf.overlaps[0].lines).toEqual(expect.arrayContaining(['公众责任险', '产品责任险']));
  });

  it('组合说明命中红线 → 退回确定性说明(不硬发)+ reran', async () => {
    const leaky: ChatProvider = {
      id: 'leak', model: 'leak',
      async complete() { return '建议立即投保,年保费约 5000 元。'; },
      async completeWithTools() { return { content: '', toolCalls: [], finishReason: 'stop' }; },
    };
    const items = [item('employer_liability', '雇主责任险', 'mandatory'), item('cyber', '网络安全险')];
    const pf = await portfolioReview(items, leaky);
    expect(pf.summary).not.toContain('5000');
    expect(pf.summary).not.toContain('立即投保');
    expect(pf.reran).toBe(true);
  });
});

describe('PR5 pricingFromComputed(保费/保额分离)', () => {
  it('有隔离保费 → 年保费区间', () => {
    const h = pricingFromComputed({ lineId: 'employer_liability', lineName: '雇主责任险', matchTier: 'bracket', currency: 'CNY', premiumMinCny: 800, premiumMaxCny: 3200, basis: 'x', rowRefs: [], collectedAt: '2026年7月9日' });
    expect(h.unavailable).toBe(false);
    expect(h.display).toContain('年保费');
    expect(h.minCny).toBe(800);
  });
  it('无价目表 → 引导下钻', () => {
    const h = pricingFromComputed({ lineId: 'ai_liability', lineName: 'AI责任险', matchTier: 'blank', currency: 'CNY', basis: 'x', rowRefs: [], unavailableReason: 'no_price_table' });
    expect(h.unavailable).toBe(true);
  });
});

describe('PR5 runToolLoop', () => {
  it('无 toolCalls → 首轮收敛(等价单次生成)', async () => {
    const chat: ChatProvider = {
      id: 's', model: 's',
      async complete() { return 'x'; },
      async completeWithTools() { return { content: '最终答案', toolCalls: [], finishReason: 'stop' }; },
    };
    const r = await runToolLoop(chat, [{ role: 'user', content: 'q' }], [], async () => ({ ok: true, data: {} }));
    expect(r.content).toBe('最终答案');
    expect(r.steps).toBe(1);
    expect(r.trace).toHaveLength(0);
  });

  it('一轮工具调用 → 回填后收敛,trace 记录', async () => {
    let turn = 0;
    const chat: ChatProvider = {
      id: 's', model: 's',
      async complete() { return 'x'; },
      async completeWithTools() {
        turn++;
        return turn === 1
          ? { content: '', toolCalls: [{ id: 't1', type: 'function', function: { name: 'query_catalog', arguments: '{"lineId":"cyber"}' } }], finishReason: 'tool_calls' }
          : { content: '带工具结果的答案', toolCalls: [], finishReason: 'stop' };
      },
    };
    const r = await runToolLoop(chat, [{ role: 'user', content: 'q' }], [], async () => ({ ok: true, data: { insurers: ['众安'] } }));
    expect(r.content).toBe('带工具结果的答案');
    expect(r.trace).toEqual([{ tool: 'query_catalog', args: '{"lineId":"cyber"}', ok: true }]);
  });
});
