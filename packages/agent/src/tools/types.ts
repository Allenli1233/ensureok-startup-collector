import type { InsuranceLineId, ProductCatalog } from '@ensureok/catalog';
import type { EmbeddingProvider, JsonVectorStore } from '@ensureok/rag';

/** 工具受众:pipeline=生成内部(价格数值对 LLM 脱敏);mcp=对外客户端(完整数值) */
export type ToolAudience = 'pipeline' | 'mcp';

export interface ToolContext {
  catalogs: Map<InsuranceLineId, ProductCatalog>;
  ragStore: JsonVectorStore;
  embedding: EmbeddingProvider;
  audience: ToolAudience;
  /** pipeline 模式:钉死当前 worker 的险种;工具入参指向别的险种则拒绝(越权护栏,设计 H3) */
  lineScope?: InsuranceLineId;
}

export interface ToolOk<T> {
  ok: true;
  data: T;
}
export interface ToolErr {
  ok: false;
  code: string;
  error: string;
}
export type ToolResult<T> = ToolOk<T> | ToolErr;

export const ok = <T>(data: T): ToolOk<T> => ({ ok: true, data });
export const err = (code: string, error: string): ToolErr => ({ ok: false, code, error });
