import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ToolInvoker } from '@ensureok/agent';
import { buildExecutor } from './context.js';

/** 12 险种枚举(与 tool-core 一致) */
const LINE_IDS = [
  'employer_liability', 'product_liability', 'public_liability', 'group_accident', 'directors_officers',
  'cyber', 'ip', 'tech_eo', 'ai_liability', 'cargo', 'credit_surety', 'environmental',
] as const;

/** 把 tool-core 的 ToolResult 包成 MCP 文本内容;失败也结构化返回,不抛。 */
async function call(invoke: ToolInvoker, name: string, args: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const r = await invoke(name, JSON.stringify(args));
  const text = r.ok ? JSON.stringify(r.data, null, 2) : JSON.stringify({ error: r.error, code: r.code });
  return { content: [{ type: 'text', text }], isError: !r.ok };
}

/**
 * @ensureok/mcp —— 对外只暴露 4 个**确定性/检索**工具(M1:不含 generate/score,不触发我方生成 LLM)。
 * 复用 tool-core(createToolExecutor,audience:'mcp'),业务零重复。transport 只用 stdio(§6:严禁无鉴权切 HTTP)。
 */
async function main(): Promise<void> {
  const invoke = await buildExecutor();
  const server = new McpServer({ name: 'ensureok-insurance', version: '0.1.0' });

  server.registerTool(
    'query_catalog',
    {
      title: '查询险种产品/保司/价格表结构',
      description: '按险种 code 返回产品库中该险种的保司白名单、价格表维度/列名与来源(不返回具体价格数字)。',
      inputSchema: { lineId: z.enum(LINE_IDS).describe('险种 code') },
    },
    async ({ lineId }) => call(invoke, 'query_catalog', { lineId }),
  );

  server.registerTool(
    'retrieve_clauses',
    {
      title: '检索保险条款证据',
      description: '按险种中文名 + 查询语义,从 RAG 索引检索原文条款块,返回带 chunkId/headingPath 的证据。',
      inputSchema: {
        lineName: z.string().describe('险种中文名,如「雇主责任险」'),
        query: z.string().describe('检索意图,如「等待期 免赔额 除外责任」'),
        topK: z.number().int().min(1).max(10).optional().describe('返回条数(默认 5)'),
      },
    },
    async ({ lineName, query, topK }) => call(invoke, 'retrieve_clauses', { lineName, query, topK }),
  );

  server.registerTool(
    'compute_pricing',
    {
      title: '按产品库算参考年保费区间(保费/保额分离)',
      description: '从产品库价格表隔离保费(排除保额档)算参考年保费区间(确定性,数字仅来自产品库,非成交报价)。',
      inputSchema: { lineId: z.enum(LINE_IDS).describe('险种 code') },
    },
    async ({ lineId }) => call(invoke, 'compute_pricing', { lineId }),
  );

  server.registerTool(
    'check_compliance',
    {
      title: '合规红线自检',
      description: '正则/词表检测文本是否泄漏红线(保费数字/招揽 CTA/白名单外保司/绝对化承诺)。仅防表面 token,不判语义。',
      inputSchema: { text: z.string().describe('待检文本') },
    },
    async ({ text }) => call(invoke, 'check_compliance', { text }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout 专供 JSON-RPC 帧,任何日志走 stderr(否则毁协议帧)
  console.error('[ensureok-mcp] ready on stdio · 4 deterministic tools · no generation LLM');
}

main().catch((e: unknown) => {
  console.error('[ensureok-mcp] fatal:', e);
  process.exit(1);
});
