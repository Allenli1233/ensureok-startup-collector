/**
 * RAG 检索自测 CLI —— 对已生成的 data/rag-index.json 跑一次语义检索,人工验证召回质量。
 *
 *   npm run -w @ensureok/rag query -- 雇主责任险 保险责任范围
 *   npm run -w @ensureok/rag query -- --line 网络安全险 数据泄露 应急处置
 *
 * 用 .env 里同一个嵌入后端(须与建索引时一致)。
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddingProvider } from '../src/embedding';
import { loadStore, retrieve } from '../src/retriever';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* 无 .env */
}

// 解析 --line <险种> 过滤(可选)
const argv = process.argv.slice(2);
let line: string | undefined;
const li = argv.indexOf('--line');
if (li >= 0) {
  line = argv[li + 1];
  argv.splice(li, 2);
}
const query = argv.join(' ').trim() || '雇主责任险的保险责任范围';

const store = await loadStore(join(PKG_ROOT, 'data', 'rag-index.json'));
const provider = createEmbeddingProvider();
const hits = await retrieve(store, provider, query, { topK: 5, insuranceLines: line ? [line] : undefined });

console.log(`查询: ${query}${line ? `  (仅 ${line})` : ''}`);
console.log(`索引: ${store.size()} 块 · 模型 ${store.model}\n`);
for (const h of hits) {
  console.log(`[${h.score.toFixed(3)}] ${h.meta.insuranceLine ?? '横向'} · ${h.meta.docCategory} · ${h.meta.sourceFile}`);
  if (h.meta.headingPath.length) console.log(`   ↳ ${h.meta.headingPath.join(' > ')}`);
  console.log(`   ${h.text.replace(/\s+/g, ' ').slice(0, 110)}…\n`);
}
