/**
 * 摄取『保险资料/』→ 分块 → 嵌入 → 本地向量索引 data/rag-index.json。
 *
 *   npm run -w @ensureok/rag ingest
 *
 * 嵌入后端由 .env 决定:有 OPENAI_API_KEY 走 OpenAI,否则用离线 stub(可先跑通流程)。
 * 索引文件较大且与模型绑定,不提交进仓库(.gitignore)。
 * 本版只摄取 .md(169+ 份);PDF 保单条款抽取是后续工程点(pdfjs),此处仅计数提示。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkMarkdown } from '../src/chunk';
import { deriveMeta } from '../src/meta';
import { createEmbeddingProvider } from '../src/embedding';
import { JsonVectorStore } from '../src/store';
import type { Chunk } from '../src/types';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');

// 载入仓库根 .env(含 OPENAI_API_KEY 等);Node ≥20.12 内置,无需 dotenv 依赖。无 .env 则走 stub。
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* 无 .env,继续(会用 stub) */
}

const sourceRoot = process.env.RAG_SOURCE_ROOT
  ? resolve(process.env.RAG_SOURCE_ROOT)
  : resolve(REPO_ROOT, '../保险资料');

if (!existsSync(sourceRoot)) {
  console.error(`[ingest] 找不到语料目录:\n  ${sourceRoot}\n用 RAG_SOURCE_ROOT 指定其绝对路径。`);
  process.exit(1);
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(sourceRoot);
const mdFiles = files.filter((f) => f.endsWith('.md'));
const pdfCount = files.filter((f) => f.toLowerCase().endsWith('.pdf')).length;

const chunks: Chunk[] = [];
for (const f of mdFiles) {
  const rel = relative(sourceRoot, f);
  chunks.push(...chunkMarkdown(readFileSync(f, 'utf8'), deriveMeta(rel)));
}

const provider = createEmbeddingProvider();
console.log(`[ingest] 语料目录: ${sourceRoot}`);
console.log(`[ingest] 嵌入后端: ${provider.id}(${provider.model}, ${provider.dimensions} 维)`);
console.log(`[ingest] md 文件: ${mdFiles.length},分块: ${chunks.length};跳过 PDF: ${pdfCount}(条款抽取为后续工程点)`);
if (provider.id === 'stub') {
  console.log('[ingest] ⚠️ 当前用离线 stub 嵌入(无语义质量)。真实检索请在 .env 配 OPENAI_API_KEY 后重跑。');
}

const t0 = Date.now();
const vectors = await provider.embed(chunks.map((c) => c.text));
const store = new JsonVectorStore({ model: provider.model, dimensions: provider.dimensions, builtWith: provider.id });
store.add(chunks.map((c, i) => ({ ...c, vector: vectors[i] })));

const outDir = join(PKG_ROOT, 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'rag-index.json');
writeFileSync(outFile, JSON.stringify(store.toJSON()), 'utf8');

console.log(`[ingest] 索引写入: ${outFile}(${store.size()} 块,耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
