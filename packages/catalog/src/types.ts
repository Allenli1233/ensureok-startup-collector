/**
 * 结构化产品知识库类型 —— 保险产品数据库(12 份 Markdown)解析后的形态。
 *
 * 设计取向(见 docs 设计增补 v3):12 份文件「家族相似而非严格同构」——
 * 价格表维度各险种不同(职业/市值/规模/行业/运输方式…)。故 PR2 只做「结构保真」
 * 解析:把每份文档解析成 章节树 + 表格(自动标记价格/金额表),忠实保留原始结构;
 * 险种化的维度解读(把价格表映射成带维度的 PriceRow 供价位测算)留到 PR3。
 */

/** 12 险种枚举,与保险产品数据库目录 01–12 一一对应 */
export type InsuranceLineId =
  | 'employer_liability' // 01 雇主责任险
  | 'product_liability' // 02 产品责任险
  | 'public_liability' // 03 公众责任险
  | 'group_accident' // 04 团体意外险
  | 'directors_officers' // 05 董责险 D&O
  | 'cyber' // 06 网络安全险
  | 'ip' // 07 知识产权保险
  | 'tech_eo' // 08 Tech E&O
  | 'ai_liability' // 09 AI 服务责任险
  | 'cargo' // 10 货物运输险
  | 'credit_surety' // 11 信用保证保险
  | 'environmental'; // 12 环境污染责任险

/** 文档头部『> 数据采集时间/数据来源/适用场景』解析结果 */
export interface CatalogMeta {
  /** 数据采集时间原文,如 "2026年7月9日" —— 展示护栏与时效判断用 */
  collectedAt?: string;
  /** 数据来源清单,如 ["各保险公司官网","沃保网","行业公开数据"] */
  sources: string[];
  /** 适用场景原文 */
  applicableScenario?: string;
}

/** 一张 Markdown 表格(结构保真) */
export interface MdTable {
  /** 表格所在章节的标题路径,如 ["二、主要保险公司产品对比","2.1 中国人保雇主责任险(全国版)"] */
  contextPath: string[];
  /** 表头列 */
  columns: string[];
  /** 数据行(每行按列切分的单元格文本) */
  rows: string[][];
  /**
   * 是否含金额/费率数字(单元格出现 ¥/$/元/万 等货币金额形态)。
   * 语义是「这是一张金额相关的表」,价格权威源即来自这些表;非金额表(如市场渗透率)不标记。
   */
  isPriceTable: boolean;
  /** 从本表上下文与单元格中识别到的保司名(去重) */
  insurers: string[];
}

/** 文档中的一个章节(## / ###) */
export interface Section {
  /** 标题层级:2=##,3=###,4=#### */
  level: number;
  /** 本节标题(去掉 # 前缀) */
  heading: string;
  /** 从顶层到本节的标题路径 */
  path: string[];
  /** 本节直属的表格 */
  tables: MdTable[];
}

/** 一个险种一份 = 一个 ProductCatalog */
export interface ProductCatalog {
  lineId: InsuranceLineId;
  /** 中文险种名,如 "雇主责任险" */
  lineName: string;
  /** 原始 .md 路径(相对项目根,溯源用) */
  sourceFile: string;
  /** 文档一级标题(# ...) */
  title: string;
  meta: CatalogMeta;
  /** 全文识别到的保司名(去重) */
  insurers: string[];
  sections: Section[];
  /** 金额/价格表数量 */
  priceTableCount: number;
  /** 是否有任何金额/价格表(AI 服务责任险等无价目表的会是 false) */
  hasPriceTable: boolean;
}
