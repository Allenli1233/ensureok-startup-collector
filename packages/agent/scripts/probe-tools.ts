/**
 * function-calling 探活 —— 用 .env 里的中转发一个最小 tools 请求,判断它支不支持原生工具调用。
 *
 *   npm run -w @ensureok/agent probe:tools
 *
 * 支持 → 设计走原生 function-calling;不支持 → 走"伪工具协议"降级(设计 §11.1)。
 * 不烧多少 token(一次极短请求)。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatProvider } from '../src/llm';
import type { ToolDef } from '../src/llm/types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* 无 .env → stub */
}

const provider = createChatProvider();

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_weather',
      description: '查询某城市当前天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名' } },
        required: ['city'],
      },
    },
  },
];

console.log(`探活后端: ${provider.id} / ${provider.model}`);
if (provider.id === 'stub') {
  console.log('⚠️ 当前是 stub(未配 OPENAI_API_KEY),无法探活真实中转。请在 .env 配好 key 后重跑。');
  process.exit(0);
}

try {
  const turn = await provider.completeWithTools(
    [{ role: 'user', content: '北京现在天气怎么样?请调用工具查询。' }],
    { tools, toolChoice: 'auto', temperature: 0 },
  );
  console.log(`finishReason: ${turn.finishReason}`);
  console.log(`toolCalls: ${turn.toolCalls.length} 个 ${JSON.stringify(turn.toolCalls.map((t) => ({ name: t.function.name, args: t.function.arguments })))}`);
  console.log(`content: ${turn.content.slice(0, 120)}`);
  if (turn.toolCalls.length > 0 || turn.finishReason === 'tool_calls') {
    console.log('\n✅ 中转【支持】function calling —— 走原生 tool-calling(设计 §4)。');
  } else {
    console.log('\n⚠️ 中转【未触发 tool_calls】—— 可能不支持 function calling,需走伪工具协议降级(设计 §11.1)。');
  }
} catch (e) {
  console.log(`\n❌ 请求出错(多半是中转不接受 tools 参数)—— 判定【不支持】,走伪工具协议降级(设计 §11.1)。\n   ${String(e).slice(0, 300)}`);
}
