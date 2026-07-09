import { readFileSync } from 'node:fs';
import type { InsuranceLineId, MdTable, ProductCatalog } from '@ensureok/catalog';

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
