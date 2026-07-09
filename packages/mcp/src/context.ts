import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolExecutor, loadCatalogs, type ToolInvoker } from '@ensureok/agent';
import { createEmbeddingProvider, loadStore } from '@ensureok/rag';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');

/**
 * 一次性装配确定性工具的执行上下文(§6.4):catalog + rag 索引 + 嵌入。
 * **不装配 chat provider** —— 对外只暴露 4 个确定性工具,不触发我方生成 LLM(M1)。
 * 路径/密钥全走环境变量,不硬编码。stdout 专供 JSON-RPC,调试输出走 stderr。
 */
export async function buildExecutor(): Promise<ToolInvoker> {
  const proc = process as unknown as { loadEnvFile?: (p: string) => void };
  try {
    proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
  } catch {
    /* 无 .env → 依赖已导出的环境变量 */
  }

  const catalogPath = process.env.ENSUREOK_CATALOG_JSON ?? resolve(REPO_ROOT, 'packages/catalog/data/catalog.json');
  const ragPath = process.env.ENSUREOK_RAG_INDEX ?? resolve(REPO_ROOT, 'packages/rag/data/rag-index.json');

  const catalogs = loadCatalogs(catalogPath);
  const ragStore = await loadStore(ragPath);
  const embedding = createEmbeddingProvider(); // 仅供检索,不触发生成

  // audience:'mcp' → compute_pricing 回完整数值给客户端;无 lineScope(客户端自由驱动)
  return createToolExecutor({ catalogs, ragStore, embedding, audience: 'mcp' });
}
