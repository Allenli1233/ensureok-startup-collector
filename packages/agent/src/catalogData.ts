import { readFileSync } from 'node:fs';
import type { InsuranceLineId, MdTable, ProductCatalog } from '@ensureok/catalog';
import type { RetrievedChunk } from '@ensureok/rag';

/** 从 @ensureok/catalog 生成的 catalog.json 加载,按 lineId 索引 */
export function loadCatalogs(path: string): Map<InsuranceLineId, ProductCatalog> {
  const arr = JSON.parse(readFileSync(path, 'utf8')) as ProductCatalog[];
  return new Map(arr.map((c) => [c.lineId, c]));
}

export interface LineProductData {
  insurers: string[];
  priceTables: MdTable[];
  collectedAt?: string;
  sourceFile: string;
  hasPriceTable: boolean;
}

/** 从某险种的 ProductCatalog 抽出 Agent 需要的字段(保司/价格表/采集时间) */
export function extractLineData(cat: ProductCatalog): LineProductData {
  const priceTables = cat.sections.flatMap((s) => s.tables).filter((t) => t.isPriceTable);
  return {
    insurers: cat.insurers,
    priceTables,
    collectedAt: cat.meta.collectedAt,
    sourceFile: cat.sourceFile,
    hasPriceTable: cat.hasPriceTable,
  };
}

const MONEY_TEXT = /(?:¥|￥|\$|\d[\d,.]*\s*(?:元|万元|美元|%|‰)|费率)/i;

/**
 * 把结构化产品库中可公开溯源的“适用场景 + 非价格表”转换成生成证据。
 * 产品库原始文件路径保留在 meta 中；价格表绝不进入 LLM 上下文，价格仍只走确定性计算。
 */
export function catalogEvidence(cat: ProductCatalog, limit = 5): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  const add = (id: string, text: string, headingPath: string[]): void => {
    const clean = text.trim();
    if (!clean || MONEY_TEXT.test(clean)) return;
    out.push({
      id: `catalog:${cat.lineId}:${id}`,
      text: clean.slice(0, 1800),
      score: 1,
      meta: {
        sourceFile: cat.sourceFile,
        corpus: 'product',
        insuranceLine: cat.lineName,
        docCategory: '结构化产品库',
        headingPath,
      },
    });
  };

  if (cat.meta.applicableScenario) {
    add('scenario', `适用场景：${cat.meta.applicableScenario}`, ['适用场景']);
  }

  for (let sectionIndex = 0; sectionIndex < cat.sections.length && out.length < limit; sectionIndex++) {
    const section = cat.sections[sectionIndex];
    for (let tableIndex = 0; tableIndex < section.tables.length && out.length < limit; tableIndex++) {
      const table = section.tables[tableIndex];
      if (table.isPriceTable) continue;
      const rows = table.rows.slice(0, 12).map((row) => row.join('｜')).join('\n');
      add(
        `${sectionIndex}:${tableIndex}`,
        `${table.contextPath.join(' > ')}\n${table.columns.join('｜')}\n${rows}`,
        table.contextPath.length ? table.contextPath : section.path,
      );
    }
  }

  return out.slice(0, limit);
}
