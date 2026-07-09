import { readFile } from 'node:fs/promises';
import type { EmbeddingProvider, QueryOptions, RetrievedChunk, VectorIndexFile } from './types';
import { JsonVectorStore } from './store';

/** 从落盘索引文件加载向量库 */
export async function loadStore(indexPath: string): Promise<JsonVectorStore> {
  const raw = await readFile(indexPath, 'utf8');
  const index = JSON.parse(raw) as VectorIndexFile;
  return JsonVectorStore.fromIndex(index);
}

/**
 * 语义检索:把查询文本嵌入后在向量库里取 topK。
 * 用于 Agent 管道(PR3b)按险种召回条款/理由证据;价格不走这里(价格只信 @ensureok/catalog)。
 */
export async function retrieve(
  store: JsonVectorStore,
  provider: EmbeddingProvider,
  queryText: string,
  opts?: QueryOptions,
): Promise<RetrievedChunk[]> {
  if (provider.model !== store.model) {
    throw new Error(
      `嵌入模型不一致:索引用 ${store.model},当前 provider 用 ${provider.model}。请用同一模型重建索引。`,
    );
  }
  const [vector] = await provider.embed([queryText]);
  return store.query(vector, opts);
}
