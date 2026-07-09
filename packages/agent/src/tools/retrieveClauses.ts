import { retrieve } from '@ensureok/rag';
import { err, ok, type ToolContext, type ToolResult } from './types';

export interface RetrieveClausesInput {
  /** 险种中文名(用于 RAG 过滤,与 catalog.lineName 一致) */
  lineName: string;
  /** 检索意图,如 "保险责任 保障范围"、"责任免除"、"理赔实务" */
  query: string;
  topK?: number;
  docCategories?: string[];
}

export interface RetrievedClause {
  text: string;
  sourceFile: string;
  headingPath: string[];
  docCategory: string;
  score: number;
}

/** retrieve_clauses:按险种从 RAG 检索条款/理由证据(条款只信 RAG,价格不走这里)。 */
export async function retrieveClauses(
  input: RetrieveClausesInput,
  ctx: ToolContext,
): Promise<ToolResult<RetrievedClause[]>> {
  try {
    const hits = await retrieve(ctx.ragStore, ctx.embedding, `${input.lineName} ${input.query}`, {
      insuranceLines: [input.lineName],
      topK: input.topK ?? 5,
      docCategories: input.docCategories,
    });
    return ok(
      hits.map((h) => ({
        text: h.text,
        sourceFile: h.meta.sourceFile,
        headingPath: h.meta.headingPath,
        docCategory: h.meta.docCategory,
        score: Number(h.score.toFixed(3)),
      })),
    );
  } catch (e) {
    return err('rag-failed', String(e).slice(0, 200));
  }
}
