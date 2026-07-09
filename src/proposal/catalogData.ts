/**
 * 前端消费结构化产品知识库(catalog.json)—— 只取「价格表」与「保司清单」供方案下钻展示。
 *
 * 数据源:packages/catalog/data/catalog.json(PR2 由 12 份 Markdown 解析而来,结构保真)。
 * 这里只做只读查询,按 lineId 取该险种全部 isPriceTable===true 的表,以及全文识别到的保司名。
 * 精简 interface 与后端 @ensureok/catalog 的 ProductCatalog 字段对齐(前端不依赖后端包)。
 */
import catalogJson from '../../packages/catalog/data/catalog.json';

/** 一张价格表(仅取展示需要的字段) */
export interface PriceTable {
  /** 表格所在章节标题路径,如 ["四、典型产品保费参考"] —— 渲染为小标题 */
  contextPath: string[];
  /** 表头列 */
  columns: string[];
  /** 数据行(每行按列切分的单元格文本) */
  rows: string[][];
}

interface CatalogTable {
  contextPath: string[];
  columns: string[];
  rows: string[][];
  isPriceTable: boolean;
  insurers: string[];
}

interface CatalogSection {
  tables: CatalogTable[];
}

interface CatalogEntry {
  lineId: string;
  lineName: string;
  insurers: string[];
  sections: CatalogSection[];
  hasPriceTable: boolean;
}

// catalog.json 是 ProductCatalog[];JSON 字面量类型过宽,用精简 interface 断言收窄。
const catalog = catalogJson as unknown as CatalogEntry[];

function findEntry(lineId: string): CatalogEntry | undefined {
  return catalog.find((e) => e.lineId === lineId);
}

/** 取某险种全部价格表(isPriceTable===true);找不到该险种或无价格表则返回空数组。 */
export function getPriceTables(lineId: string): PriceTable[] {
  const entry = findEntry(lineId);
  if (!entry) return [];
  const out: PriceTable[] = [];
  for (const section of entry.sections) {
    for (const table of section.tables) {
      if (table.isPriceTable) {
        out.push({
          contextPath: table.contextPath,
          columns: table.columns,
          rows: table.rows,
        });
      }
    }
  }
  return out;
}

/** 取某险种全文识别到的保司名;找不到则返回空数组。 */
export function getInsurers(lineId: string): string[] {
  const entry = findEntry(lineId);
  return entry ? entry.insurers : [];
}
