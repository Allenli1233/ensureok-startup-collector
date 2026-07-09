import { OpenAIChatProvider } from './llm/openai';
import type { ChatMessage, ChatProvider } from './llm/types';
import type { QualityScore } from './types';

export interface JudgeInput {
  lineName: string;
  coverageDirection: string;
  rationale: string;
  keyClauses: string[];
  evidence: Array<{ text: string; sourceFile: string }>;
}

export interface Judge {
  readonly id: string;
  readonly model: string;
  score(input: JudgeInput): Promise<QualityScore>;
}

const SYSTEM = `你是保险方案的质检评审员(独立第二意见)。只评两个"软维度",各 0-5 分:
1. fidelity 条款忠实度:方案的"条款要点/承保方向"是否忠实于<证据>原文——有没有编造证据里没有的条款、或曲解原意。证据支持越充分越高分;凭空杜撰给低分。
2. persuasion 说服力与可读性:推荐理由是否结合企业画像、具体不空泛、专业中立。套话/泛泛给低分。
只输出 JSON(不要多余文字、不要代码围栏):
{"fidelity": <0-5整数>, "persuasion": <0-5整数>, "fidelityFeedback": "一句话:忠实度问题与如何改", "persuasionFeedback": "一句话:说服力问题与如何改"}
注意:价格、保司、合规红线由系统确定性工具另行把关,不在你职责内——不要因此扣分,也不要在反馈里提金额。`;

function buildJudgeMessages(input: JudgeInput): ChatMessage[] {
  const evidence = input.evidence.length
    ? input.evidence.map((e, i) => `[E${i + 1}] (${e.sourceFile})\n${e.text.slice(0, 500)}`).join('\n\n')
    : '(无检索证据)';
  const user = `险种:${input.lineName}
【承保方向】${input.coverageDirection}
【推荐理由】${input.rationale}
【条款要点】${input.keyClauses.join(' | ') || '(空)'}

<证据>
${evidence}
</证据>

对上面这条方案打分。只输出 JSON。`;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}

function clamp05(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function parseJson(s: string): Record<string, unknown> | null {
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

/** 用一个 ChatProvider(建议异构模型,如 claude-*)当 judge。总分阈值默认 7/10。 */
export class LlmJudge implements Judge {
  readonly id = 'llm-judge';
  readonly model: string;
  constructor(
    private readonly chat: ChatProvider,
    private readonly threshold = 7,
  ) {
    this.model = chat.model;
  }

  async score(input: JudgeInput): Promise<QualityScore> {
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = await this.chat.complete(buildJudgeMessages(input), { temperature: 0 });
      if (process.env.JUDGE_DEBUG === '1') console.error(`[judge ${input.lineName}] raw:`, JSON.stringify(raw.slice(0, 400)));
      parsed = parseJson(raw);
    } catch (e) {
      if (process.env.JUDGE_DEBUG === '1') console.error(`[judge ${input.lineName}] ERROR:`, String(e).slice(0, 300));
      parsed = null;
    }
    const fidelity = clamp05(parsed?.fidelity);
    const persuasion = clamp05(parsed?.persuasion);
    const total = fidelity + persuasion;
    return {
      fidelity,
      persuasion,
      total,
      passed: total >= this.threshold,
      feedback: { fidelity: asStr(parsed?.fidelityFeedback), persuasion: asStr(parsed?.persuasionFeedback) },
    };
  }
}

export function passScore(): QualityScore {
  return { fidelity: 5, persuasion: 5, total: 10, passed: true, feedback: { fidelity: '', persuasion: '' } };
}
export function failScore(fb = '需更贴合证据'): QualityScore {
  return { fidelity: 2, persuasion: 2, total: 4, passed: false, feedback: { fidelity: fb, persuasion: fb } };
}

/** 确定性桩 judge:按给定序列返回评分(默认恒通过),供单测复现 loop 行为。 */
export class StubJudge implements Judge {
  readonly id = 'stub-judge';
  readonly model = 'stub-judge';
  private i = 0;
  constructor(private readonly scores: QualityScore[] = [passScore()]) {}
  async score(): Promise<QualityScore> {
    const s = this.scores[Math.min(this.i, this.scores.length - 1)];
    this.i++;
    return s;
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * 按 .env 选 judge 后端。强烈建议 judge 用与生成不同家族的模型(第二意见,避免自评盲区):
 *   OPENAI_JUDGE_MODEL(默认 claude-haiku-4-5)· JUDGE_THRESHOLD(默认 7/10)
 * 无 key → StubJudge(恒通过,供本地跑通)。
 */
export function createJudge(env: EnvLike = process.env): Judge {
  if (env.OPENAI_API_KEY) {
    const chat = new OpenAIChatProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001',
    });
    // 防御式解析:空串/非数字都回退默认 7(避免 Number('')=0 关掉闸门、Number('x')=NaN 全判不达标)
    const t = Number(env.JUDGE_THRESHOLD);
    const threshold = Number.isFinite(t) && t > 0 ? t : 7;
    return new LlmJudge(chat, threshold);
  }
  return new StubJudge();
}
