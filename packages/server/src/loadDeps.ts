import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogs, createChatProvider } from '@ensureok/agent';
import { createEmbeddingProvider, loadStore } from '@ensureok/rag';
import type { ServerDeps } from './server';

/**
 * 从磁盘 + .env 组装真实依赖:产品库 catalog.json、RAG 索引、OpenAI 嵌入/对话后端。
 * 前置:catalog:build 生成 catalog.json、rag:ingest 生成 rag-index.json、.env 配 OPENAI_API_KEY。
 */
export async function loadDeps(): Promise<ServerDeps> {
  const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const REPO_ROOT = resolve(PKG_ROOT, '../..');
  const proc = process as unknown as { loadEnvFile?: (p: string) => void };
  try {
    proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
  } catch {
    /* 无 .env → 走 stub */
  }

  const catalogs = loadCatalogs(resolve(REPO_ROOT, 'packages/catalog/data/catalog.json'));
  const ragStore = await loadStore(resolve(REPO_ROOT, 'packages/rag/data/rag-index.json'));
  return { catalogs, ragStore, embedding: createEmbeddingProvider(), chat: createChatProvider() };
}
