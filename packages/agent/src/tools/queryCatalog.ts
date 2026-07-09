import type { InsuranceLineId } from '@ensureok/catalog';
import { extractLineData } from '../catalogData';
import { err, ok, type ToolContext, type ToolResult } from './types';

export interface QueryCatalogInput {
  lineId: InsuranceLineId;
}

export interface QueryCatalogOutput {
  lineId: InsuranceLineId;
  lineName: string;
  /** 该险种产品库里的承保方(去重) */
  insurers: string[];
  hasPriceTable: boolean;
  priceTableCount: number;
  collectedAt?: string;
  /** 溯源:产品数据文件 */
  sourceFile: string;
}

/** query_catalog:取某险种的承保方清单与产品库元信息(确定性,来自 catalog.json)。 */
export function queryCatalog(input: QueryCatalogInput, ctx: ToolContext): ToolResult<QueryCatalogOutput> {
  const cat = ctx.catalogs.get(input.lineId);
  if (!cat) return err('not-found', `产品库无此险种: ${input.lineId}`);
  const d = extractLineData(cat);
  return ok({
    lineId: cat.lineId,
    lineName: cat.lineName,
    insurers: d.insurers,
    hasPriceTable: d.hasPriceTable,
    priceTableCount: d.priceTables.length,
    collectedAt: d.collectedAt,
    sourceFile: d.sourceFile,
  });
}
