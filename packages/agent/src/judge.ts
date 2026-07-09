import { OpenAIChatProvider } from './llm/openai';
import type { ChatMessage, ChatProvider } from './llm/types';
import type { ClaimJudgement, RevisionInstruction } from './types';

/** 送给 judge 的草稿 + 该险种全部 top-K 证据(M3:不只喂被引 chunk) */
export interface JudgeInput {
  lineName: string;
  coverageDirection: string;
  rationale: string;
  /** 逐条 keyClause:文本 + 当前引用的 chunkId(judge 可 rebind) */
  clauses: Array<{ index: number; text: string; evidenceRefs: string[] }>;
  /** 该险种预检索的全部 top-K(judge 在此范围内判 entail / rebind) */
  evidence: Array<{ chunkId: string; text: string; sourceFile: string }>;
}

/** judge 只出两软维 + 逐条忠实度核对 + 重写指令(合规/价位/事实不归它管) */
export interface JudgeSoft {
  /** 0–5 */
  fidelity: number;
  /** 0–5 */
  persuasion: number;
  claims: ClaimJudgement[];
  vagueSentences: string[];
  revisionInstructions: RevisionInstruction[];
}

export interface Judge {
  readonly id: string;
  readonly model: string;
  /** 是否异构(与生成不同家族);仅异构且运营开启才允许破坏性删条款 */
  readonly heterogeneous: boolean;
  scoreSoft(input: JudgeInput): Promise<JudgeSoft>;
}

const SYSTEM = `你是保险方案的质检评审员(独立第二意见),只评两个"软维度",不碰价格/保司/合规红线(那些由系统确定性工具把关)。
1. fidelity 条款忠实度(0-5):逐条看 keyClause 是否被<证据>某个 chunk 支撑。
   - 被当前引用 chunk 支撑 → status:"entailed"。
   - 当前引用不支撑、但<证据>里"另一个 chunk"支撑它 → status:"not-supported" 且给 rebindTo:该 chunkId(改引不删)。
   - 讲反除外/责任、曲解原意 → status:"contradicted"。
   - 都找不到支撑 → status:"not-supported",rebindTo:null。
2. persuasion 说服力(0-5):rationale 是否绑定"缺口×责任×画像"、不空泛。套话给低分,并列出空泛原句。
只输出 JSON(无代码围栏、无多余文字):
{"fidelity":<0-5>,"persuasion":<0-5>,
 "claims":[{"index":<条款序号>,"status":"entailed|not-supported|contradicted","rebindTo":"<chunkId 或 null>","note":"一句话"}],
 "vagueSentences":["空泛原句"],
 "revisionInstructions":[{"target":"keyClauses[2]|rationale|coverageDirection","action":"rewrite|rebind","toRef":"<chunkId 或省略>","reason":"改什么、为什么"}]}`;

function buildMessages(input: JudgeInput): ChatMessage[] {
  const evidence = input.evidence.length
    ? input.evidence.map((e) => `[${e.chunkId}] (${e.sourceFile})\n${e.text.slice(0, 500)}`).join('\n\n')
    : '(无检索证据)';
  const clauses = input.clauses.length
    ? input.clauses.map((c) => `#${c.index} "${c.text}"  当前引用:[${c.evidenceRefs.join(', ') || '无'}]`).join('\n')
    : '(无条款)';
  // 关键:把 JSON 结构 + 字段名 + 填好的示例**直接放进 user 消息**(不只依赖 system)。
  // 否则中转把 system 弱化时,模型看不到 schema → 自造键名(如"评审类型"),fidelity/persuasion 全丢成 0。
  const exampleClaims = input.clauses.length
    ? input.clauses.map((c) => `{"index":${c.index},"status":"entailed","rebindTo":null,"note":""}`).join(',')
    : '';
  const user = `险种:${input.lineName}
【承保方向】${input.coverageDirection}
【推荐理由】${input.rationale}
【条款要点(逐条核对忠实度)】
${clauses}

<证据>(chunkId 标注,rebind 只能引这里的 id)
${evidence}
</证据>

只输出下面这个 JSON,**严格用这些英文字段名、不要改名、不要用中文键、不要代码围栏、不要多余文字**:
{"fidelity":<0-5整数,条款忠实度>,"persuasion":<0-5整数,说服力>,"claims":[${exampleClaims}],"vagueSentences":[],"revisionInstructions":[]}
说明:claims 每条 keyClause 一项(index 从 0 起);status 取 entailed/not-supported/contradicted;not-supported 时若<证据>里另有 chunk 支撑则填其 chunkId 到 rebindTo(改引不删),否则 rebindTo:null。`;
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
/** 提取第一个"括号配平"的 JSON 对象(避免贪婪 {…} 把示例+真身或尾随散文的花括号并成畸形串) */
function firstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

function parseJson(s: string): Record<string, unknown> | null {
  // judge 模型稳定用 ```json 围栏包裹 → 先去围栏
  const stripped = s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const balanced = firstBalancedObject(stripped);
  for (const candidate of [stripped, balanced, s]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

const VALID_STATUS = new Set(['entailed', 'not-supported', 'contradicted']);
function parseClaims(v: unknown): ClaimJudgement[] {
  if (!Array.isArray(v)) return [];
  const out: ClaimJudgement[] = [];
  v.forEach((c, pos) => {
    if (!c || typeof c !== 'object') return;
    const o = c as Record<string, unknown>;
    const idx = Number(o.index);
    // 键漂移(idx/序号 而非 index)→ 用数组位置兜底,避免整条 claim 被丢弃后忠实度悄悄默认 entailed(fail-unsafe)
    const index = Number.isInteger(idx) ? idx : pos;
    const status = VALID_STATUS.has(asStr(o.status)) ? (asStr(o.status) as ClaimJudgement['status']) : 'not-supported';
    const rebindTo = typeof o.rebindTo === 'string' && o.rebindTo ? o.rebindTo : null;
    out.push({ index, status, rebindTo, note: asStr(o.note) });
  });
  return out;
}
function parseRevisions(v: unknown): RevisionInstruction[] {
  if (!Array.isArray(v)) return [];
  const out: RevisionInstruction[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const target = asStr(o.target);
    if (!target) continue;
    const action = o.action === 'rebind' || o.action === 'keep' ? o.action : 'rewrite';
    out.push({ target, action, toRef: typeof o.toRef === 'string' ? o.toRef : undefined, reason: asStr(o.reason) });
  }
  return out;
}
function parseStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 用一个 ChatProvider(建议异构模型)当 judge,只出两软维 + 逐条核对。 */
export class LlmJudge implements Judge {
  readonly id = 'llm-judge';
  readonly model: string;
  constructor(
    private readonly chat: ChatProvider,
    readonly heterogeneous: boolean,
  ) {
    this.model = chat.model;
  }

  async scoreSoft(input: JudgeInput): Promise<JudgeSoft> {
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = await this.chat.complete(buildMessages(input), { temperature: 0 });
      if (process.env.JUDGE_DEBUG === '1') console.error(`[judge ${input.lineName}] raw:`, JSON.stringify(raw.slice(0, 400)));
      parsed = parseJson(raw);
    } catch (e) {
      if (process.env.JUDGE_DEBUG === '1') console.error(`[judge ${input.lineName}] ERROR:`, String(e).slice(0, 300));
      parsed = null;
    }
    return {
      fidelity: clamp05(parsed?.fidelity),
      persuasion: clamp05(parsed?.persuasion),
      claims: parseClaims(parsed?.claims),
      vagueSentences: parseStrArr(parsed?.vagueSentences),
      revisionInstructions: parseRevisions(parsed?.revisionInstructions),
    };
  }
}

/** 满分软维(entailed),供构造与测试用。 */
export function softPass(overrides: Partial<JudgeSoft> = {}): JudgeSoft {
  return { fidelity: 5, persuasion: 5, claims: [], vagueSentences: [], revisionInstructions: [], ...overrides };
}
/** 低分软维(未达标),供测试用。 */
export function softFail(overrides: Partial<JudgeSoft> = {}): JudgeSoft {
  return { fidelity: 2, persuasion: 2, claims: [], vagueSentences: ['过泛'], revisionInstructions: [], ...overrides };
}

/** 确定性桩 judge:按给定序列返回软维评分(默认恒满分),供单测复现 loop 行为。 */
export class StubJudge implements Judge {
  readonly id = 'stub-judge';
  readonly model = 'stub-judge';
  readonly heterogeneous: boolean;
  private i = 0;
  constructor(
    private readonly scores: JudgeSoft[] = [softPass()],
    heterogeneous = false,
  ) {
    this.heterogeneous = heterogeneous;
  }
  async scoreSoft(): Promise<JudgeSoft> {
    const s = this.scores[Math.min(this.i, this.scores.length - 1)];
    this.i++;
    return s;
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * 按 .env 选 judge 后端。强烈建议 judge 用与生成不同家族的模型(第二意见,避免自评盲区):
 *   OPENAI_JUDGE_MODEL(默认 claude-haiku-4-5)· JUDGE_HETEROGENEOUS=1 声明异构(允许破坏性,需再开 fidelityDestructive)
 * 无 key → StubJudge(恒满分,供本地跑通)。
 */
export function createJudge(env: EnvLike = process.env): Judge {
  if (env.OPENAI_API_KEY) {
    const chat = new OpenAIChatProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.OPENAI_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001',
    });
    return new LlmJudge(chat, env.JUDGE_HETEROGENEOUS === '1');
  }
  return new StubJudge();
}
