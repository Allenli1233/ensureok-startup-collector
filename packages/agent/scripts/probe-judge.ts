/**
 * judge 模型探活 —— 确认评分用的(异构)模型能经中转返回结构化 JSON。
 *   npm run -w @ensureok/agent probe:judge [model-id]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIChatProvider } from '../src/llm/openai';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* no .env */
}

const model = process.argv[2] ?? process.env.OPENAI_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001';
if (!process.env.OPENAI_API_KEY) {
  console.log('⚠️ 未配 OPENAI_API_KEY,无法探活。');
  process.exit(0);
}
const chat = new OpenAIChatProvider({ apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL, model });

console.log(`探活 judge 模型: ${model}`);
try {
  const out = await chat.complete(
    [{ role: 'user', content: '只输出这一个 JSON、不要任何多余文字:{"fidelity":4,"persuasion":3,"fidelityFeedback":"ok","persuasionFeedback":"ok"}' }],
    { temperature: 0 },
  );
  console.log('原始返回:', JSON.stringify(out.slice(0, 300)));
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    console.log(`✅ 可解析 JSON,fidelity=${parsed.fidelity} persuasion=${parsed.persuasion} —— judge 模型可用。`);
  } else {
    console.log('⚠️ 返回里没找到 JSON —— 需调整 judge 提示词或换模型。');
  }
} catch (e) {
  console.log(`❌ 请求出错(多半是模型 id 不对/中转不支持该模型):\n   ${String(e).slice(0, 400)}`);
}
