import type { EmbeddedChunk, QueryOptions, RetrievedChunk, VectorIndexFile, VectorStore } from './types';

/** 余弦相似度(向量为空或零范数时返回 0) */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 内存 JSON 向量库:元数据预过滤 → 暴力 cosine → topK。规模(保险资料几千块)完全够用。 */
export class JsonVectorStore implements VectorStore {
  private chunks: EmbeddedChunk[];
  readonly model: string;
  readonly dimensions: number;
  readonly builtWith: string;

  constructor(opts: { model: string; dimensions: number; builtWith: string; chunks?: EmbeddedChunk[] }) {
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.builtWith = opts.builtWith;
    this.chunks = opts.chunks ?? [];
  }

  static fromIndex(index: VectorIndexFile): JsonVectorStore {
    return new JsonVectorStore({
      model: index.model,
      dimensions: index.dimensions,
      builtWith: index.builtWith,
      chunks: index.chunks,
    });
  }

  size(): number {
    return this.chunks.length;
  }

  add(chunks: EmbeddedChunk[]): void {
    this.chunks.push(...chunks);
  }

  query(vector: number[], opts: QueryOptions = {}): RetrievedChunk[] {
    const { topK = 6, insuranceLines, corpus, docCategories } = opts;
    let pool = this.chunks;
    if (insuranceLines?.length) {
      pool = pool.filter((c) => c.meta.insuranceLine !== null && insuranceLines.includes(c.meta.insuranceLine));
    }
    if (corpus?.length) pool = pool.filter((c) => corpus.includes(c.meta.corpus));
    if (docCategories?.length) pool = pool.filter((c) => docCategories.includes(c.meta.docCategory));

    return pool
      .map((c) => ({ ...c, score: cosine(vector, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  toJSON(): VectorIndexFile {
    return {
      model: this.model,
      dimensions: this.dimensions,
      builtWith: this.builtWith,
      chunkCount: this.chunks.length,
      chunks: this.chunks,
    };
  }
}
