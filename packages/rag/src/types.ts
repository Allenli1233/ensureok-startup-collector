/** RAG 语义检索库的类型 —— 保险资料/(条款/法规/案例/实务/选购方法论)的分块、嵌入、检索。 */

export interface ChunkMeta {
  /** 相对『保险资料/』的源文件路径 */
  sourceFile: string;
  /** product=保险产品/(纵向险种库),guide=选购指南/(横向方法论) */
  corpus: 'product' | 'guide';
  /** 险种中文名(如 '雇主责任险');横向文档为 null */
  insuranceLine: string | null;
  /** 资料类别:学术文献/法律法规/行业报告/实务指南/司法案例/政策文件/总览/选购指南 */
  docCategory: string;
  /** 章节标题路径,如 ['二、保险责任','2.1 保障范围'] */
  headingPath: string[];
}

export interface Chunk {
  /** 稳定 id = hash(sourceFile + headingPath + ordinal),内容不变则 id 不变(增量摄取用) */
  id: string;
  /** 块文本(已在头部拼入 headingPath,便于检索命中上下文) */
  text: string;
  meta: ChunkMeta;
}

export interface EmbeddedChunk extends Chunk {
  vector: number[];
}

export interface RetrievedChunk extends Chunk {
  /** 与查询的余弦相似度 [-1,1] */
  score: number;
}

/** 嵌入后端(OpenAI / stub 可插拔,接口天然支持自定义 endpoint 与超时) */
export interface EmbeddingProvider {
  /** 实现标识,如 'openai' / 'stub' */
  readonly id: string;
  /** 模型名(写进索引 meta,换模型需重嵌) */
  readonly model: string;
  /** 向量维度 */
  readonly dimensions: number;
  /** 批量嵌入,返回顺序与输入一致 */
  embed(texts: string[]): Promise<number[][]>;
}

export interface QueryOptions {
  topK?: number;
  /** 只在这些险种里检索(按 insuranceLine 中文名过滤) */
  insuranceLines?: string[];
  corpus?: Array<'product' | 'guide'>;
  docCategories?: string[];
}

export interface VectorStore {
  size(): number;
  add(chunks: EmbeddedChunk[]): void;
  query(vector: number[], opts?: QueryOptions): RetrievedChunk[];
  toJSON(): VectorIndexFile;
}

/** 落盘索引文件结构 */
export interface VectorIndexFile {
  model: string;
  dimensions: number;
  builtWith: string; // provider id
  chunkCount: number;
  chunks: EmbeddedChunk[];
}
