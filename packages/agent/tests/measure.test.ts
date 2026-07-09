import { describe, expect, it } from 'vitest';
import { summarizeProposals } from '../src/measure';
import type { Proposal, ProposalItem, ScoreCard } from '../src/types';

function card(verdict: 'pass' | 'fail', gateFailed: ScoreCard['gateFailed'] = []): ScoreCard {
  return {
    dimensions: {
      compliance: { score: 5, notes: [] }, accuracy: { score: 5, notes: [] }, pricing: { score: 5, notes: [] },
      fidelity: { score: 5, notes: [] }, persuasion: { score: 5, notes: [] },
    },
    weightedScore: verdict === 'pass' ? 100 : 40,
    verdict, gateFailed, revisionInstructions: [],
  };
}

function item(over: Partial<ProposalItem>): ProposalItem {
  return {
    lineId: 'employer_liability', lineName: '雇主责任险', urgency: 'high', tier: 'tier2', gapTitles: [],
    coverageDirection: '', rationale: '', keyClauses: [], recommendedProducts: [],
    pricing: { display: '', disclaimer: '', unavailable: true, source: 'product_db' },
    drilldownSourceFile: null, citations: [], evidenceInsufficient: false, ...over,
  };
}

function proposal(items: ProposalItem[]): Proposal {
  return {
    meta: { documentName: '保障方案建议', company: 'x', generatedAt: 'T', engine: 'e', llmModel: 'm', ragModel: 'r' },
    clientSummary: '', items, disclaimer: '',
  };
}

describe('PR4.5 summarizeProposals', () => {
  it('聚合 pass/degraded/calls/score/faithfulness', () => {
    const p = proposal([
      item({ qualityScore: 100, callsUsed: 2, scoreCards: [card('pass')], keyClausesDetailed: [{ text: 'a', evidenceRefs: ['c0'], faithfulness: 'entailed' }] }),
      item({ qualityScore: 40, callsUsed: 6, degraded: true, degradedReason: '质检未达标(40/100,gate:无)', scoreCards: [card('fail')], keyClausesDetailed: [{ text: 'b', evidenceRefs: [], faithfulness: 'unverified' }] }),
      item({ lineName: '网络安全险', qualityScore: 80, callsUsed: 4, scoreCards: [card('fail', ['compliance'])], keyClausesDetailed: [{ text: 'c', evidenceRefs: [], faithfulness: 'not-supported' }] }),
    ]);
    const r = summarizeProposals([p]);
    expect(r.loopItems).toBe(3);
    expect(r.passRate).toBe(round(1 / 3));
    expect(r.degradedRate).toBe(round(1 / 3));
    expect(r.calls).toEqual({ avg: 4, max: 6, total: 12 });
    expect(r.score).toEqual({ min: 40, avg: expect.any(Number), max: 100 });
    expect(r.gateHitRate).toBe(round(1 / 3));
    expect(r.faithfulness).toEqual({ entailed: 1, unverified: 1, 'not-supported': 1, contradicted: 0 });
    expect(r.linesCovered).toEqual(['雇主责任险', '网络安全险']);
    expect(r.degradedReasons['质检未达标']).toBe(1);
  });

  it('无 loop item(未开 loop)→ 比率为 0,不崩', () => {
    const r = summarizeProposals([proposal([item({})])]);
    expect(r.loopItems).toBe(0);
    expect(r.passRate).toBe(0);
    expect(r.calls.total).toBe(0);
  });
});

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;
