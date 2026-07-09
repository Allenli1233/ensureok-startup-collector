import type {
  CatalogMeta,
  InsuranceLineId,
  MdTable,
  ProductCatalog,
  Section,
} from './types';
import { PRICE_CELL_RE, identifyInsurers, isSeparatorLine, splitRow } from './markdown';

export interface ParseInput {
  lineId: InsuranceLineId;
  lineName: string;
  /** 原始 .md 路径(溯源用) */
  sourceFile: string;
  markdown: string;
}

/** 解析文档头部的 `> 数据采集时间/数据来源/适用场景`(只扫到第一条水平分割线为止,避免抓到文末脚注) */
function parseMeta(lines: string[]): CatalogMeta {
  const meta: CatalogMeta = { sources: [] };
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '---' || /^#{2,6}\s/.test(trimmed)) break; // 到第一节/分割线即停
    const l = trimmed.replace(/^>\s?/, '').trim();
    let m: RegExpExecArray | null;
    if ((m = /数据采集时间[：:]\s*(.+)/.exec(l))) {
      meta.collectedAt = m[1].trim();
    } else if ((m = /数据来源[：:]\s*(.+)/.exec(l))) {
      meta.sources = m[1]
        .split(/[、,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if ((m = /适用场景[：:]\s*(.+)/.exec(l))) {
      meta.applicableScenario = m[1].trim();
    }
  }
  return meta;
}

/**
 * 把一份『XX产品数据.md』解析成结构保真的 ProductCatalog:
 * 标题 + 头部元信息 + 章节树(## / ###) + 每节的表格(自动标记金额/价格表与保司)。
 */
export function parseProductDoc(input: ParseInput): ProductCatalog {
  const lines = input.markdown.split(/\r?\n/);

  let title = input.lineName;
  for (const l of lines) {
    const m = /^#\s+(.+?)\s*$/.exec(l);
    if (m) {
      title = m[1].trim();
      break;
    }
  }

  const meta = parseMeta(lines);

  const sections: Section[] = [];
  const stack: { level: number; heading: string }[] = [];
  let current: Section | null = null;

  const openSection = (level: number, heading: string) => {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, heading });
    current = { level, heading, path: stack.map((h) => h.heading), tables: [] };
    sections.push(current);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const hm = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (hm) {
      openSection(hm[1].length, hm[2].trim());
      i++;
      continue;
    }

    // 表格:以 | 起始的行,且下一行是分隔行
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      isSeparatorLine(lines[i + 1])
    ) {
      const columns = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      const contextPath = current ? current.path : [title];
      const cellText = `${columns.join(' ')} ${rows.map((r) => r.join(' ')).join(' ')}`;
      const table: MdTable = {
        contextPath,
        columns,
        rows,
        isPriceTable: PRICE_CELL_RE.test(cellText),
        insurers: identifyInsurers(`${contextPath.join(' ')} ${cellText}`),
      };
      if (!current) {
        // 表格出现在任何标题之前 —— 挂到一个以文档标题为名的根节
        current = { level: 1, heading: title, path: [title], tables: [] };
        sections.push(current);
      }
      current.tables.push(table);
      i = j;
      continue;
    }

    i++;
  }

  const allTables = sections.flatMap((s) => s.tables);
  const priceTableCount = allTables.filter((t) => t.isPriceTable).length;

  return {
    lineId: input.lineId,
    lineName: input.lineName,
    sourceFile: input.sourceFile,
    title,
    meta,
    insurers: identifyInsurers(input.markdown),
    sections,
    priceTableCount,
    hasPriceTable: priceTableCount > 0,
  };
}
