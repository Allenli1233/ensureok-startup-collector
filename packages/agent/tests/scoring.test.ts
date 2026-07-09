import { describe, expect, it } from 'vitest';
import { softPass } from '../src/judge';
import { applyFaithfulness, buildScoreCard, decideVerdict, scoreDeterministic } from '../src/scoring';
import type { ClaimJudgement, KeyClause } from '../src/types';

describe('decideVerdict 滞回带(M2)', () => {
  it('gate fail → 直接 fail', () => {
    expect(decideVerdict(100, 5, ['compliance'])).toBe('fail');
  });
  it('fidelity<3 → fail', () => {
    expect(decideVerdict(100, 2, [])).toBe('fail');
  });
  it('≥78 → pass;≤72 → fail', () => {
    expect(decideVerdict(78, 5, [])).toBe('pass');
    expect(decideVerdict(72, 5, [])).toBe('fail');
  });
  it('滞回带(72<score<78):维持上一轮,首轮按 fail', () => {
    expect(decideVerdict(75, 5, [], 'pass')).toBe('pass');
    expect(decideVerdict(75, 5, [], 'fail')).toBe('fail');
    expect(decideVerdict(75, 5, [])).toBe('fail'); // 首轮无 prev
  });
});

describe('scoreDeterministic 确定性三维', () => {
  it('干净文本:三维全 pass', () => {
    const d = scoreDeterministic('雇主责任险承保工伤赔偿,建议关注上下班途中扩展。', ['中国人保']);
    expect(d.compliance.verdict).toBe('pass');
    expect(d.accuracy.verdict).toBe('pass');
    expect(d.pricing.verdict).toBe('pass');
  });
  it('含保费数字 → compliance + pricing 双 fail', () => {
    const d = scoreDeterministic('年保费约 5000 元起。', ['中国人保']);
    expect(d.compliance.verdict).toBe('fail');
    expect(d.pricing.verdict).toBe('fail');
    expect(d.complianceFlags).toContain('R1_premium');
  });
  it('白名单外保司 → accuracy fail', () => {
    const d = scoreDeterministic('推荐太保的产品最合适。', ['中国人保', '平安']);
    expect(d.accuracy.verdict).toBe('fail');
  });
  it('白名单内保司 → accuracy pass', () => {
    const d = scoreDeterministic('推荐中国人保与平安的产品。', ['中国人保', '平安']);
    expect(d.accuracy.verdict).toBe('pass');
  });
});

describe('buildScoreCard weightedScore', () => {
  it('全 5 分 → 100 且 pass', () => {
    const det = scoreDeterministic('干净文本。', ['中国人保']);
    const card = buildScoreCard(det, softPass());
    expect(card.weightedScore).toBe(100);
    expect(card.verdict).toBe('pass');
  });
  it('gate fail 时 verdict=fail 且 gateFailed 记录', () => {
    const det = scoreDeterministic('年保费约 5000 元。', ['中国人保']);
    const card = buildScoreCard(det, softPass());
    expect(card.gateFailed).toEqual(expect.arrayContaining(['compliance', 'pricing']));
    expect(card.verdict).toBe('fail');
  });
});

describe('applyFaithfulness(H1 heading 比对 + M3 rebind + 非破坏性)', () => {
  const clause = (text: string, evidenceRefs: string[], clauseType?: KeyClause['clauseType']): KeyClause => ({ text, evidenceRefs, clauseType });

  it('无核对:默认 entailed,不改条款', () => {
    const r = applyFaithfulness([clause('要点', ['c0'])], [], new Map(), false);
    expect(r.clauses[0].faithfulness).toBe('entailed');
    expect(r.anyUnverified).toBe(false);
  });

  it('not-supported 无 rebind → 标 unverified 保留(非破坏性)', () => {
    const claims: ClaimJudgement[] = [{ index: 0, status: 'not-supported', rebindTo: null }];
    const r = applyFaithfulness([clause('要点', ['c0'])], claims, new Map([['c0', []]]), false);
    expect(r.clauses).toHaveLength(1);
    expect(r.clauses[0].faithfulness).toBe('unverified');
    expect(r.anyUnverified).toBe(true);
  });

  it('not-supported 有 rebind → 改引更佳 chunk 并转 entailed(不删)', () => {
    const claims: ClaimJudgement[] = [{ index: 0, status: 'not-supported', rebindTo: 'c9' }];
    const r = applyFaithfulness([clause('要点', ['c0'])], claims, new Map([['c9', ['保险责任']]]), false);
    expect(r.clauses[0].evidenceRefs).toEqual(['c9']);
    expect(r.clauses[0].faithfulness).toBe('entailed');
  });

  it('H1:除外条款却引到"保险责任"heading → 强判 not-supported → unverified', () => {
    const r = applyFaithfulness([clause('某除外', ['c0'], '除外')], [], new Map([['c0', ['二、保险责任']]]), false);
    expect(r.clauses[0].faithfulness).toBe('unverified');
  });

  it('fidelityDestructive:not-supported 保留 not-supported 态(删除进人工队列,不即时删)', () => {
    const claims: ClaimJudgement[] = [{ index: 0, status: 'contradicted', rebindTo: null }];
    const r = applyFaithfulness([clause('要点', ['c0'])], claims, new Map([['c0', []]]), true);
    expect(r.clauses[0].faithfulness).toBe('contradicted');
    expect(r.clauses).toHaveLength(1);
  });
});
